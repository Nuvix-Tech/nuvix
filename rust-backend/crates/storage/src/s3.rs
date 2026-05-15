use crate::device::{Device, DeviceMetadata};
use crate::error::{Result, StorageError};
use async_trait::async_trait;
use bytes::Bytes;
use chrono::Utc;
use hmac::{Hmac, Mac};
use md5::Digest as Md5Digest;
use mime_guess::from_path;
use quick_xml::de::from_str;
use reqwest::{Client, Method, Response, header};
use serde::{Deserialize, Serialize};
use sha2::{Digest as Sha2Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use url::form_urlencoded;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Deserialize)]
struct InitMultipartUploadResult {
    #[serde(rename = "UploadId")]
    upload_id: String,
}

#[derive(Debug, Deserialize)]
struct ListPartsResult {
    #[serde(rename = "Part")]
    parts: Option<Vec<Part>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct Part {
    #[serde(rename = "PartNumber")]
    part_number: usize,
    #[serde(rename = "ETag")]
    etag: String,
}

#[derive(Debug, Serialize)]
#[serde(rename = "CompleteMultipartUpload")]
struct CompleteMultipartUpload {
    #[serde(rename = "Part")]
    parts: Vec<Part>,
}

#[derive(Clone)]
pub struct S3 {
    root: String,
    access_key: String,
    secret_key: String,
    bucket: String,
    region: String,
    acl: String,
    endpoint_url: String,
    client: Client,
}

impl S3 {
    pub const ACL_PRIVATE: &'static str = "private";
    pub const ACL_PUBLIC_READ: &'static str = "public-read";

    pub fn new(
        root: &str,
        access_key: &str,
        secret_key: &str,
        bucket: &str,
        region: Option<&str>,
        acl: Option<&str>,
        endpoint_url: Option<&str>,
    ) -> Self {
        let region = region.unwrap_or("us-east-1").to_string();
        let endpoint_url = endpoint_url
            .unwrap_or(&format!("https://s3.{}.amazonaws.com", region))
            .to_string();

        Self {
            root: root.to_string(),
            access_key: access_key.to_string(),
            secret_key: secret_key.to_string(),
            bucket: bucket.to_string(),
            region,
            acl: acl.unwrap_or(Self::ACL_PRIVATE).to_string(),
            endpoint_url,
            client: Client::new(),
        }
    }

    pub fn with_endpoint(&mut self, endpoint: String) {
        self.endpoint_url = endpoint;
    }

    fn full_path(&self, filename: &str) -> String {
        let mut p = self.root.clone();
        if !p.is_empty() && !p.ends_with('/') {
            p.push('/');
        }
        let stripped = filename.strip_prefix('/').unwrap_or(filename);
        p.push_str(stripped);
        p
    }

    fn sha256_hexdigest(data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hex::encode(hasher.finalize())
    }

    fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
        let mut mac = HmacSha256::new_from_slice(key).unwrap();
        mac.update(data);
        mac.finalize().into_bytes().to_vec()
    }

    fn get_signature_v4(
        &self,
        method: &Method,
        uri: &str,
        query: &BTreeMap<String, String>,
        headers: &BTreeMap<String, String>,
        payload_hash: &str,
        amz_date: &str,
        date_stamp: &str,
    ) -> String {
        let canonical_uri = if uri.is_empty() { "/" } else { uri };

        let mut canonical_querystring = String::new();
        for (k, v) in query {
            if !canonical_querystring.is_empty() {
                canonical_querystring.push('&');
            }
            canonical_querystring.push_str(&form_urlencoded::byte_serialize(k.as_bytes()).collect::<String>());
            canonical_querystring.push('=');
            canonical_querystring.push_str(&form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>());
        }

        let mut canonical_headers = String::new();
        let mut signed_headers = String::new();
        for (k, v) in headers {
            let lower_k = k.to_lowercase();
            canonical_headers.push_str(&format!("{}:{}\n", lower_k, v.trim()));
            if !signed_headers.is_empty() {
                signed_headers.push(';');
            }
            signed_headers.push_str(&lower_k);
        }

        let canonical_request = format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            method.as_str(),
            canonical_uri,
            canonical_querystring,
            canonical_headers,
            signed_headers,
            payload_hash
        );

