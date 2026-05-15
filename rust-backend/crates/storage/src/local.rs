use crate::device::{Device, DeviceMetadata};
use crate::error::{Result, StorageError};
use async_trait::async_trait;
use bytes::Bytes;
use md5::{Digest, Md5};
use mime_guess::from_path;
use std::path::{Path, PathBuf};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

pub struct Local {
    root: String,
    max_page_size: usize,
}

impl Local {
    pub fn new(root: Option<&str>) -> Self {
        Self {
            root: root.unwrap_or("").to_string(),
            max_page_size: 1000,
        }
    }

    fn full_path(&self, filename: &str) -> PathBuf {
        Path::new(&self.root).join(filename)
    }

    async fn join_chunks(&self, file_path: &str, chunks: usize) -> Result<bool> {
        let dest_path = self.full_path(file_path);
        let mut dest_file = OpenOptions::new()
            .create(true)
            .write(true)
            .append(true)
            .open(&dest_path)
            .await?;

        for i in 1..=chunks {
            let chunk_path = self.full_path(&format!("{}_{}", file_path, i));
            let mut chunk_file = File::open(&chunk_path).await?;
            let mut buffer = Vec::new();
            chunk_file.read_to_end(&mut buffer).await?;
            dest_file.write_all(&buffer).await?;

            // Delete chunk after appending
            fs::remove_file(&chunk_path).await?;
        }

        Ok(true)
    }
}

#[async_trait]
impl Device for Local {
    fn get_name(&self) -> &str {
        "Local Storage"
    }

    fn get_type(&self) -> &str {
        "local"
    }

    fn get_description(&self) -> &str {
        "Local volume adapter"
    }

    fn get_root(&self) -> &str {
        &self.root
    }

    fn get_path(&self, filename: &str, prefix: Option<&str>) -> String {
        let mut p = PathBuf::from(&self.root);
        if let Some(pref) = prefix {
            p.push(pref);
        }
        p.push(filename);
        p.to_string_lossy().to_string()
    }

    async fn upload(
        &self,
        source: &str,
        path: &str,
        chunk: Option<usize>,
        chunks: Option<usize>,
        _metadata: Option<DeviceMetadata>,
    ) -> Result<usize> {
        let source_path = Path::new(source);
        if !source_path.exists() {
            return Err(StorageError::NotFound("Source file not found".to_string()));
        }

        let file_data = fs::read(source).await?;
        self.upload_data(Bytes::from(file_data), path, "", chunk, chunks, _metadata).await
    }

    async fn upload_data(
        &self,
        data: Bytes,
        path: &str,
        _content_type: &str,
        chunk: Option<usize>,
        chunks: Option<usize>,
        _metadata: Option<DeviceMetadata>,
    ) -> Result<usize> {
        let dest_path = if let (Some(c), Some(_)) = (chunk, chunks) {
            self.full_path(&format!("{}_{}", path, c))
        } else {
            self.full_path(path)
        };

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        fs::write(&dest_path, &data).await?;

        if let (Some(c), Some(chks)) = (chunk, chunks) {
            if c == chks {
                self.join_chunks(path, chks).await?;
            }
        }

        Ok(1)
    }

    async fn abort(&self, path: &str, _extra: Option<&str>) -> Result<bool> {
        let path = self.full_path(path);
        if path.exists() {
            fs::remove_file(path).await?;
        }
        Ok(true)
    }

    async fn read(&self, path: &str, offset: Option<usize>, length: Option<usize>) -> Result<Bytes> {
        let full_path = self.full_path(path);
        if !full_path.exists() {
            return Err(StorageError::NotFound("File not found".to_string()));
        }

        let mut file = File::open(&full_path).await?;

        if let Some(off) = offset {
            file.seek(std::io::SeekFrom::Start(off as u64)).await?;
        }

        let mut buffer = Vec::new();
        if let Some(len) = length {
            buffer.resize(len, 0);
            let n = file.read_exact(&mut buffer).await?;
            buffer.truncate(n);
        } else {
            file.read_to_end(&mut buffer).await?;
        }

        Ok(Bytes::from(buffer))
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

    async fn write(&self, path: &str, data: Bytes, _content_type: Option<&str>) -> Result<bool> {
        let full_path = self.full_path(path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(full_path, data).await?;
        Ok(true)
    }

    async fn move_file(&self, source: &str, target: &str) -> Result<bool> {
        let src_path = self.full_path(source);
        let dst_path = self.full_path(target);

        if let Some(parent) = dst_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        fs::rename(src_path, dst_path).await?;
        Ok(true)
    }

    async fn delete(&self, path: &str, recursive: Option<bool>) -> Result<bool> {
        let full_path = self.full_path(path);
        if full_path.is_dir() {
            if recursive.unwrap_or(false) {
                fs::remove_dir_all(&full_path).await?;
            } else {
                fs::remove_dir(&full_path).await?;
            }
        } else {
            fs::remove_file(&full_path).await?;
        }
        Ok(true)
    }

    async fn delete_path(&self, path: &str) -> Result<bool> {
        let full_path = self.full_path(path);
        if full_path.is_dir() {
            fs::remove_dir_all(&full_path).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    async fn exists(&self, path: &str) -> Result<bool> {
        Ok(self.full_path(path).exists())
    }

    async fn get_file_size(&self, path: &str) -> Result<usize> {
        let metadata = fs::metadata(self.full_path(path)).await?;
        Ok(metadata.len() as usize)
    }

    async fn get_file_mime_type(&self, path: &str) -> Result<String> {
        let full_path = self.full_path(path);
        let mime = from_path(full_path).first_or_octet_stream();
        Ok(mime.to_string())
    }

    async fn get_file_hash(&self, path: &str) -> Result<String> {
        let data = fs::read(self.full_path(path)).await?;
        let mut hasher = Md5::new();
        hasher.update(&data);
        let result = hasher.finalize();
        Ok(hex::encode(result))
    }

    async fn create_directory(&self, path: &str) -> Result<bool> {
        fs::create_dir_all(self.full_path(path)).await?;
        Ok(true)
    }

    async fn get_directory_size(&self, path: &str) -> Result<usize> {
        let mut size = 0;
        let mut stack = vec![self.full_path(path)];

        while let Some(dir) = stack.pop() {
            if !dir.is_dir() {
                continue;
            }

            let mut entries = fs::read_dir(dir).await?;
            while let Some(entry) = entries.next_entry().await? {
                let metadata = entry.metadata().await?;
                if metadata.is_dir() {
                    stack.push(entry.path());
                } else {
                    size += metadata.len();
                }
            }
        }

        Ok(size as usize)
    }

    async fn get_partition_free_space(&self) -> Result<usize> {
        // Rust std doesn't have a built-in way to get disk free space cross-platform easily
        // We'll return 0 for now as a fallback or could use a crate like sysinfo
        Ok(0)
    }

    async fn get_partition_total_space(&self) -> Result<usize> {
        Ok(0)
    }

    async fn get_files(
        &self,
        dir: &str,
        max: Option<usize>,
        _continuation_token: Option<&str>,
    ) -> Result<Vec<String>> {
        let full_dir = self.full_path(dir);
        let mut files = Vec::new();
        let limit = max.unwrap_or(self.max_page_size);

        if !full_dir.is_dir() {
            return Ok(files);
        }

        let mut entries = fs::read_dir(full_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            if files.len() >= limit {
                break;
            }
            if let Ok(file_name) = entry.file_name().into_string() {
                files.push(file_name);
            }
        }

        Ok(files)
    }
}