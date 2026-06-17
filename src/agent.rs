use std::path::Path;
use tokio::process::Command;
use tracing::{info, warn};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentStatus {
    Running,
    Success,
    Failed(String),
}

fn is_pid_running(pid: u32) -> bool {
    let mut cmd = std::process::Command::new("kill");
    cmd.arg("-0").arg(pid.to_string());
    if let Ok(status) = cmd.status() {
        status.success()
    } else {
        false
    }
}

pub trait Agent: Send + Sync {
    /// Starts the agent execution for a task in the background.
    /// Returns a session identifier (e.g. PID or OpenCode session ID).
    async fn start_task(
        &self,
        task_id: i64,
        project_path: &Path,
        title: &str,
        description: &str,
        on_complete: Box<dyn FnOnce(AgentStatus) + Send + 'static>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>>;

    /// Checks the current status of a running task by session ID.
    async fn check_status(
        &self,
        session_id: &str,
        project_path: &Path,
    ) -> Result<AgentStatus, Box<dyn std::error::Error + Send + Sync>>;
}

pub struct GenericCliAgent {
    command_template: String,
}

impl GenericCliAgent {
    pub fn new(command_template: String) -> Self {
        Self { command_template }
    }
}

impl Agent for GenericCliAgent {
    async fn start_task(
        &self,
        task_id: i64,
        project_path: &Path,
        title: &str,
        description: &str,
        on_complete: Box<dyn FnOnce(AgentStatus) + Send + 'static>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let prompt = format!("Task: {}\nDescription: {}", title, description);
        let run_cmd = self.command_template.replace("{prompt}", &prompt);

        info!("Spawning generic CLI command in background: {}", run_cmd);
        
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(&run_cmd)
            .current_dir(project_path)
            .spawn()?;

        let pid = child.id().ok_or("Failed to get spawned process ID")?;
        let session_id = format!("pid_{}_task_{}", pid, task_id);
        
        tokio::spawn(async move {
            let status = match child.wait().await {
                Ok(s) => {
                    if s.success() {
                        AgentStatus::Success
                    } else {
                        AgentStatus::Failed(format!("Exited with code {}", s.code().unwrap_or(-1)))
                    }
                }
                Err(e) => AgentStatus::Failed(e.to_string()),
            };
            on_complete(status);
        });

        Ok(session_id)
    }

    async fn check_status(
        &self,
        session_id: &str,
        _project_path: &Path,
    ) -> Result<AgentStatus, Box<dyn std::error::Error + Send + Sync>> {
        // Parse PID from: pid_{pid}_task_{task_id}
        if session_id.starts_with("pid_") {
            let parts: Vec<&str> = session_id.split('_').collect();
            if parts.len() >= 2 {
                if let Ok(pid) = parts[1].parse::<u32>() {
                    if is_pid_running(pid) {
                        return Ok(AgentStatus::Running);
                    }
                }
            }
        }
        Ok(AgentStatus::Failed("Session lost".into()))
    }
}

pub struct OpencodeAgent {
    server_url: Option<String>,
    generic_cli: GenericCliAgent,
}

impl OpencodeAgent {
    pub fn new(server_url: Option<String>) -> Self {
        Self {
            server_url,
            generic_cli: GenericCliAgent::new("opencode run {prompt}".to_string()),
        }
    }

    async fn is_server_reachable(&self) -> bool {
        let url = match &self.server_url {
            Some(url) => url,
            None => return false,
        };

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(500))
            .build();

        if let Ok(client) = client {
            client.get(url).send().await.is_ok()
        } else {
            false
        }
    }
}

