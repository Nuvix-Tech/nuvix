use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryResult {
    pub recipient: String,
    pub status: String, // "success" or "failure"
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendResult {
    pub delivered_to: u32,
    pub r#type: String,
    pub results: Vec<DeliveryResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestResponse<T> {
    pub url: String,
    pub status_code: u16,
    pub response: Option<T>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiRequestResponse<T> {
    pub index: usize,
    pub url: String,
    pub status_code: u16,
    pub response: Option<T>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    High,
    Normal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub name: String,
    pub path: String, // Represents path or content
    pub r#type: String,
    pub size: Option<u64>,
}
