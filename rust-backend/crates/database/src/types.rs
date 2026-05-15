use serde::{Deserialize, Serialize};
use crate::enums::{RelationType, RelationSide, OnDelete};

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