        let credential_scope = format!("{}/{}/s3/aws4_request", date_stamp, self.region);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{}\n{}\n{}",
            amz_date,
            credential_scope,
            Self::sha256_hexdigest(canonical_request.as_bytes())
        );

        let k_date = Self::hmac_sha256(format!("AWS4{}", self.secret_key).as_bytes(), date_stamp.as_bytes());
        let k_region = Self::hmac_sha256(&k_date, self.region.as_bytes());
        let k_service = Self::hmac_sha256(&k_region, b"s3");
        let k_signing = Self::hmac_sha256(&k_service, b"aws4_request");

        let signature = Self::hmac_sha256(&k_signing, string_to_sign.as_bytes());
        hex::encode(signature)
    }

    async fn call(
        &self,
        method: Method,
        uri: &str,
        data: Option<Bytes>,
        parameters: Option<HashMap<String, String>>,
        extra_headers: Option<HashMap<String, String>>,
    ) -> Result<Response> {
        let now = Utc::now();
        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let date_stamp = now.format("%Y%m%d").to_string();

        let host = self.endpoint_url.replace("https://", "").replace("http://", "");
        let formatted_host = if host.contains(&self.bucket) {
            host
        } else {
            format!("{}.{}", self.bucket, host)
        };

        let endpoint = if self.endpoint_url.contains(&self.bucket) {
            format!("{}{}", self.endpoint_url, uri)
        } else {
            format!("{}://{}{}", self.endpoint_url.split("://").next().unwrap_or("https"), formatted_host, uri)
        };

        let mut query = BTreeMap::new();
        if let Some(params) = parameters {
            for (k, v) in params {
                query.insert(k, v);
            }
        }

        let payload = data.clone().unwrap_or_else(Bytes::new);
        let payload_hash = Self::sha256_hexdigest(&payload);

        let mut headers = BTreeMap::new();
        headers.insert("host".to_string(), formatted_host);
        headers.insert("x-amz-date".to_string(), amz_date.clone());
        headers.insert("x-amz-content-sha256".to_string(), payload_hash.clone());

        if let Some(ext) = extra_headers {
            for (k, v) in ext {
                headers.insert(k.to_lowercase(), v);
            }
        }

        let signed_headers_list: Vec<String> = headers.keys().cloned().collect();
        let signed_headers = signed_headers_list.join(";");

        let signature = self.get_signature_v4(
            &method,
            uri,
            &query,
            &headers,
            &payload_hash,
            &amz_date,
            &date_stamp,
        );

        let authorization_header = format!(
            "AWS4-HMAC-SHA256 Credential={}/{}/{}/s3/aws4_request, SignedHeaders={}, Signature={}",
            self.access_key, date_stamp, self.region, signed_headers, signature
        );

        let mut req = self.client.request(method.clone(), &endpoint);

        for (k, v) in &query {
            req = req.query(&[(k, v)]);
        }

        for (k, v) in &headers {
            req = req.header(k, v);
        }

        req = req.header("Authorization", authorization_header);

        if method != Method::GET && method != Method::HEAD {
            req = req.body(payload);
        }

        let res = req.send().await?;

        if res.status().is_success() {
            Ok(res)
        } else {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            Err(StorageError::Unknown(format!("S3 Error: {} - {}", status, body)))
        }
    }

    async fn create_multipart_upload(&self, path: &str, content_type: &str) -> Result<String> {
        let uri = format!("/{}", self.full_path(path));
        let mut params = HashMap::new();
        params.insert("uploads".to_string(), "".to_string());

        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), content_type.to_string());

        let res = self.call(Method::POST, &uri, None, Some(params), Some(headers)).await?;
        let body = res.text().await?;

        let result: InitMultipartUploadResult = from_str(&body).map_err(|e| StorageError::MultipartUpload(e.to_string()))?;
        Ok(result.upload_id)
    }

    async fn upload_part(&self, data: Bytes, path: &str, _content_type: &str, chunk: usize, upload_id: &str) -> Result<String> {
        let uri = format!("/{}", self.full_path(path));
        let mut params = HashMap::new();
        params.insert("partNumber".to_string(), chunk.to_string());
        params.insert("uploadId".to_string(), upload_id.to_string());

        let res = self.call(Method::PUT, &uri, Some(data), Some(params), None).await?;

        let etag = res.headers()
            .get("ETag")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        Ok(etag)
    }

    async fn complete_multipart_upload(&self, path: &str, upload_id: &str, parts: Vec<Part>) -> Result<bool> {
        let uri = format!("/{}", self.full_path(path));
        let mut params = HashMap::new();
        params.insert("uploadId".to_string(), upload_id.to_string());

        let complete_data = CompleteMultipartUpload { parts };
        let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CompleteMultipartUpload>");
        for p in complete_data.parts {
            xml.push_str(&format!("<Part><PartNumber>{}</PartNumber><ETag>{}</ETag></Part>", p.part_number, p.etag));
        }
        xml.push_str("</CompleteMultipartUpload>");

        self.call(Method::POST, &uri, Some(Bytes::from(xml)), Some(params), None).await?;
        Ok(true)
    }
}

#[async_trait]
impl Device for S3 {
    fn get_name(&self) -> &str {
        "S3 Storage"
    }

    fn get_type(&self) -> &str {
        "s3"
    }

    fn get_description(&self) -> &str {
        "S3 volume adapter"
    }

    fn get_root(&self) -> &str {
        &self.root
    }

    fn get_path(&self, filename: &str, prefix: Option<&str>) -> String {
        let mut p = String::new();
        if let Some(pref) = prefix {
            p.push_str(pref);
            if !p.ends_with('/') {
                p.push('/');
            }
        }
        p.push_str(filename);
        p
    }

