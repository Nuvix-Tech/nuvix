use async_trait::async_trait;
use regex::Regex;
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;

#[async_trait]
pub trait Validator: Send + Sync {
    fn get_description(&self) -> &str;
    async fn is_valid(&self, value: &str) -> bool;
}

pub struct FileExt {
    allowed: Vec<String>,
}

impl FileExt {
    pub const TYPE_JPEG: &'static str = "jpeg";
    pub const TYPE_JPG: &'static str = "jpg";
    pub const TYPE_GIF: &'static str = "gif";
    pub const TYPE_PNG: &'static str = "png";
    pub const TYPE_GZIP: &'static str = "gz";
    pub const TYPE_ZIP: &'static str = "zip";

    pub fn new(allowed: Vec<String>) -> Self {
        Self { allowed }
    }
}

#[async_trait]
impl Validator for FileExt {
    fn get_description(&self) -> &str {
        "Validates file extension against a list of allowed extensions"
    }

    async fn is_valid(&self, filename: &str) -> bool {
        let path = Path::new(filename);
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            self.allowed.contains(&ext.to_lowercase())
        } else {
            false
        }
    }
}

pub struct FileName;

impl FileName {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Validator for FileName {
    fn get_description(&self) -> &str {
        "Validates that file name contains only letters, numbers, and periods"
    }

    async fn is_valid(&self, filename: &str) -> bool {
        if filename.is_empty() {
            return false;
        }
        lazy_static::lazy_static! {
            static ref RE: Regex = Regex::new(r"^[a-zA-Z0-9\.]+$").unwrap();
        }
        RE.is_match(filename)
    }
}

pub struct FileSize {
    max: usize,
}

impl FileSize {
    pub fn new(max: usize) -> Self {
        Self { max }
    }
}

#[async_trait]
impl Validator for FileSize {
    fn get_description(&self) -> &str {
        "Validates that file size is within maximum limit"
    }

    async fn is_valid(&self, size_str: &str) -> bool {
        if let Ok(size) = size_str.parse::<usize>() {
            size <= self.max
        } else {
            false
        }
    }
}

pub struct FileType {
    allowed: Vec<String>,
}

impl FileType {
    pub const FILE_TYPE_JPEG: &'static str = "jpeg";
    pub const FILE_TYPE_GIF: &'static str = "gif";
    pub const FILE_TYPE_PNG: &'static str = "png";
    pub const FILE_TYPE_GZIP: &'static str = "gz";

    pub fn new(allowed: Vec<String>) -> Self {
        Self { allowed }
    }
}

#[async_trait]
impl Validator for FileType {
    fn get_description(&self) -> &str {
        "Validates file type by reading file signature (magic bytes)"
    }

    async fn is_valid(&self, path: &str) -> bool {
        let Ok(data) = fs::read(path).await else {
            return false;
        };

        if data.is_empty() {
            return false;
        }

        let mut map: HashMap<&'static str, Vec<Vec<u8>>> = HashMap::new();
        map.insert("jpeg", vec![vec![0xFF, 0xD8, 0xFF]]);
        map.insert(
            "gif",
            vec![
                vec![0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
                vec![0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
            ],
        );
        map.insert(
            "png",
            vec![vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
        );
        map.insert("gz", vec![vec![0x1F, 0x8B]]);
        map.insert("zip", vec![vec![0x50, 0x4B, 0x03, 0x04]]);

        for allowed_type in &self.allowed {
            if let Some(signatures) = map.get(allowed_type.as_str()) {
                for signature in signatures {
                    if data.len() >= signature.len() && &data[0..signature.len()] == signature.as_slice() {
                        return true;
                    }
                }
            }
        }

        false
    }
}

pub struct Upload;

impl Upload {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Validator for Upload {
    fn get_description(&self) -> &str {
        "Validates that a file exists and is a valid upload"
    }

    async fn is_valid(&self, path: &str) -> bool {
        let p = Path::new(path);
        p.exists() && p.is_file()
    }
}
