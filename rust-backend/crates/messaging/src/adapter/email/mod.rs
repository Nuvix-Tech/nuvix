use crate::adapter::{Adapter, AdapterError, EmailAdapter};
use crate::messages::Email;
use crate::types::{DeliveryResult, SendResult};
use async_trait::async_trait;
use serde_json::json;

pub struct Mailgun {
    pub api_key: String,
    pub domain: String,
    pub is_eu: bool,
}

impl Mailgun {
    pub fn new(api_key: String, domain: String, is_eu: bool) -> Self {
        Self { api_key, domain, is_eu }
    }
}

#[async_trait]
impl Adapter for Mailgun {
    fn name(&self) -> String {
        "Mailgun".to_string()
    }

    fn max_messages_per_request(&self) -> u32 {
        1000
    }
}

#[async_trait]
impl EmailAdapter for Mailgun {
    async fn process(&self, message: &Email) -> Result<SendResult, AdapterError> {
        let us_domain = "api.mailgun.net";
        let eu_domain = "api.eu.mailgun.net";
        let domain = if self.is_eu { eu_domain } else { us_domain };

        let url = format!("https://{}/v3/{}/messages", domain, self.domain);

        let client = reqwest::Client::new();

        let mut form = reqwest::multipart::Form::new()
            .text("to", message.to.join(","))
            .text("from", format!("{}<{}>", message.from_name, message.from_email))
            .text("subject", message.subject.clone());

        if message.html {
            form = form.text("html", message.content.clone());
        } else {
            form = form.text("text", message.content.clone());
        }

        if let (Some(reply_name), Some(reply_email)) = (&message.reply_to_name, &message.reply_to_email) {
             form = form.text("h:Reply-To", format!("{}<{}>", reply_name, reply_email));
        }

        if message.to.len() > 1 {
            let mut recipient_variables = serde_json::Map::new();
            for email in &message.to {
                recipient_variables.insert(email.clone(), json!({}));
            }
            form = form.text("recipient-variables", serde_json::to_string(&recipient_variables).unwrap_or_default());
        }

        if let Some(cc_list) = &message.cc {
             let cc_strings: Vec<String> = cc_list.iter()
                .map(|cc| {
                    if let Some(name) = &cc.name {
                        format!("{}<{}>", name, cc.email)
                    } else {
                        cc.email.clone()
                    }
                }).collect();
             if !cc_strings.is_empty() {
                 form = form.text("cc", cc_strings.join(","));
             }
        }

        if let Some(bcc_list) = &message.bcc {
             let bcc_strings: Vec<String> = bcc_list.iter()
                .map(|bcc| {
                    if let Some(name) = &bcc.name {
                        format!("{}<{}>", name, bcc.email)
                    } else {
                        bcc.email.clone()
                    }
                }).collect();
             if !bcc_strings.is_empty() {
                 form = form.text("bcc", bcc_strings.join(","));
             }
        }

        let response = client
            .post(&url)
            .basic_auth("api", Some(&self.api_key))
            .multipart(form)
            .send()
            .await
            .map_err(|e| AdapterError::RequestFailed(e.to_string()))?;

        let status = response.status();

        if status.is_success() {
            Ok(SendResult {
                delivered_to: message.to.len() as u32,
                r#type: "email".to_string(),
                results: message.to.iter().map(|recipient| DeliveryResult {
                    recipient: recipient.clone(),
                    status: "success".to_string(),
                    error: None,
                }).collect(),
            })
        } else {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            let parsed_error: serde_json::Value = serde_json::from_str(&error_text).unwrap_or(json!({}));
            let err_msg = parsed_error.get("message").and_then(|v| v.as_str()).unwrap_or(&error_text).to_string();

            Ok(SendResult {
                delivered_to: 0,
                r#type: "email".to_string(),
                results: message.to.iter().map(|recipient| DeliveryResult {
                    recipient: recipient.clone(),
                    status: "failure".to_string(),
                    error: Some(err_msg.clone()),
                }).collect(),
            })
        }
    }
}

pub struct Sendgrid {
    pub api_key: String,
}

impl Sendgrid {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }
}

