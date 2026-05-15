pub mod error;
pub mod device;
pub mod local;
pub mod s3;
pub mod wasabi;
pub mod minio;
pub mod validator;
pub mod storage;

pub use error::{StorageError, Result};
pub use device::{Device, DeviceMetadata};
pub use local::Local;
pub use s3::S3;
pub use wasabi::Wasabi;
pub use minio::MinIO;
pub use validator::{Validator, FileExt, FileName, FileSize, FileType, Upload};
pub use storage::Storage;

#[cfg(test)]
mod tests;
