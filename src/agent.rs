use std::path::Path;
use tokio::process::Command;
use tracing::{info, warn};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentStatus {
    Running,
    Success,
    Failed(String),
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
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let orcwiz_dir = project_path.join(".orcwiz");
        std::fs::create_dir_all(&orcwiz_dir)?;

        let log_path = orcwiz_dir.join(format!("task_{}.log", task_id));
        let status_path = orcwiz_dir.join(format!("task_{}.status", task_id));

        if status_path.exists() {
            let _ = std::fs::remove_file(&status_path);
        }

        let prompt = format!("Task: {}\nDescription: {}", title, description);
        let run_cmd = self.command_template.replace("{prompt}", &prompt);

        let shell_cmd = format!(
            "({}) > '{}' 2>&1; echo $? > '{}'",
            run_cmd,
            log_path.to_string_lossy(),
            status_path.to_string_lossy()
        );

        info!("Spawning generic CLI command in background: {}", run_cmd);
        
        let child = Command::new("sh")
            .arg("-c")
            .arg(&shell_cmd)
            .current_dir(project_path)
            .spawn()?;

        let pid = child.id().ok_or("Failed to get spawned process ID")?;
        Ok(format!("pid_{}_task_{}", pid, task_id))
    }

    async fn check_status(
        &self,
        session_id: &str,
        project_path: &Path,
    ) -> Result<AgentStatus, Box<dyn std::error::Error + Send + Sync>> {
        let parts: Vec<&str> = session_id.split('_').collect();
        if parts.len() < 4 || parts[0] != "pid" || parts[2] != "task" {
            return Err("Invalid generic session ID format".into());
        }
        let pid_str = parts[1];
        let task_id_str = parts[3];
        
        let status_path = project_path
            .join(".orcwiz")
            .join(format!("task_{}.status", task_id_str));

        if status_path.exists() {
            let content = std::fs::read_to_string(&status_path)?;
            let exit_code = content.trim();
            if exit_code == "0" {
                return Ok(AgentStatus::Success);
            } else {
                return Ok(AgentStatus::Failed(format!("Exited with code {}", exit_code)));
            }
        }

        // Status file does not exist, check if process is still running
        let mut kill_cmd = Command::new("kill");
        kill_cmd.arg("-0").arg(pid_str);
        
        let is_running = match kill_cmd.status().await {
            Ok(status) => status.success(),
            Err(_) => false,
        };

        if is_running {
            Ok(AgentStatus::Running)
        } else {
            // Double check if status file appeared in the meantime
            if status_path.exists() {
                let content = std::fs::read_to_string(&status_path)?;
                let exit_code = content.trim();
                if exit_code == "0" {
                    return Ok(AgentStatus::Success);
                } else {
                    return Ok(AgentStatus::Failed(format!("Exited with code {}", exit_code)));
                }
            }
            Ok(AgentStatus::Failed("Process died unexpectedly".to_string()))
        }
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

            let server_url_clone = server_url.clone();
            let session_id_clone = session_id.clone();
            let prompt = format!("Task: {}\nDescription: {}", title, description);
            
            let orcwiz_dir = project_path.join(".orcwiz");
            let log_path = orcwiz_dir.join(format!("task_{}.log", task_id));
            let status_path = orcwiz_dir.join(format!("task_{}.status", task_id));

            std::fs::create_dir_all(&orcwiz_dir)?;
            if status_path.exists() {
                let _ = std::fs::remove_file(&status_path);
            }

            tokio::spawn(async move {
                let client = reqwest::Client::new();
                let message_url = format!("{}/session/{}/message", server_url_clone, session_id_clone);
                
                let payload = serde_json::json!({
                    "parts": [
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                });

                match client.post(&message_url).json(&payload).send().await {
                    Ok(resp) => {
                        if resp.status().is_success() {
                            let text = resp.text().await.unwrap_or_default();
                            let _ = std::fs::write(&log_path, format!("Task complete.\nResponse: {}", text));
                            let _ = std::fs::write(&status_path, "0");
                        } else {
                            let status = resp.status();
                            let text = resp.text().await.unwrap_or_default();
                            let _ = std::fs::write(&log_path, format!("HTTP Error {}: {}", status, text));
                            let _ = std::fs::write(&status_path, "1");
                        }
                    }
                    Err(e) => {
                        let _ = std::fs::write(&log_path, format!("Error running session chat: {}", e));
                        let _ = std::fs::write(&status_path, "1");
                    }
                }
            });

            return Ok(format!("sdk_{}_task_{}", session_id, task_id));
        }

        info!("OpenCode server is unreachable. Falling back to local CLI...");
        self.generic_cli.start_task(task_id, project_path, title, description).await
    }

    async fn check_status(
        &self,
        session_id: &str,
        project_path: &Path,
    ) -> Result<AgentStatus, Box<dyn std::error::Error + Send + Sync>> {
        if session_id.starts_with("sdk_") {
            let parts: Vec<&str> = session_id.split('_').collect();
            if parts.len() < 4 || parts[0] != "sdk" || parts[3] != "task" {
                return Err("Invalid SDK session ID format".into());
            }
            let opencode_session_id = parts[1];
            let task_id_str = parts[3];

            let status_path = project_path
                .join(".orcwiz")
                .join(format!("task_{}.status", task_id_str));

            if status_path.exists() {
                let content = std::fs::read_to_string(&status_path)?;
                let exit_code = content.trim();
                if exit_code == "0" {
                    return Ok(AgentStatus::Success);
                } else {
                    return Ok(AgentStatus::Failed(format!("Exited with code {}", exit_code)));
                }
            }

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
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        match self {
            Self::Opencode(a) => a.start_task(task_id, project_path, title, description).await,
            Self::Generic(a) => a.start_task(task_id, project_path, title, description).await,
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
