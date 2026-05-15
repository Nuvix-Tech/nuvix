use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AttributeType {
    String,
    Integer,
    Float,
    Boolean,
    Timestamptz,
    Jsonb,
    Relationship,
    Virtual,
    Uuid,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RelationSide {
    Parent,
    Child,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OnDelete {
    Cascade,
    SetNull,
    Restrict,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IndexType {
    Unique,
    Key,
    Fulltext,
    Spatial,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RelationType {
    OneToOne,
    OneToMany,
    ManyToOne,
    ManyToMany,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum Order {
    #[serde(rename = "ASC")]
    Asc,
    #[serde(rename = "DESC")]
    Desc,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionType {
    Create,
    Read,
    Update,
    Delete,
    Write,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Events {
    #[serde(rename = "*")]
    All,
    DatabaseList,
    DatabaseCreate,
    DatabaseDelete,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QueryType {
    Equal,
    NotEqual,
    LessThan,
    LessThanEqual,
    GreaterThan,
    GreaterThanEqual,
    Contains,
    NotContains,
    Search,
    NotSearch,
    IsNull,
    IsNotNull,
    Between,
    NotBetween,
    StartsWith,
    NotStartsWith,
    NotEndsWith,
    EndsWith,
    Select,
    OrderDesc,
    OrderAsc,
    Limit,
    Offset,
    CursorAfter,
    CursorBefore,
    Or,
    And,
}
