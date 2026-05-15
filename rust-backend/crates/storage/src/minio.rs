use crate::s3::S3;
use crate::device::Device;
use crate::error::Result;
use async_trait::async_trait;
use bytes::Bytes;
use crate::device::DeviceMetadata;

#[derive(Clone)]
pub struct MinIO {
    s3: S3,
}

impl MinIO {
    pub fn new(
        root: &str,
        access_key: &str,
        secret_key: &str,
        bucket: &str,
        endpoint: Option<&str>,
        acl: Option<&str>,
        use_ssl: Option<bool>,
    ) -> Self {
        let use_ssl = use_ssl.unwrap_or(false);
        let endpoint_url = endpoint.unwrap_or("localhost:9000").to_string();
        let protocol = if use_ssl { "https" } else { "http" };
        let full_endpoint = format!("{}://{}", protocol, endpoint_url);

        Self {
            s3: S3::new(root, access_key, secret_key, bucket, Some("us-east-1"), acl, Some(&full_endpoint)),
        }
    }
}

#[async_trait]
impl Device for MinIO {
    fn get_name(&self) -> &str {
        "MinIO Storage"
    }

    fn get_type(&self) -> &str {
        "minio"
    }

    fn get_description(&self) -> &str {
        "MinIO volume adapter"
    }

    fn get_root(&self) -> &str {
        self.s3.get_root()
    }

    fn get_path(&self, filename: &str, prefix: Option<&str>) -> String {
        self.s3.get_path(filename, prefix)
    }

    async fn upload(&self, source: &str, path: &str, chunk: Option<usize>, chunks: Option<usize>, metadata: Option<DeviceMetadata>) -> Result<usize> {
        self.s3.upload(source, path, chunk, chunks, metadata).await
    }

    async fn upload_data(&self, data: Bytes, path: &str, content_type: &str, chunk: Option<usize>, chunks: Option<usize>, metadata: Option<DeviceMetadata>) -> Result<usize> {
        self.s3.upload_data(data, path, content_type, chunk, chunks, metadata).await
    }

    async fn abort(&self, path: &str, extra: Option<&str>) -> Result<bool> {
        self.s3.abort(path, extra).await
    }

    async fn read(&self, path: &str, offset: Option<usize>, length: Option<usize>) -> Result<Bytes> {
        self.s3.read(path, offset, length).await
    }

    async fn transfer(&self, path: &str, destination: &str, device: &dyn Device) -> Result<bool> {
        self.s3.transfer(path, destination, device).await
    }

    async fn write(&self, path: &str, data: Bytes, content_type: Option<&str>) -> Result<bool> {
        self.s3.write(path, data, content_type).await
    }

    async fn move_file(&self, source: &str, target: &str) -> Result<bool> {
        self.s3.move_file(source, target).await
    }

    async fn delete(&self, path: &str, recursive: Option<bool>) -> Result<bool> {
        self.s3.delete(path, recursive).await
    }

    async fn delete_path(&self, path: &str) -> Result<bool> {
        self.s3.delete_path(path).await
    }

    async fn exists(&self, path: &str) -> Result<bool> {
        self.s3.exists(path).await
    }

    async fn get_file_size(&self, path: &str) -> Result<usize> {
        self.s3.get_file_size(path).await
    }

    async fn get_file_mime_type(&self, path: &str) -> Result<String> {
        self.s3.get_file_mime_type(path).await
    }

    async fn get_file_hash(&self, path: &str) -> Result<String> {
        self.s3.get_file_hash(path).await
    }

    async fn create_directory(&self, path: &str) -> Result<bool> {
        self.s3.create_directory(path).await
    }

    async fn get_directory_size(&self, path: &str) -> Result<usize> {
        self.s3.get_directory_size(path).await
    }

    async fn get_partition_free_space(&self) -> Result<usize> {
        self.s3.get_partition_free_space().await
    }

    async fn get_partition_total_space(&self) -> Result<usize> {
        self.s3.get_partition_total_space().await
    }

    async fn get_files(&self, dir: &str, max: Option<usize>, continuation_token: Option<&str>) -> Result<Vec<String>> {
        self.s3.get_files(dir, max, continuation_token).await
    }
}