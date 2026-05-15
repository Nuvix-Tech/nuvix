use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::enums::{AttributeType, RelationType, RelationSide, OnDelete, IndexType};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttributeOptions {
    pub relation_type: RelationType,
    pub side: RelationSide,
    pub related_collection: String,
    pub two_way: Option<bool>,
    pub two_way_key: Option<String>,
    pub on_delete: Option<OnDelete>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Attribute {
    #[serde(rename = "$id")]
    pub id: String,
    pub key: String,
    #[serde(rename = "type")]
    pub attribute_type: AttributeType,
    pub size: Option<i32>,
    pub required: Option<bool>,
    pub array: Option<bool>,
    pub filters: Option<Vec<String>>,
    pub format: Option<String>,
    pub format_options: Option<Value>, // Value since it's Record<string, any>
    pub default: Option<Value>, // any
    pub options: Option<Value>, // AttributeOptions | Record<string, any> -> keep as Value for flexibility or a custom enum
    #[serde(rename = "__type")]
    pub __type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    #[serde(rename = "$id")]
    pub id: String,
    pub key: Option<String>,
    #[serde(rename = "type")]
    pub index_type: IndexType,
    pub attributes: Option<Vec<String>>,
    pub orders: Option<Vec<Option<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    #[serde(rename = "$id")]
    pub id: String,
    #[serde(rename = "$collection")]
    pub collection: String,
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
    pub name: String,
    pub attributes: Vec<Attribute>,
    pub indexes: Vec<Index>,
    pub document_security: bool,
    pub enabled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collection_serialization() {
        let json_data = r#"{
            "$id": "col_123",
            "$collection": "users",
            "name": "Users",
            "attributes": [
                {
                    "$id": "attr_1",
                    "key": "email",
                    "type": "string",
                    "required": true
                }
            ],
            "indexes": [
                {
                    "$id": "idx_1",
                    "key": "email_idx",
                    "type": "unique",
                    "attributes": ["email"]
                }
            ],
            "documentSecurity": true,
            "enabled": true
        }"#;

        let collection: Collection = serde_json::from_str(json_data).unwrap();

        assert_eq!(collection.id, "col_123");
        assert_eq!(collection.collection, "users");
        assert_eq!(collection.name, "Users");
        assert_eq!(collection.attributes.len(), 1);
        assert_eq!(collection.attributes[0].id, "attr_1");
        assert_eq!(collection.attributes[0].key, "email");
        assert_eq!(collection.attributes[0].attribute_type, AttributeType::String);
        assert_eq!(collection.indexes.len(), 1);
        assert_eq!(collection.indexes[0].id, "idx_1");
        assert_eq!(collection.indexes[0].index_type, IndexType::Unique);
        assert!(collection.document_security);

        let serialized = serde_json::to_string(&collection).unwrap();
        assert!(serialized.contains("\"$id\":\"col_123\""));
        assert!(serialized.contains("\"$collection\":\"users\""));
        assert!(serialized.contains("\"documentSecurity\":true"));
    }
}