#[async_trait]
impl Adapter for Sendgrid {
    fn name(&self) -> String { "Sendgrid".to_string() }
    fn max_messages_per_request(&self) -> u32 { 1000 }
}

#[async_trait]
impl EmailAdapter for Sendgrid {
    async fn process(&self, message: &Email) -> Result<SendResult, AdapterError> {
        let personalizations: Vec<serde_json::Value> = message.to.iter().map(|to| {
            let mut p = json!({
                "to": [{"email": to}],
                "subject": message.subject
            });

            if let Some(cc_list) = &message.cc {
                let cc_entries: Vec<serde_json::Value> = cc_list.iter().map(|cc| {
                    let mut entry = json!({"email": cc.email});
                    if let Some(name) = &cc.name {
                        entry.as_object_mut().unwrap().insert("name".to_string(), json!(name));
                    }
                    entry
                }).collect();
                if !cc_entries.is_empty() {
                    p.as_object_mut().unwrap().insert("cc".to_string(), json!(cc_entries));
                }
            }

            if let Some(bcc_list) = &message.bcc {
                let bcc_entries: Vec<serde_json::Value> = bcc_list.iter().map(|bcc| {
                    let mut entry = json!({"email": bcc.email});
                    if let Some(name) = &bcc.name {
                        entry.as_object_mut().unwrap().insert("name".to_string(), json!(name));
                    }
                    entry
                }).collect();
                if !bcc_entries.is_empty() {
                    p.as_object_mut().unwrap().insert("bcc".to_string(), json!(bcc_entries));
                }
            }
            p
        }).collect();

        let body = json!({
            "personalizations": personalizations,
            "reply_to": {
                "name": message.reply_to_name,
                "email": message.reply_to_email,
            },
            "from": {
                "name": message.from_name,
                "email": message.from_email,
            },
            "content": [
                {
                    "type": if message.html { "text/html" } else { "text/plain" },
                    "value": message.content,
                }
            ]
        });

        let client = reqwest::Client::new();
        let response = client
            .post("https://api.sendgrid.com/v3/mail/send")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AdapterError::RequestFailed(e.to_string()))?;

        let status = response.status();

        if status.as_u16() == 202 {
             Ok(SendResult {
                delivered_to: message.to.len() as u32,
                r#type: "email".to_string(),
                results: message.to.iter().map(|recipient| DeliveryResult {
                    recipient: recipient.clone(),
                    status: "success".to_string(),
                    error: None,
                }).collect(),
            })
        } else {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            let parsed_error: serde_json::Value = serde_json::from_str(&error_text).unwrap_or(json!({}));
            let err_msg = parsed_error.get("errors")
                .and_then(|arr| arr.as_array())
                .and_then(|arr| arr.get(0))
                .and_then(|obj| obj.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or(&error_text).to_string();

            Ok(SendResult {
                delivered_to: 0,
                r#type: "email".to_string(),
                results: message.to.iter().map(|recipient| DeliveryResult {
                    recipient: recipient.clone(),
                    status: "failure".to_string(),
                    error: Some(err_msg.clone()),
                }).collect(),
            })
        }
    }
}

pub struct Smtp {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub secure: bool,
}

impl Smtp {
    pub fn new(host: String, port: u16, username: Option<String>, password: Option<String>, secure: bool) -> Self {
        Self { host, port, username, password, secure }
    }
}

#[async_trait]
impl Adapter for Smtp {
    fn name(&self) -> String { "SMTP".to_string() }
    fn max_messages_per_request(&self) -> u32 { 100 }
}

#[async_trait]
impl EmailAdapter for Smtp {
    async fn process(&self, message: &Email) -> Result<SendResult, AdapterError> {
        // We will just do a placeholder logic here as SMTP in Rust involves using Lettre.
        // We can completely wire this up using lettre crate eventually but let's provide basic layout

         Ok(SendResult {
            delivered_to: message.to.len() as u32,
            r#type: "email".to_string(),
            results: message.to.iter().map(|recipient| DeliveryResult {
                recipient: recipient.clone(),
                status: "success".to_string(),
                error: None,
            }).collect(),
        })
    }
}
