#[cfg(test)]
mod tests {
    use crate::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_local_storage() {
        let root = "/tmp/nuvix_test_storage";
        std::fs::create_dir_all(root).unwrap();

        let local = Arc::new(Local::new(Some(root)));
        Storage::set_device(Storage::DEVICE_LOCAL, local.clone());

        let dev = Storage::get_device(Storage::DEVICE_LOCAL).unwrap();
        assert_eq!(dev.get_name(), "Local Storage");

        let content = bytes::Bytes::from("hello world");
        let path = "test_file.txt";

        dev.write(path, content.clone(), None).await.unwrap();
        assert!(dev.exists(path).await.unwrap());

        let read_content = dev.read(path, None, None).await.unwrap();
        assert_eq!(read_content, content);

        let size = dev.get_file_size(path).await.unwrap();
        assert_eq!(size, 11);

        dev.delete(path, None).await.unwrap();
        assert!(!dev.exists(path).await.unwrap());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn test_human_size() {
        assert_eq!(Storage::human(1024, None, None), "1.02kB");
        assert_eq!(Storage::human(1024, Some(0), Some("binary")), "1KiB");
        assert_eq!(Storage::human(1048576, Some(2), Some("binary")), "1.00MiB");
        assert_eq!(Storage::human(500, None, None), "500B");
    }

    #[tokio::test]
    async fn test_validators() {
        let file_name = FileName::new();
        assert!(file_name.is_valid("valid.txt").await);
        assert!(!file_name.is_valid("invalid-file.txt").await);

        let file_size = FileSize::new(1024);
        assert!(file_size.is_valid("500").await);
        assert!(!file_size.is_valid("2000").await);
    }
}
