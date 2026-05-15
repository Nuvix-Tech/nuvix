use std::sync::Arc;
use serde::{Deserialize, Serialize};
use crate::adapter::Adapter;
use crate::error::DatabaseError;
use crate::types::{CreateCollection, UpdateCollection, Collection, DatabaseOptions};
use crate::Doc;

pub struct Database {
    pub adapter: Arc<dyn Adapter>,
    pub options: Option<DatabaseOptions>,
}

impl Database {
    pub fn new(adapter: Arc<dyn Adapter>, options: Option<DatabaseOptions>) -> Self {
        Self { adapter, options }
    }

    pub async fn create(&self, database: Option<&str>) -> Result<(), DatabaseError> {
        if let Some(db_name) = database {
            self.adapter.create(db_name).await
        } else {
            Ok(())
        }
    }

    pub async fn exists(&self, database: Option<&str>, collection: Option<&str>) -> Result<bool, DatabaseError> {
        self.adapter.exists(database, collection).await
    }

    pub async fn list(&self) -> Result<Vec<String>, DatabaseError> {
        self.adapter.list_databases().await
    }

    pub async fn delete(&self, database: Option<&str>) -> Result<(), DatabaseError> {
        if let Some(db_name) = database {
            self.adapter.delete(db_name).await
        } else {
            Ok(())
        }
    }

    pub async fn create_collection(&self, options: CreateCollection) -> Result<Doc<Collection>, DatabaseError> {
        self.adapter.create_collection(options.clone()).await?;

        let collection = Collection {
            id: options.id.clone(),
            collection: options.id.clone(),
            schema: None,
            name: options.id,
            attributes: options.attributes.unwrap_or_default().into_iter().map(|d| d.data).collect(),
            indexes: options.indexes.unwrap_or_default().into_iter().map(|d| d.data).collect(),
            document_security: options.document_security.unwrap_or(false),
            enabled: options.enabled.unwrap_or(true),
        };
        Ok(Doc::new(collection))
    }

    pub async fn update_collection(&self, options: UpdateCollection) -> Result<Doc<Collection>, DatabaseError> {
        self.adapter.update_collection(
            &options.id,
            options.document_security,
            options.enabled.unwrap_or(true)
        ).await?;

        self.get_collection(&options.id, Some(true)).await
    }

    pub async fn get_collection(&self, id: &str, throw_on_not_found: Option<bool>) -> Result<Doc<Collection>, DatabaseError> {
        let result = self.adapter.get_collection(id).await?;
        match result {
            Some(value) => {
                let collection: Collection = serde_json::from_value(value)
                    .map_err(|e| DatabaseError::Other(format!("Failed to deserialize collection: {}", e)))?;
                Ok(Doc::new(collection))
            },
            None => {
                if throw_on_not_found.unwrap_or(false) {
                    Err(DatabaseError::NotFoundException(id.to_string()))
                } else {
                    Ok(Doc::new(Collection { id: "".to_string(), collection: "".to_string(), schema: None, name: "".to_string(), attributes: vec![], indexes: vec![], document_security: false, enabled: false }))
                }
            }
        }
    }

    pub async fn list_collections(&self, limit: Option<usize>, offset: Option<usize>) -> Result<Vec<Doc<Collection>>, DatabaseError> {
        let limit_val = limit.unwrap_or(25);
        let offset_val = offset.unwrap_or(0);
        let results = self.adapter.list_collections(limit_val, offset_val).await?;

        let collections = results.into_iter()
            .filter_map(|val| serde_json::from_value::<Collection>(val).ok())
            .map(Doc::new)
            .collect();

        Ok(collections)
    }

    pub async fn get_size_of_collection(&self, collection_id: &str) -> Result<i64, DatabaseError> {
        self.adapter.get_size_of_collection(collection_id).await
    }

    pub async fn get_size_of_collection_on_disk(&self, collection_id: &str) -> Result<i64, DatabaseError> {
        self.adapter.get_size_of_collection_on_disk(collection_id).await
    }

    pub async fn analyze_collection(&self, collection: &str) -> Result<bool, DatabaseError> {
        self.adapter.analyze_collection(collection).await
    }

    pub async fn create_document<D: Serialize + for<'a> Deserialize<'a>>(&self, collection_id: &str, document: D) -> Result<Doc<D>, DatabaseError> {
        let value = serde_json::to_value(&document)
            .map_err(|e| DatabaseError::Other(format!("Serialization error: {}", e)))?;

        let result = self.adapter.create_document(collection_id, value).await?;

        let deserialized: D = serde_json::from_value(result)
            .map_err(|e| DatabaseError::Other(format!("Deserialization error: {}", e)))?;

        Ok(Doc::new(deserialized))
    }

