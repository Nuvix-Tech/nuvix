use crate::types::{Attachment, Priority};
use serde::{Deserialize, Serialize};

pub trait Message {
    fn get_to(&self) -> Vec<String>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailRecipient {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Email {
    pub to: Vec<String>,
    pub subject: String,
    pub content: String,
    pub from_name: String,
    pub from_email: String,
    pub reply_to_name: Option<String>,
    pub reply_to_email: Option<String>,
    pub cc: Option<Vec<EmailRecipient>>,
    pub bcc: Option<Vec<EmailRecipient>>,
    pub attachments: Option<Vec<Attachment>>,
    pub html: bool,
    pub default_recipient: Option<String>,
}

impl Message for Email {
    fn get_to(&self) -> Vec<String> {
        self.to.clone()
    }
}

impl Email {
    pub fn new(
        to: Vec<String>,
        subject: String,
        content: String,
        from_name: String,
        from_email: String,
    ) -> Self {
        Self {
            to,
            subject,
            content,
            from_name,
            from_email,
            reply_to_name: None,
            reply_to_email: None,
            cc: None,
            bcc: None,
            attachments: None,
            html: false,
            default_recipient: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sms {
    pub to: Vec<String>,
    pub content: String,
    pub from: Option<String>,
    pub attachments: Option<Vec<String>>,
}

impl Message for Sms {
    fn get_to(&self) -> Vec<String> {
        self.to.clone()
    }
}

impl Sms {
    pub fn new(to: Vec<String>, content: String) -> Self {
        Self {
            to,
            content,
            from: None,
            attachments: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Push {
    pub to: Vec<String>,
    pub title: Option<String>,
    pub body: Option<String>,
    pub data: Option<serde_json::Value>,
    pub action: Option<String>,
    pub sound: Option<String>,
    pub image: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub tag: Option<String>,
    pub badge: Option<i32>,
    pub content_available: Option<bool>,
    pub critical: Option<bool>,
    pub priority: Option<Priority>,
}

impl Message for Push {
    fn get_to(&self) -> Vec<String> {
        self.to.clone()
    }
}

impl Push {
    pub fn new(to: Vec<String>) -> Self {
        Self {
            to,
            title: None,
            body: None,
            data: None,
            action: None,
            sound: None,
            image: None,
            icon: None,
            color: None,
            tag: None,
            badge: None,
            content_available: None,
            critical: None,
            priority: None,
        }
    }
}