    async fn upload(
        &self,
        source: &str,
        path: &str,
        chunk: Option<usize>,
        chunks: Option<usize>,
        metadata: Option<DeviceMetadata>,
    ) -> Result<usize> {
        let data = tokio::fs::read(source).await?;
        let content_type = from_path(source).first_or_octet_stream().to_string();
        self.upload_data(Bytes::from(data), path, &content_type, chunk, chunks, metadata).await
    }

    async fn upload_data(
        &self,
        data: Bytes,
        path: &str,
        content_type: &str,
        _chunk: Option<usize>,
        _chunks: Option<usize>,
        _metadata: Option<DeviceMetadata>,
    ) -> Result<usize> {
        let uri = format!("/{}", self.full_path(path));
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), content_type.to_string());

        self.call(Method::PUT, &uri, Some(data), None, Some(headers)).await?;
        Ok(1)
    }

    async fn abort(&self, path: &str, extra: Option<&str>) -> Result<bool> {
        if let Some(upload_id) = extra {
            let uri = format!("/{}", self.full_path(path));
            let mut params = HashMap::new();
            params.insert("uploadId".to_string(), upload_id.to_string());
            self.call(Method::DELETE, &uri, None, Some(params), None).await?;
        } else {
            self.delete(path, None).await?;
        }
        Ok(true)
    }

    async fn read(&self, path: &str, offset: Option<usize>, length: Option<usize>) -> Result<Bytes> {
        let uri = format!("/{}", self.full_path(path));
        let mut headers = HashMap::new();

        if let (Some(off), Some(len)) = (offset, length) {
            headers.insert("Range".to_string(), format!("bytes={}-{}", off, off + len - 1));
        } else if let Some(off) = offset {
            headers.insert("Range".to_string(), format!("bytes={}-", off));
        }

        let res = self.call(Method::GET, &uri, None, None, Some(headers)).await?;
        Ok(res.bytes().await.map_err(|e| StorageError::Http(e))?)
    }

    async fn transfer(
        &self,
        path: &str,
        destination: &str,
        device: &dyn Device,
    ) -> Result<bool> {
        let data = self.read(path, None, None).await?;
        device.upload_data(data, destination, "", None, None, None).await?;
        Ok(true)
    }

    async fn write(&self, path: &str, data: Bytes, content_type: Option<&str>) -> Result<bool> {
        let ct = content_type.unwrap_or("application/octet-stream");
        self.upload_data(data, path, ct, None, None, None).await?;
        Ok(true)
    }

    async fn move_file(&self, source: &str, target: &str) -> Result<bool> {
        let src_uri = format!("/{}/{}", self.bucket, self.full_path(source));
        let tgt_uri = format!("/{}", self.full_path(target));

        let mut headers = HashMap::new();
        headers.insert("x-amz-copy-source".to_string(), src_uri);

        self.call(Method::PUT, &tgt_uri, None, None, Some(headers)).await?;
        self.delete(source, None).await?;
        Ok(true)
    }

    async fn delete(&self, path: &str, _recursive: Option<bool>) -> Result<bool> {
        let uri = format!("/{}", self.full_path(path));
        self.call(Method::DELETE, &uri, None, None, None).await?;
        Ok(true)
    }

    async fn delete_path(&self, _path: &str) -> Result<bool> {
        // Simple implementation: AWS S3 doesn't have directories, but we'd list objects with prefix and delete
        Ok(true)
    }

    async fn exists(&self, path: &str) -> Result<bool> {
        let uri = format!("/{}", self.full_path(path));
        match self.call(Method::HEAD, &uri, None, None, None).await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    async fn get_file_size(&self, path: &str) -> Result<usize> {
        let uri = format!("/{}", self.full_path(path));
        let res = self.call(Method::HEAD, &uri, None, None, None).await?;
        let len = res.headers()
            .get(header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);
        Ok(len)
    }

    async fn get_file_mime_type(&self, path: &str) -> Result<String> {
        let uri = format!("/{}", self.full_path(path));
        let res = self.call(Method::HEAD, &uri, None, None, None).await?;
        let mime = res.headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        Ok(mime)
    }

    async fn get_file_hash(&self, path: &str) -> Result<String> {
        let uri = format!("/{}", self.full_path(path));
        let res = self.call(Method::HEAD, &uri, None, None, None).await?;
        let etag = res.headers()
            .get("ETag")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .trim_matches('"')
            .to_string();
        Ok(etag)
    }

    async fn create_directory(&self, _path: &str) -> Result<bool> {
        Ok(true)
    }

    async fn get_directory_size(&self, _path: &str) -> Result<usize> {
        Ok(0)
    }

    async fn get_partition_free_space(&self) -> Result<usize> {
        Ok(0)
    }

    async fn get_partition_total_space(&self) -> Result<usize> {
        Ok(0)
    }

    async fn get_files(
        &self,
        _dir: &str,
        _max: Option<usize>,
        _continuation_token: Option<&str>,
    ) -> Result<Vec<String>> {
        Ok(vec![])
    }
}
