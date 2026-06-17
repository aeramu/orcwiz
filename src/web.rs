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
    config: crate::config::Config,
}

pub async fn start_server(db: Arc<Db>, config: crate::config::Config) {
    let port = config.port;
    let state = Arc::new(AppState { db, config });

    let api_routes = Router::new()
        .route("/config", get(get_config))
        .route("/tasks", get(list_tasks).post(add_task))
        .route("/tasks/:id", get(get_task).put(update_details).delete(delete_task))
        .route("/tasks/:id/status", put(update_status))
        .route("/tasks/:id/run", post(run_task))
        .route("/files", get(list_files).put(write_file))
        .route("/files/read", get(read_file));

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

async fn get_config(
    State(state): State<Arc<AppState>>,
) -> impl axum::response::IntoResponse {
    let username = std::env::var("OPENCODE_SERVER_USERNAME")
        .unwrap_or_else(|_| "opencode".to_string());
    let auth_header = std::env::var("OPENCODE_SERVER_PASSWORD").ok().map(|password| {
        use base64::Engine;
        let auth_str = format!("{}:{}", username, password);
        let encoded = base64::engine::general_purpose::STANDARD.encode(auth_str);
        format!("Basic {}", encoded)
    });

    axum::Json(serde_json::json!({
        "opencode_server_url": state.config.opencode_server_url,
        "opencode_auth_header": auth_header,
    }))
}

#[derive(serde::Serialize)]
struct TaskResponse {
    id: i64,
    title: String,
    description: Option<String>,
    status: String,
    project_path: String,
    absolute_project_path: String,
    session_id: Option<String>,
    parent_id: Option<i64>,
    created_at: chrono::DateTime<chrono::Utc>,
}

fn resolve_absolute_path(project_path: &str) -> String {
    let resolved = if project_path.starts_with("~/") {
        if let Some(user_dirs) = directories::UserDirs::new() {
            user_dirs.home_dir().join(project_path.trim_start_matches("~/"))
        } else {
            std::path::PathBuf::from(project_path)
        }
    } else {
        let path = std::path::PathBuf::from(project_path);
        if path.is_absolute() {
            path
        } else {
            let config = crate::config::Config::load();
            config.projects_dir.join(path)
        }
    };
    resolved.to_string_lossy().to_string()
}

async fn list_tasks(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<TaskResponse>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    match state.db.list_tasks() {
        Ok(tasks) => {
            let res: Vec<TaskResponse> = tasks
                .into_iter()
                .map(|t| {
                    let abs_path = resolve_absolute_path(&t.project_path);
                    TaskResponse {
                        id: t.id,
                        title: t.title,
                        description: t.description,
                        status: t.status,
                        project_path: t.project_path,
                        absolute_project_path: abs_path,
                        session_id: t.session_id,
                        parent_id: t.parent_id,
                        created_at: t.created_at,
                    }
                })
                .collect();
            Ok(Json(res))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn get_task(
    Path(id): Path<i64>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<TaskResponse>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    match state.db.get_task(id) {
        Ok(Some(t)) => {
            let abs_path = resolve_absolute_path(&t.project_path);
            let res = TaskResponse {
                id: t.id,
                title: t.title,
                description: t.description,
                status: t.status,
                project_path: t.project_path,
                absolute_project_path: abs_path,
                session_id: t.session_id,
                parent_id: t.parent_id,
                created_at: t.created_at,
            };
            Ok(Json(res))
        }
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

#[derive(Deserialize)]
struct FilesQuery {
    path: String,
}

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

async fn list_files(
    axum::extract::Query(query): axum::extract::Query<FilesQuery>,
) -> Result<Json<Vec<FileEntry>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let path = std::path::Path::new(&query.path);
    if !path.exists() {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Path does not exist" })),
        ));
    }
    
    let mut entries = Vec::new();
    match std::fs::read_dir(path) {
        Ok(read_dir) => {
            for entry in read_dir {
                if let Ok(entry) = entry {
                    let metadata = entry.metadata().ok();
                    let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let name = entry.file_name().to_string_lossy().to_string();
                    
                    // Skip hidden files/dirs starting with . (except .gitignore)
                    if name.starts_with('.') && name != ".gitignore" {
                        continue;
                    }
                    
                    entries.push(FileEntry {
                        name,
                        path: entry.path().to_string_lossy().to_string(),
                        is_dir,
                        size,
                    });
                }
            }
            // Sort directories first, then files alphabetically
            entries.sort_by(|a, b| {
                if a.is_dir != b.is_dir {
                    b.is_dir.cmp(&a.is_dir)
                } else {
                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                }
            });
            Ok(Json(entries))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn read_file(
    axum::extract::Query(query): axum::extract::Query<FilesQuery>,
) -> Result<axum::response::Response, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let path = std::path::Path::new(&query.path);
    if !path.exists() {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "File not found" })),
        ));
    }
    if path.is_dir() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Path is a directory" })),
        ));
    }
    
    match std::fs::read_to_string(path) {
        Ok(content) => {
            Ok(content.into_response())
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

#[derive(Deserialize)]
struct WriteFileRequest {
    path: String,
    content: String,
}

async fn write_file(
    Json(payload): Json<WriteFileRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let path = std::path::Path::new(&payload.path);
    if path.is_dir() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Path is a directory" })),
        ));
    }
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("Failed to create parent directories: {}", e) })),
                ));
            }
        }
    }
    
    match std::fs::write(path, &payload.content) {
        Ok(_) => Ok(Json(serde_json::json!({ "success": true }))),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}
