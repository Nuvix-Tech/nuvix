use crate::error::Result;
use async_trait::async_trait;
use bytes::Bytes;
use std::collections::HashMap;

pub type DeviceMetadata = HashMap<String, String>;

#[async_trait]
pub trait Device: Send + Sync {
    /// Max chunk size while transferring file from one device to another
    fn get_transfer_chunk_size(&self) -> usize {
        5 * 1024 * 1024 // 5MB default
    }

    /// Get storage device name
    fn get_name(&self) -> &str;

    /// Get Device Type
    fn get_type(&self) -> &str;

    /// Get Device Description
    fn get_description(&self) -> &str;

    /// Get storage device root path
    fn get_root(&self) -> &str;

    /// Get path with prefix
    fn get_path(&self, filename: &str, prefix: Option<&str>) -> String;

    /// Upload file contents to desired destination in the selected disk.
    /// Returns number of chunks uploaded or 0 if it fails.
    async fn upload(
        &self,
        source: &str,
        path: &str,
        chunk: Option<usize>,
        chunks: Option<usize>,
        metadata: Option<DeviceMetadata>,
    ) -> Result<usize>;

    /// Upload Data.
    /// Upload file contents to desired destination in the selected disk.
    /// Returns number of chunks uploaded or 0 if it fails.
    async fn upload_data(
        &self,
        data: Bytes,
        path: &str,
        content_type: &str,
        chunk: Option<usize>,
        chunks: Option<usize>,
        metadata: Option<DeviceMetadata>,
    ) -> Result<usize>;

    /// Abort Chunked Upload
    async fn abort(&self, path: &str, extra: Option<&str>) -> Result<bool>;

    /// Read file by given path.
    async fn read(&self, path: &str, offset: Option<usize>, length: Option<usize>) -> Result<Bytes>;

    /// Transfer a file from current device to destination device.
    async fn transfer(
        &self,
        path: &str,
        destination: &str,
        device: &dyn Device,
    ) -> Result<bool>;

    /// Write file by given path.
    async fn write(&self, path: &str, data: Bytes, content_type: Option<&str>) -> Result<bool>;

    /// Move file from given source to given path, return true on success and false on failure.
    async fn move_file(&self, source: &str, target: &str) -> Result<bool>;

    /// Delete file in given path return true on success and false on failure.
    async fn delete(&self, path: &str, recursive: Option<bool>) -> Result<bool>;

    /// Delete files in given path, path must be a directory. return true on success and false on failure.
    async fn delete_path(&self, path: &str) -> Result<bool>;

    /// Check if file exists
    async fn exists(&self, path: &str) -> Result<bool>;

    /// Get file size
    async fn get_file_size(&self, path: &str) -> Result<usize>;

    /// Get file mime type
    async fn get_file_mime_type(&self, path: &str) -> Result<String>;

    /// Get file hash
    async fn get_file_hash(&self, path: &str) -> Result<String>;

    /// Create directory
    async fn create_directory(&self, path: &str) -> Result<bool>;

    /// Get directory size
    async fn get_directory_size(&self, path: &str) -> Result<usize>;

    /// Get partition free space
    async fn get_partition_free_space(&self) -> Result<usize>;

    /// Get partition total space
    async fn get_partition_total_space(&self) -> Result<usize>;

    /// Get files inside a directory
    async fn get_files(
        &self,
        dir: &str,
        max: Option<usize>,
        continuation_token: Option<&str>,
    ) -> Result<Vec<String>>;
}
