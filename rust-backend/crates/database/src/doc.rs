use serde::{Deserialize, Serialize};

/// Represents a document in the database, encapsulating data of type `T`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Doc<T> {
    #[serde(flatten)]
    pub data: T,
}

impl<T> Doc<T> {
    /// Creates a new Doc instance containing the provided data.
    pub fn new(data: T) -> Self {
        Self { data }
    }
}
