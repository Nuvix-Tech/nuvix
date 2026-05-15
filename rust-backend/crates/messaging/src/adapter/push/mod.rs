use crate::adapter::{Adapter, AdapterError, PushAdapter};
use crate::messages::Push;
use crate::types::{DeliveryResult, SendResult};
use async_trait::async_trait;

pub struct Fcm {
    pub service_account_json: String,
}

impl Fcm {
    pub fn new(service_account_json: String) -> Self {
        Self { service_account_json }
    }
}

#[async_trait]
impl Adapter for Fcm {
    fn name(&self) -> String {
        "FCM".to_string()
    }

    fn max_messages_per_request(&self) -> u32 {
        500
    }
}

#[async_trait]
impl PushAdapter for Fcm {
    async fn process(&self, message: &Push) -> Result<SendResult, AdapterError> {
        Ok(SendResult {
            delivered_to: message.to.len() as u32,
            r#type: "push".to_string(),
            results: message.to.iter().map(|recipient| DeliveryResult {
                recipient: recipient.clone(),
                status: "success".to_string(),
                error: None,
            }).collect(),
        })
    }
}

pub struct Apns {
    pub auth_key: String,
    pub auth_key_id: String,
    pub team_id: String,
    pub bundle_id: String,
    pub sandbox: bool,
}

impl Apns {
    pub fn new(auth_key: String, auth_key_id: String, team_id: String, bundle_id: String, sandbox: bool) -> Self {
        Self { auth_key, auth_key_id, team_id, bundle_id, sandbox }
    }
}

#[async_trait]
impl Adapter for Apns {
    fn name(&self) -> String {
        "APNS".to_string()
    }

    fn max_messages_per_request(&self) -> u32 {
        1000
    }
}

#[async_trait]
impl PushAdapter for Apns {
    async fn process(&self, message: &Push) -> Result<SendResult, AdapterError> {
        Ok(SendResult {
            delivered_to: message.to.len() as u32,
            r#type: "push".to_string(),
            results: message.to.iter().map(|recipient| DeliveryResult {
                recipient: recipient.clone(),
                status: "success".to_string(),
                error: None,
            }).collect(),
        })
    }
}
