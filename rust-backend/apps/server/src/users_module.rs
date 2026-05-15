use axum::Json;
use axum::{routing::get, Router};
use utils::ApiResponse;

async fn get_users() -> Json<ApiResponse<Vec<String>>> {
    Json(ApiResponse::success(vec![]))
}

pub fn router() -> Router {
    Router::new().route("/", get(get_users))
}
