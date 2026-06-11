use axum::{
    extract::{Path, State},
    response::Html,
    routing::get,
    Router, Json,
};
use std::sync::Arc;
use tokio::process::Command;

use crate::db::Db;

struct AppState {
    db: Arc<Db>,
}

pub async fn start_server(db: Arc<Db>, port: u16) {
    let state = Arc::new(AppState { db });

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions/:session_id/history", get(session_history))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();
    tracing::info!("Listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

async fn index_handler() -> Html<&'static str> {
    Html(r#"
        <!DOCTYPE html>
        <html>
        <head>
            <title>Orcwiz Sessions</title>
            <style>
                body { font-family: sans-serif; padding: 20px; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                .history { white-space: pre-wrap; background: #f4f4f4; padding: 10px; margin-top: 20px; border-radius: 5px; max-height: 500px; overflow-y: auto;}
            </style>
        </head>
        <body>
            <h1>Orcwiz Sessions</h1>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Task ID</th>
                        <th>Session ID</th>
                        <th>Project</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="sessions"></tbody>
            </table>
            
            <h2>Session History</h2>
            <div id="history" class="history">Select a session to view history...</div>

            <script>
                async function loadSessions() {
                    const res = await fetch('/api/sessions');
                    const sessions = await res.json();
                    const tbody = document.getElementById('sessions');
                    tbody.innerHTML = '';
                    for (const s of sessions) {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td>${s.id}</td>
                            <td>${s.linear_task_id}</td>
                            <td>${s.session_id || 'N/A'}</td>
                            <td>${s.project_path}</td>
                            <td>${s.status}</td>
                            <td>${new Date(s.created_at).toLocaleString()}</td>
                            <td>${s.session_id ? `<button onclick="viewHistory('${s.session_id}')">View History</button>` : ''}</td>
                        `;
                        tbody.appendChild(tr);
                    }
                }

                async function viewHistory(sessionId) {
                    const historyDiv = document.getElementById('history');
                    historyDiv.innerText = 'Loading...';
                    try {
                        const res = await fetch(`/api/sessions/${sessionId}/history`);
                        const data = await res.json();
                        historyDiv.innerText = JSON.stringify(data, null, 2);
                    } catch (e) {
                        historyDiv.innerText = 'Failed to load history or opencode export not configured correctly. ' + e;
                    }
                }

                loadSessions();
                setInterval(loadSessions, 5000);
            </script>
        </body>
        </html>
    "#)
}

async fn list_sessions(State(state): State<Arc<AppState>>) -> Json<Vec<crate::db::Session>> {
    let sessions = state.db.get_sessions().unwrap_or_default();
    Json(sessions)
}

async fn session_history(Path(session_id): Path<String>) -> Json<serde_json::Value> {
    // Attempt to run opencode export to get the session history
    let output = Command::new("opencode")
        .arg("export")
        .arg(&session_id)
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            // Check if opencode outputted json to stdout
            let out_str = String::from_utf8_lossy(&out.stdout);
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&out_str) {
                return Json(json);
            }
            // If it outputs to a file, we might need to find it and read it.
            // For now, return the stdout
            Json(serde_json::json!({ "output": out_str.to_string() }))
        }
        Ok(out) => {
            Json(serde_json::json!({ "error": "opencode export failed", "stderr": String::from_utf8_lossy(&out.stderr).to_string() }))
        }
        Err(e) => {
            Json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}
