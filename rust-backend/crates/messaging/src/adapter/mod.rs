use crate::messages::{Email, Push, Sms};
use crate::types::SendResult;
use async_trait::async_trait;
use reqwest::{Client, Method};
use serde_json::Value;
use std::time::Duration;
use thiserror::Error;

pub const DEFAULT_TIMEOUT_SECONDS: u64 = 60;

#[derive(Error, Debug)]
pub enum AdapterError {
    #[error("HTTP request failed: {0}")]
    RequestFailed(String),
    #[error("Configuration error: {0}")]
    ConfigError(String),
    #[error("Missing argument: {0}")]
    MissingArgument(String),
}

#[async_trait]
pub trait Adapter: Send + Sync {
    fn name(&self) -> String;
    fn max_messages_per_request(&self) -> u32;

    async fn request(
        &self,
        method: Method,
        url: &str,
        headers: reqwest::header::HeaderMap,
        body: Option<Value>,
        timeout_secs: Option<u64>,
    ) -> Result<reqwest::Response, AdapterError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECONDS)))
            .build()
            .map_err(|e| AdapterError::RequestFailed(e.to_string()))?;

        let mut request_builder = client.request(method, url).headers(headers);

        if let Some(b) = body {
            request_builder = request_builder.json(&b);
        }

        request_builder
            .send()
            .await
            .map_err(|e| AdapterError::RequestFailed(e.to_string()))
    }
}

#[async_trait]
pub trait EmailAdapter: Adapter {
    async fn process(&self, message: &Email) -> Result<SendResult, AdapterError>;
}

#[async_trait]
pub trait SmsAdapter: Adapter {
    async fn process(&self, message: &Sms) -> Result<SendResult, AdapterError>;
}

#[async_trait]
pub trait PushAdapter: Adapter {
    async fn process(&self, message: &Push) -> Result<SendResult, AdapterError>;
}

pub mod email;
pub mod push;
pub mod sms;
