use axum::{
    extract::{Path, State},
    routing::{get, post, put},
    Router, Json,
};
use serde::Deserialize;
use std::sync::Arc;
use tower_http::services::ServeDir;
use tower_http::cors::CorsLayer;

use crate::db::Db;

struct AppState {
    db: Arc<Db>,
}

pub async fn start_server(db: Arc<Db>, port: u16) {
    let state = Arc::new(AppState { db });

    let api_routes = Router::new()
        .route("/tasks", get(list_tasks).post(add_task))
        .route("/tasks/:id/status", put(update_status))
        .route("/tasks/:id/run", post(run_task));

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(ServeDir::new("web/dist"))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!("Listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

async fn list_tasks(State(state): State<Arc<AppState>>) -> Json<Vec<crate::db::Task>> {
    let tasks = state.db.list_tasks().unwrap_or_default();
    Json(tasks)
}

#[derive(Deserialize)]
struct AddTaskRequest {
    title: String,
    project_path: String,
    description: Option<String>,
}

async fn add_task(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AddTaskRequest>,
) -> Json<serde_json::Value> {
    match state.db.add_task(&payload.title, &payload.project_path, payload.description.as_deref()) {
        Ok(id) => Json(serde_json::json!({ "id": id })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct UpdateStatusRequest {
    status: String,
}

async fn update_status(
    Path(id): Path<i64>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateStatusRequest>,
) -> Json<serde_json::Value> {
    match state.db.update_task_status(id, &payload.status) {
        Ok(_) => Json(serde_json::json!({ "success": true })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}

async fn run_task(
    Path(id): Path<i64>,
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    // To run a task, we move it to "todo" status, and the background loop will pick it up
    match state.db.update_task_status(id, "todo") {
        Ok(_) => Json(serde_json::json!({ "success": true })),
        Err(e) => Json(serde_json::json!({ "error": e.to_string() })),
    }
}
