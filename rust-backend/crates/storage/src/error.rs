use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Initialization error: {0}")]
    Init(String),

    #[error("Storage device '{0}' not found")]
    DeviceNotFound(String),

    #[error("Unknown error: {0}")]
    Unknown(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Multipart upload failed: {0}")]
    MultipartUpload(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("XML parsing error: {0}")]
    XmlParsing(#[from] quick_xml::DeError),
}

pub type Result<T> = std::result::Result<T, StorageError>;
