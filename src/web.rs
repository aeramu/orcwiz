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
        .route("/files/read", get(read_file))
        .route("/git/status", get(git_status))
        .route("/git/diff", get(git_diff))
        .route("/git/add", post(git_add))
        .route("/git/unstage", post(git_unstage))
        .route("/git/restore", post(git_restore))
        .route("/git/commit", post(git_commit))
        .route("/git/init", post(git_init));

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
    assigned_agent: Option<String>,
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
                        assigned_agent: t.assigned_agent,
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
                assigned_agent: t.assigned_agent,
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
    assigned_agent: Option<String>,
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
        payload.assigned_agent.as_deref(),
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
    assigned_agent: Option<String>,
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

    let assigned_agent = payload.assigned_agent.as_ref().map(|s| {
        if s.is_empty() {
            None
        } else {
            Some(s.as_str())
        }
    });

    match state.db.update_task_details(
        id,
        payload.title.as_deref(),
        payload.project_path.as_deref(),
        payload.description.as_deref(),
        Some(payload.parent_id),
        assigned_agent,
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

#[derive(Deserialize)]
struct GitPathQuery {
    path: String,
}

#[derive(Deserialize)]
struct GitDiffQuery {
    path: String,
    file: String,
    staged: bool,
    untracked: Option<bool>,
}

#[derive(Deserialize)]
struct GitActionRequest {
    path: String,
    file: String,
}

#[derive(Deserialize)]
struct GitCommitRequest {
    path: String,
    message: String,
}

#[derive(serde::Serialize)]
struct GitFileStatus {
    name: String,
    path: String,
    status: String,
    staged: bool,
}

async fn git_status(
    axum::extract::Query(query): axum::extract::Query<GitPathQuery>,
) -> Result<Json<Vec<GitFileStatus>>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let resolved_path = resolve_absolute_path(&query.path);
    let path = std::path::Path::new(&resolved_path);
    if !path.exists() {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Path does not exist" })),
        ));
    }

    let output = tokio::process::Command::new("git")
        .arg("status")
        .arg("--porcelain")
        .current_dir(&resolved_path)
        .output()
        .await;

    match output {
        Ok(out) => {
            if !out.status.success() {
                let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
                if err_msg.contains("not a git repository") {
                    return Err((
                        axum::http::StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({ "error": "not_a_repo" })),
                    ));
                }
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": err_msg })),
                ));
            }

            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut file_statuses = Vec::new();

            for line in stdout.lines() {
                if line.len() < 4 {
                    continue;
                }
                let x = line.chars().nth(0).unwrap_or(' ');
                let y = line.chars().nth(1).unwrap_or(' ');
                let raw_path = &line[3..];
                
                let clean_path = if raw_path.contains(" -> ") {
                    raw_path.split(" -> ").last().unwrap_or(raw_path)
                } else {
                    raw_path
                };
                let clean_path = clean_path.trim_matches('"');
                let name = std::path::Path::new(clean_path)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| clean_path.to_string());

                // Untracked: X='?' Y='?'
                if x == '?' && y == '?' {
                    file_statuses.push(GitFileStatus {
                        name: name.clone(),
                        path: clean_path.to_string(),
                        status: "untracked".to_string(),
                        staged: false,
                    });
                    continue;
                }

                // Staged entry: X is not ' '
                if x != ' ' {
                    let status_str = match x {
                        'M' => "modified",
                        'A' => "added",
                        'D' => "deleted",
                        'R' => "renamed",
                        'C' => "copied",
                        'U' => "unmerged",
                        _ => "modified",
                    };
                    file_statuses.push(GitFileStatus {
                        name: name.clone(),
                        path: clean_path.to_string(),
                        status: status_str.to_string(),
                        staged: true,
                    });
                }

                // Unstaged entry: Y is not ' '
                if y != ' ' {
                    let status_str = match y {
                        'M' => "modified",
                        'D' => "deleted",
                        'U' => "unmerged",
                        _ => "modified",
                    };
                    file_statuses.push(GitFileStatus {
                        name: name.clone(),
                        path: clean_path.to_string(),
                        status: status_str.to_string(),
                        staged: false,
                    });
                }
            }

            Ok(Json(file_statuses))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn git_diff(
    axum::extract::Query(query): axum::extract::Query<GitDiffQuery>,
) -> Result<String, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let resolved_path = resolve_absolute_path(&query.path);
    
    // For untracked files, generate diff against empty
    if query.untracked.unwrap_or(false) {
        let file_path = std::path::Path::new(&resolved_path).join(&query.file);
        match std::fs::read_to_string(&file_path) {
            Ok(content) => {
                let mut diff = format!("diff --git a/{} b/{}\n", query.file, query.file);
                diff.push_str("new file mode 100644\n");
                diff.push_str("--- /dev/null\n");
                diff.push_str(&format!("+++ b/{}\n", query.file));
                let line_count = content.lines().count();
                diff.push_str(&format!("@@ -0,0 +1,{} @@\n", line_count));
                for line in content.lines() {
                    diff.push_str(&format!("+{}\n", line));
                }
                return Ok(diff);
            }
            Err(e) => {
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": format!("Failed to read untracked file: {}", e) })),
                ));
            }
        }
    }

    let mut cmd = tokio::process::Command::new("git");
    cmd.current_dir(&resolved_path);
    cmd.arg("diff");
    if query.staged {
        cmd.arg("--cached");
    }
    cmd.arg("--");
    cmd.arg(&query.file);

    match cmd.output().await {
        Ok(out) => {
            if !out.status.success() {
                let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": err_msg })),
                ));
            }
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            Ok(stdout)
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn git_add(
    Json(payload): Json<GitActionRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let resolved_path = resolve_absolute_path(&payload.path);
    let output = tokio::process::Command::new("git")
        .arg("add")
        .arg(&payload.file)
        .current_dir(&resolved_path)
        .output()
        .await;

    match output {
        Ok(out) => {
            if !out.status.success() {
                let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": err_msg })),
                ));
            }
            Ok(Json(serde_json::json!({ "success": true })))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn git_unstage(
    Json(payload): Json<GitActionRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let resolved_path = resolve_absolute_path(&payload.path);
    let output = tokio::process::Command::new("git")
        .arg("restore")
        .arg("--staged")
        .arg("--")
        .arg(&payload.file)
        .current_dir(&resolved_path)
        .output()
        .await;

    match output {
        Ok(out) => {
            if !out.status.success() {
                let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": err_msg })),
                ));
            }
            Ok(Json(serde_json::json!({ "success": true })))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn git_restore(
    Json(payload): Json<GitActionRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let resolved_path = resolve_absolute_path(&payload.path);
    let output = tokio::process::Command::new("git")
        .arg("restore")
        .arg("--")
        .arg(&payload.file)
        .current_dir(&resolved_path)
        .output()
        .await;

    match output {
        Ok(out) => {
            if !out.status.success() {
                let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": err_msg })),
                ));
            }
            Ok(Json(serde_json::json!({ "success": true })))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn git_commit(
    Json(payload): Json<GitCommitRequest>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let resolved_path = resolve_absolute_path(&payload.path);
    let output = tokio::process::Command::new("git")
        .arg("commit")
        .arg("-m")
        .arg(&payload.message)
        .current_dir(&resolved_path)
        .output()
        .await;

    match output {
        Ok(out) => {
            if !out.status.success() {
                let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
                return Err((
                    axum::http::StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": err_msg })),
                ));
            }
            Ok(Json(serde_json::json!({ "success": true })))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn git_init(
    Json(payload): Json<GitPathQuery>,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    let resolved_path = resolve_absolute_path(&payload.path);
    let output = tokio::process::Command::new("git")
        .arg("init")
        .current_dir(&resolved_path)
        .output()
        .await;

    match output {
        Ok(out) => {
            if !out.status.success() {
                let err_msg = String::from_utf8_lossy(&out.stderr).to_string();
                return Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": err_msg })),
                ));
            }
            Ok(Json(serde_json::json!({ "success": true })))
        }
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}
