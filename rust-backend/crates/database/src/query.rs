use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::enums::QueryType;

/// Represents a single query operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Query {
    pub method: QueryType,
    pub attribute: Option<String>,
    pub values: Vec<Value>,
}

impl Query {
    pub fn new(method: QueryType, attribute: Option<String>, values: Vec<Value>) -> Self {
        Self {
            method,
            attribute,
            values,
        }
    }
}

/// A builder for constructing a list of queries.
#[derive(Debug, Clone, Default)]
pub struct QueryBuilder {
    queries: Vec<Query>,
}

impl QueryBuilder {
    pub fn new() -> Self {
        Self {
            queries: Vec::new(),
        }
    }

    /// Creates a new QueryBuilder instance from an existing array of Query objects.
    pub fn from(queries: Vec<Query>) -> Self {
        Self { queries }
    }

    /// Adds an equality condition.
    pub fn equal<T: Serialize>(mut self, attribute: &str, value: T) -> Result<Self, serde_json::Error> {
        let v = serde_json::to_value(value)?;
        self.queries.push(Query::new(
            QueryType::Equal,
            Some(attribute.to_string()),
            vec![v],
        ));
        Ok(self)
    }

    /// Adds a not equal condition.
    pub fn not_equal<T: Serialize>(mut self, attribute: &str, value: T) -> Result<Self, serde_json::Error> {
        let v = serde_json::to_value(value)?;
        self.queries.push(Query::new(
            QueryType::NotEqual,
            Some(attribute.to_string()),
            vec![v],
        ));
        Ok(self)
    }

    /// Returns the built queries.
    pub fn build(self) -> Vec<Query> {
        self.queries
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_builder() {
        let builder = QueryBuilder::new()
            .equal("status", "active").unwrap()
            .not_equal("role", "guest").unwrap();

        let queries = builder.build();

        assert_eq!(queries.len(), 2);
        assert_eq!(queries[0].method, QueryType::Equal);
        assert_eq!(queries[0].attribute.as_deref(), Some("status"));
        assert_eq!(queries[0].values[0], serde_json::Value::String("active".to_string()));

        assert_eq!(queries[1].method, QueryType::NotEqual);
        assert_eq!(queries[1].attribute.as_deref(), Some("role"));
        assert_eq!(queries[1].values[0], serde_json::Value::String("guest".to_string()));
    }
}
