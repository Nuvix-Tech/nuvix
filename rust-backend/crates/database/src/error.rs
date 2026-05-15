use thiserror::Error;

#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("Document exception: {0}")]
    DocException(String),

    #[error("Authorization exception: {0}")]
    AuthorizationException(String),

    #[error("Conflict exception: {0}")]
    ConflictException(String),

    #[error("Dependency exception: {0}")]
    DependencyException(String),

    #[error("Duplicate exception: {0}")]
    DuplicateException(String),

    #[error("Limit exception: {0}")]
    LimitException(String),

    #[error("Order exception: {0}")]
    OrderException(String),

    #[error("Not found exception: {0}")]
    NotFoundException(String),

    #[error("Query exception: {0}")]
    QueryException(String),

    #[error("Relationship exception: {0}")]
    RelationshipException(String),

    #[error("Restricted exception: {0}")]
    RestrictedException(String),

    #[error("Structure exception: {0}")]
    StructureException(String),

    #[error("Timeout exception: {0}")]
    TimeoutException(String),

    #[error("Transaction exception: {0}")]
    TransactionException(String),

    #[error("Truncate exception: {0}")]
    TruncateException(String),

    #[error("Index exception: {0}")]
    IndexException(String),

    #[error("Other database error: {0}")]
    Other(String),
}
