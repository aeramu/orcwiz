use std::path::Path;
use tracing::{info, warn};

use super::cli::GenericCliAgent;
use super::{Agent, AgentStatus, SessionId};

pub struct OpencodeAgent {
    server_url: Option<String>,
    generic_cli: GenericCliAgent,
    client: reqwest::Client,
    check_client: reqwest::Client,
}

impl OpencodeAgent {
    pub fn new(server_url: Option<String>) -> Self {
        let client = reqwest::Client::new();
        let check_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(500))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            server_url,
            generic_cli: GenericCliAgent::new("opencode run {prompt}".to_string()),
            client,
            check_client,
        }
    }

    async fn is_server_reachable(&self) -> bool {
        let url = match &self.server_url {
            Some(url) => url,
            None => return false,
        };
        self.check_client.get(url).send().await.is_ok()
    }
}

#[async_trait::async_trait]
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

            // Create a session: POST /session
            let create_url = format!("{}/session", server_url);
            let create_resp: serde_json::Value = self
                .client
                .post(&create_url)
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

            let session_id_str = SessionId::Sdk(session_id.clone()).to_string();
            let server_url_clone = server_url.clone();
            let prompt = format!("Task: {}\nDescription: {}", title, description);
            let session_id_payload = session_id.clone();
            let client = self.client.clone();

            tokio::spawn(async move {
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
                    Err(e) => AgentStatus::Failed(e.to_string()),
                };
                on_complete(status);
            });

            return Ok(session_id_str);
        }

        info!("OpenCode server is unreachable. Falling back to local CLI...");
        self.generic_cli
            .start_task(task_id, project_path, title, description, on_complete)
            .await
    }

    async fn check_status(
        &self,
        session_id: &str,
        project_path: &Path,
    ) -> Result<AgentStatus, Box<dyn std::error::Error + Send + Sync>> {
        if let Ok(SessionId::Sdk(opencode_session_id)) = session_id.parse::<SessionId>() {
            if self.is_server_reachable().await {
                let server_url = self.server_url.as_ref().unwrap();
                let status_url = format!("{}/session/status", server_url);
                let is_busy = match self.client.get(&status_url)
                    .query(&[("directory", project_path.to_string_lossy().as_ref())])
                    .send()
                    .await {
                    Ok(resp) => {
                        if resp.status().is_success() {
                            if let Ok(status_map) = resp.json::<std::collections::HashMap<String, serde_json::Value>>().await {
                                status_map.contains_key(&opencode_session_id)
                            } else {
                                warn!("Failed to parse session status JSON from server");
                                true
                            }
                        } else {
                            warn!("Session status request returned status {}", resp.status());
                            true
                        }
                    }
                    Err(e) => {
                        warn!("Failed to query session status from server: {}", e);
                        true
                    }
                };

                if is_busy {
                    return Ok(AgentStatus::Running);
                }

                let list_url = format!("{}/session", server_url);
                match self.client.get(&list_url)
                    .query(&[("directory", project_path.to_string_lossy().as_ref())])
                    .send()
                    .await {
                    Ok(resp) => {
                        if resp.status().is_success() {
                            if let Ok(sessions) = resp.json::<Vec<serde_json::Value>>().await {
                                let exists = sessions
                                    .iter()
                                    .any(|s| s["id"].as_str() == Some(&opencode_session_id));
                                if exists {
                                    Ok(AgentStatus::Success)
                                } else {
                                    Ok(AgentStatus::Failed(
                                        "Session no longer exists on server".to_string(),
                                    ))
                                }
                            } else {
                                warn!("Failed to parse session list JSON from server");
                                Ok(AgentStatus::Running)
                            }
                        } else {
                            warn!("Session list request returned status {}", resp.status());
                            Ok(AgentStatus::Running)
                        }
                    }
                    Err(e) => {
                        warn!("Failed to query session list from server: {}", e);
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
