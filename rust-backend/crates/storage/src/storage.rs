use crate::device::Device;
use crate::error::{Result, StorageError};
use lazy_static::lazy_static;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

pub struct Storage;

lazy_static! {
    static ref DEVICES: RwLock<HashMap<String, Arc<dyn Device>>> = RwLock::new(HashMap::new());
}

impl Storage {
    pub const DEVICE_LOCAL: &'static str = "local";
    pub const DEVICE_S3: &'static str = "s3";
    pub const DEVICE_WASABI: &'static str = "wasabi";
    pub const DEVICE_MINIO: &'static str = "minio";

    pub fn set_device(name: &str, device: Arc<dyn Device>) {
        let mut devices = DEVICES.write().unwrap();
        devices.insert(name.to_string(), device);
    }

    pub fn get_device(name: &str) -> Result<Arc<dyn Device>> {
        let devices = DEVICES.read().unwrap();
        if let Some(device) = devices.get(name) {
            Ok(device.clone())
        } else {
            Err(StorageError::DeviceNotFound(name.to_string()))
        }
    }

    pub fn exists(name: &str) -> bool {
        let devices = DEVICES.read().unwrap();
        devices.contains_key(name)
    }

    pub fn human(bytes: usize, decimals: Option<usize>, system: Option<&str>) -> String {
        let thresh = if system == Some("binary") { 1024.0 } else { 1000.0 };
        let mut d_bytes = bytes as f64;

        if d_bytes < thresh {
            return format!("{}B", d_bytes);
        }

        let dec = decimals.unwrap_or(2);
        let units = if system == Some("binary") {
            vec!["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"]
        } else {
            vec!["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
        };

        let mut u = -1isize;
        let r = 10f64.powi(dec as i32);

        loop {
            d_bytes /= thresh;
            u += 1;
            if (d_bytes * r).round() / r < thresh || u as usize >= units.len() - 1 {
                break;
            }
        }

        format!("{:.*}{}", dec, d_bytes, units[u as usize])
    }
}