    pub async fn get_document<D: for<'a> Deserialize<'a>>(&self, collection_id: &str, id: &str) -> Result<Doc<D>, DatabaseError> {
        let result = self.adapter.get_document(collection_id, id).await?;
        match result {
            Some(value) => {
                let doc: D = serde_json::from_value(value)
                    .map_err(|e| DatabaseError::Other(format!("Deserialization error: {}", e)))?;
                Ok(Doc::new(doc))
            },
            None => Err(DatabaseError::NotFoundException(id.to_string())),
        }
    }

    pub async fn update_document<D: Serialize + for<'a> Deserialize<'a>>(&self, collection_id: &str, id: &str, document: D) -> Result<Doc<D>, DatabaseError> {
        let value = serde_json::to_value(&document)
            .map_err(|e| DatabaseError::Other(format!("Serialization error: {}", e)))?;

        let result = self.adapter.update_document(collection_id, id, value).await?;

        let deserialized: D = serde_json::from_value(result)
            .map_err(|e| DatabaseError::Other(format!("Deserialization error: {}", e)))?;

        Ok(Doc::new(deserialized))
    }

    pub async fn delete_document(&self, collection_id: &str, id: &str) -> Result<bool, DatabaseError> {
        self.adapter.delete_document(collection_id, id).await
    }

    pub async fn find<D: for<'a> Deserialize<'a>>(&self, collection_id: &str) -> Result<Vec<Doc<D>>, DatabaseError> {
        let results = self.adapter.find(collection_id).await?;

        let docs = results.into_iter()
            .filter_map(|val| serde_json::from_value::<D>(val).ok())
            .map(Doc::new)
            .collect();

        Ok(docs)
    }

    pub async fn create_attribute(&self, options: crate::types::CreateAttribute) -> Result<(), DatabaseError> {
        self.adapter.create_attribute(options).await
    }

    pub async fn create_attributes(&self, collection: &str, attributes: Vec<crate::types::CreateAttribute>) -> Result<(), DatabaseError> {
        self.adapter.create_attributes(collection, attributes).await
    }

    pub async fn rename_attribute(&self, collection: &str, old_name: &str, new_name: &str) -> Result<(), DatabaseError> {
        self.adapter.rename_attribute(collection, old_name, new_name).await
    }

    pub async fn delete_attribute(&self, collection: &str, name: &str) -> Result<(), DatabaseError> {
        self.adapter.delete_attribute(collection, name).await
    }

    pub async fn update_attribute(&self, options: crate::types::CreateAttribute) -> Result<(), DatabaseError> {
        self.adapter.update_attribute(options).await
    }

    pub async fn create_index(&self, options: crate::types::CreateIndex) -> Result<bool, DatabaseError> {
        self.adapter.create_index(options).await
    }

    pub async fn rename_index(&self, collection_id: &str, old_name: &str, new_name: &str) -> Result<bool, DatabaseError> {
        self.adapter.rename_index(collection_id, old_name, new_name).await
    }

    pub async fn create_relationship(
        &self,
        collection: &str,
        related_collection: &str,
        relation_type: crate::enums::RelationType,
        two_way: Option<bool>,
        id: Option<String>,
        two_way_key: Option<String>,
    ) -> Result<bool, DatabaseError> {
        self.adapter.create_relationship(collection, related_collection, relation_type, two_way, id, two_way_key).await
    }

    pub async fn update_relationship(
        &self,
        collection: &str,
        related_collection: &str,
        relation_type: crate::enums::RelationType,
        two_way: Option<bool>,
        key: &str,
        two_way_key: &str,
        side: crate::enums::RelationSide,
        new_key: Option<String>,
        new_two_way_key: Option<String>,
    ) -> Result<bool, DatabaseError> {
        self.adapter.update_relationship(collection, related_collection, relation_type, two_way, key, two_way_key, side, new_key, new_two_way_key).await
    }

    pub async fn delete_relationship(
        &self,
        collection: &str,
        related_collection: &str,
        relation_type: crate::enums::RelationType,
        two_way: bool,
        key: &str,
        two_way_key: &str,
        side: crate::enums::RelationSide,
    ) -> Result<bool, DatabaseError> {
        self.adapter.delete_relationship(collection, related_collection, relation_type, two_way, key, two_way_key, side).await
    }
}