impl Agent for OpencodeAgent {
    async fn start_task(
        &self,
        task_id: i64,
        project_path: &Path,
        title: &str,
        description: &str,
        on_complete: Box<dyn FnOnce(AgentStatus) + Send + 'static>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        if self.is_server_reachable().await {
            let server_url = self.server_url.as_ref().unwrap();
            info!("OpenCode server is reachable at {}. Using HTTP API...", server_url);

            let client = reqwest::Client::new();
            
            // Create a session: POST /session
            let create_url = format!("{}/session", server_url);
            let create_resp: serde_json::Value = client.post(&create_url)
                .query(&[("directory", project_path.to_string_lossy().as_ref())])
                .send()
                .await?
                .json()
                .await?;

            let session_id = create_resp["id"]
                .as_str()
                .ok_or("Failed to parse session ID from response")?
                .to_string();

            info!("Created OpenCode server session: {}", session_id);

            let session_id_str = format!("sdk|{}|task|{}", session_id, task_id);
            let server_url_clone = server_url.clone();
            let prompt = format!("Task: {}\nDescription: {}", title, description);
            let session_id_payload = session_id.clone();

            tokio::spawn(async move {
                let client = reqwest::Client::new();
                let message_url = format!("{}/session/{}/message", server_url_clone, session_id_payload);
                
                let payload = serde_json::json!({
                    "parts": [
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                });

                let status = match client.post(&message_url).json(&payload).send().await {
                    Ok(resp) => {
                        if resp.status().is_success() {
                            AgentStatus::Success
                        } else {
                            AgentStatus::Failed(format!("HTTP Error {}", resp.status()))
                        }
                    }
                    Err(e) => {
                        AgentStatus::Failed(e.to_string())
                    }
                };
                on_complete(status);
            });

            return Ok(session_id_str);
        }

        info!("OpenCode server is unreachable. Falling back to local CLI...");
        self.generic_cli.start_task(task_id, project_path, title, description, on_complete).await
    }

    async fn check_status(
        &self,
        session_id: &str,
        project_path: &Path,
    ) -> Result<AgentStatus, Box<dyn std::error::Error + Send + Sync>> {
        if session_id.starts_with("sdk|") {
            let parts: Vec<&str> = session_id.split('|').collect();
            if parts.len() < 4 || parts[0] != "sdk" || parts[2] != "task" {
                return Err("Invalid SDK session ID format".into());
            }
            let opencode_session_id = parts[1];

            if self.is_server_reachable().await {
                let server_url = self.server_url.as_ref().unwrap();
                let client = reqwest::Client::new();
                let list_url = format!("{}/session", server_url);
                match client.get(&list_url)
                    .send()
                    .await {
                    Ok(resp) => {
                        if let Ok(sessions) = resp.json::<Vec<serde_json::Value>>().await {
                            let exists = sessions.iter().any(|s| {
                                s["id"].as_str() == Some(opencode_session_id)
                            });
                            if exists {
                                Ok(AgentStatus::Running)
                            } else {
                                Ok(AgentStatus::Failed("Session no longer exists on server".to_string()))
                            }
                        } else {
                            Ok(AgentStatus::Running)
                        }
                    }
                    Err(e) => {
                        warn!("Failed to query sessions from server: {}", e);
                        Ok(AgentStatus::Running)
                    }
                }
            } else {
                Ok(AgentStatus::Running)
            }
        } else {
            self.generic_cli.check_status(session_id, project_path).await
        }
    }
}

pub enum AgentEngine {
    Opencode(OpencodeAgent),
    Generic(GenericCliAgent),
}

impl AgentEngine {
    pub async fn start_task(
        &self,
        task_id: i64,
        project_path: &Path,
        title: &str,
        description: &str,
        on_complete: Box<dyn FnOnce(AgentStatus) + Send + 'static>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        match self {
            Self::Opencode(a) => a.start_task(task_id, project_path, title, description, on_complete).await,
            Self::Generic(a) => a.start_task(task_id, project_path, title, description, on_complete).await,
        }
    }

    pub async fn check_status(
        &self,
        session_id: &str,
        project_path: &Path,
    ) -> Result<AgentStatus, Box<dyn std::error::Error + Send + Sync>> {
        match self {
            Self::Opencode(a) => a.check_status(session_id, project_path).await,
            Self::Generic(a) => a.check_status(session_id, project_path).await,
        }
    }
}
