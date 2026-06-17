use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::{get, post, put},
    Router, Json,
};
use rust_embed::RustEmbed;
use serde::Deserialize;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use crate::db::Db;

#[derive(RustEmbed)]
#[folder = "web/dist/"]
struct Asset;

async fn static_handler(uri: axum::http::Uri) -> axum::response::Response {
    let mut path = uri.path().trim_start_matches('/').to_string();

    if path.is_empty() {
        path = "index.html".to_string();
    }

    match Asset::get(path.as_str()) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(axum::http::header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => {
            if path != "index.html" {
                match Asset::get("index.html") {
                    Some(content) => {
                        let mime = mime_guess::from_path("index.html").first_or_octet_stream();
                        ([(axum::http::header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
                    }
                    None => (axum::http::StatusCode::NOT_FOUND, "404 Not Found").into_response()
                }
            } else {
                (axum::http::StatusCode::NOT_FOUND, "404 Not Found").into_response()
            }
        }
    }
}

struct AppState {
    db: Arc<Db>,
}

pub async fn start_server(db: Arc<Db>, port: u16) {
    let state = Arc::new(AppState { db });

    let api_routes = Router::new()
        .route("/tasks", get(list_tasks).post(add_task))
        .route("/tasks/:id", get(get_task).put(update_details).delete(delete_task))
        .route("/tasks/:id/status", put(update_status))
        .route("/tasks/:id/run", post(run_task));

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback(get(static_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!("Listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

async fn list_tasks(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<crate::db::Task>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    match state.db.list_tasks() {
        Ok(tasks) => Ok(Json(tasks)),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn get_task(
    Path(id): Path<i64>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<crate::db::Task>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    match state.db.get_task(id) {
        Ok(Some(task)) => Ok(Json(task)),
        Ok(None) => Err((
            axum::http::StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Task not found" })),
        )),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

#[derive(Deserialize)]
struct AddTaskRequest {
    title: String,
    project_path: String,
    description: Option<String>,
    parent_id: Option<i64>,
}

async fn add_task(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AddTaskRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    match state.db.add_task(
        &payload.title,
        &payload.project_path,
        payload.description.as_deref(),
        payload.parent_id,
    ) {
        Ok(id) => Ok(Json(serde_json::json!({ "id": id }))),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
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
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    match state.db.update_task_status(id, &payload.status) {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

#[derive(Deserialize)]
struct UpdateDetailsRequest {
    title: Option<String>,
    project_path: Option<String>,
    description: Option<String>,
    parent_id: Option<i64>,
}

async fn update_details(
    Path(id): Path<i64>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpdateDetailsRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    // Only allow update if status is backlog or failed
    let task = match state.db.get_task(id) {
        Ok(Some(t)) => t,
        Ok(None) => {
            return Err((
                axum::http::StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Task not found" })),
            ))
        }
        Err(e) => {
            return Err((
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            ))
        }
    };

    if task.status != "backlog" && task.status != "failed" {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Task can only be updated if it is in the backlog or failed state"
            })),
        ));
    }

    match state.db.update_task_details(
        id,
        payload.title.as_deref(),
        payload.project_path.as_deref(),
        payload.description.as_deref(),
        Some(payload.parent_id),
    ) {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn delete_task(
    Path(id): Path<i64>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let task = match state.db.get_task(id) {
        Ok(Some(t)) => t,
        Ok(None) => {
            return Err((
                axum::http::StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Task not found" })),
            ))
        }
        Err(e) => {
            return Err((
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            ))
        }
    };

    if task.status != "backlog" && task.status != "failed" {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Task can only be deleted if it is in the backlog or failed state"
            })),
        ));
    }

    match state.db.delete_task(id) {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn run_task(
    Path(id): Path<i64>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    // To run a task, we move it to "todo" status, and the background loop will pick it up
    match state.db.update_task_status(id, "todo") {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}
