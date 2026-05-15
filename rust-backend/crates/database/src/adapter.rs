use crate::error::DatabaseError;
use crate::types::{CreateCollection, CreateAttribute, CreateIndex, Attribute};
use crate::enums::{RelationType, RelationSide};
use crate::Doc;
use serde_json::Value;

#[async_trait::async_trait]
pub trait Adapter: Send + Sync {
    async fn create(&self, name: &str) -> Result<(), DatabaseError>;
    async fn delete(&self, name: &str) -> Result<(), DatabaseError>;
    async fn exists(&self, database: Option<&str>, collection: Option<&str>) -> Result<bool, DatabaseError>;
    async fn list_databases(&self) -> Result<Vec<String>, DatabaseError>;

    async fn create_collection(&self, options: CreateCollection) -> Result<(), DatabaseError>;
    async fn update_collection(&self, collection: &str, document_security: bool, enabled: bool) -> Result<(), DatabaseError>;
    async fn get_collection(&self, id: &str) -> Result<Option<Value>, DatabaseError>;
    async fn list_collections(&self, limit: usize, offset: usize) -> Result<Vec<Value>, DatabaseError>;

    async fn get_size_of_collection_on_disk(&self, collection: &str) -> Result<i64, DatabaseError>;
    async fn get_size_of_collection(&self, collection: &str) -> Result<i64, DatabaseError>;
    async fn delete_collection(&self, id: &str) -> Result<(), DatabaseError>;
    async fn analyze_collection(&self, collection: &str) -> Result<bool, DatabaseError>;

    async fn create_attribute(&self, options: CreateAttribute) -> Result<(), DatabaseError>;
    async fn create_attributes(&self, collection: &str, attributes: Vec<CreateAttribute>) -> Result<(), DatabaseError>;
    async fn rename_attribute(&self, collection: &str, old_name: &str, new_name: &str) -> Result<(), DatabaseError>;
    async fn delete_attribute(&self, collection: &str, name: &str) -> Result<(), DatabaseError>;
    async fn get_schema_attributes(&self, collection: &str) -> Result<Vec<Doc<Attribute>>, DatabaseError>;
    async fn update_attribute(&self, options: CreateAttribute) -> Result<(), DatabaseError>;

    async fn create_relationship(
        &self,
        collection: &str,
        related_collection: &str,
        relation_type: RelationType,
        two_way: Option<bool>,
        id: Option<String>,
        two_way_key: Option<String>,
    ) -> Result<bool, DatabaseError>;

    async fn update_relationship(
        &self,
        collection: &str,
        related_collection: &str,
        relation_type: RelationType,
        two_way: Option<bool>,
        key: &str,
        two_way_key: &str,
        side: RelationSide,
        new_key: Option<String>,
        new_two_way_key: Option<String>,
    ) -> Result<bool, DatabaseError>;

    async fn delete_relationship(
        &self,
        collection: &str,
        related_collection: &str,
        relation_type: RelationType,
        two_way: bool,
        key: &str,
        two_way_key: &str,
        side: RelationSide,
    ) -> Result<bool, DatabaseError>;

    async fn rename_index(&self, collection_id: &str, old_name: &str, new_name: &str) -> Result<bool, DatabaseError>;
    async fn create_index(&self, options: CreateIndex) -> Result<bool, DatabaseError>;

    // Document operations
    async fn create_document(&self, collection: &str, document: Value) -> Result<Value, DatabaseError>;
    async fn get_document(&self, collection: &str, id: &str) -> Result<Option<Value>, DatabaseError>;
    async fn update_document(&self, collection: &str, id: &str, document: Value) -> Result<Value, DatabaseError>;
    async fn delete_document(&self, collection: &str, id: &str) -> Result<bool, DatabaseError>;
    async fn find(&self, collection: &str) -> Result<Vec<Value>, DatabaseError>;
}
