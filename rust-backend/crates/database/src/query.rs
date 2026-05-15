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

    pub fn less_than<T: Serialize>(mut self, attribute: &str, value: T) -> Result<Self, serde_json::Error> {
        let v = serde_json::to_value(value)?;
        self.queries.push(Query::new(QueryType::LessThan, Some(attribute.to_string()), vec![v]));
        Ok(self)
    }

    pub fn less_than_equal<T: Serialize>(mut self, attribute: &str, value: T) -> Result<Self, serde_json::Error> {
        let v = serde_json::to_value(value)?;
        self.queries.push(Query::new(QueryType::LessThanEqual, Some(attribute.to_string()), vec![v]));
        Ok(self)
    }

    pub fn greater_than<T: Serialize>(mut self, attribute: &str, value: T) -> Result<Self, serde_json::Error> {
        let v = serde_json::to_value(value)?;
        self.queries.push(Query::new(QueryType::GreaterThan, Some(attribute.to_string()), vec![v]));
        Ok(self)
    }

    pub fn greater_than_equal<T: Serialize>(mut self, attribute: &str, value: T) -> Result<Self, serde_json::Error> {
        let v = serde_json::to_value(value)?;
        self.queries.push(Query::new(QueryType::GreaterThanEqual, Some(attribute.to_string()), vec![v]));
        Ok(self)
    }

    pub fn contains<T: Serialize>(mut self, attribute: &str, values: Vec<T>) -> Result<Self, serde_json::Error> {
        let v: Result<Vec<Value>, _> = values.into_iter().map(serde_json::to_value).collect();
        self.queries.push(Query::new(QueryType::Contains, Some(attribute.to_string()), v?));
        Ok(self)
    }

    pub fn search(mut self, attribute: &str, value: &str) -> Self {
        self.queries.push(Query::new(QueryType::Search, Some(attribute.to_string()), vec![Value::String(value.to_string())]));
        self
    }

    pub fn is_null(mut self, attribute: &str) -> Self {
        self.queries.push(Query::new(QueryType::IsNull, Some(attribute.to_string()), vec![]));
        self
    }

    pub fn is_not_null(mut self, attribute: &str) -> Self {
        self.queries.push(Query::new(QueryType::IsNotNull, Some(attribute.to_string()), vec![]));
        self
    }

    pub fn limit(mut self, limit: usize) -> Self {
        self.queries.push(Query::new(QueryType::Limit, None, vec![serde_json::to_value(limit).unwrap()]));
        self
    }

    pub fn offset(mut self, offset: usize) -> Self {
        self.queries.push(Query::new(QueryType::Offset, None, vec![serde_json::to_value(offset).unwrap()]));
        self
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
            .not_equal("role", "guest").unwrap()
            .limit(10);

        let queries = builder.build();

        assert_eq!(queries.len(), 3);
        assert_eq!(queries[0].method, QueryType::Equal);
        assert_eq!(queries[0].attribute.as_deref(), Some("status"));
        assert_eq!(queries[0].values[0], serde_json::Value::String("active".to_string()));

        assert_eq!(queries[1].method, QueryType::NotEqual);
        assert_eq!(queries[1].attribute.as_deref(), Some("role"));
        assert_eq!(queries[1].values[0], serde_json::Value::String("guest".to_string()));

        assert_eq!(queries[2].method, QueryType::Limit);
        assert_eq!(queries[2].attribute, None);
        assert_eq!(queries[2].values[0], serde_json::Value::Number(10.into()));
    }
}
