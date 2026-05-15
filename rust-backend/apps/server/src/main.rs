mod users_module;
use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::net::SocketAddr;
use utils::ApiResponse;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn root() -> Json<ApiResponse<()>> {
    Json(ApiResponse::success(()))
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .nest("/users", users_module::router());

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    println!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
