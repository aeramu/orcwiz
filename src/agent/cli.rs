use std::path::Path;
use tokio::process::Command;
use tracing::info;

use super::{Agent, AgentStatus, SessionId};

fn is_pid_running(pid: u32) -> bool {
    let mut cmd = std::process::Command::new("kill");
    cmd.arg("-0").arg(pid.to_string());
    if let Ok(status) = cmd.status() {
        status.success()
    } else {
        false
    }
}

fn shell_escape(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len() + 10);
    escaped.push('\'');
    for c in s.chars() {
        if c == '\'' {
            escaped.push_str("'\\''");
        } else {
            escaped.push(c);
        }
    }
    escaped.push('\'');
    escaped
}

pub struct GenericCliAgent {
    command_template: String,
}

impl GenericCliAgent {
    pub fn new(command_template: String) -> Self {
        Self { command_template }
    }
}

#[async_trait::async_trait]
impl Agent for GenericCliAgent {
    async fn start_task(
        &self,
        _task_id: i64,
        project_path: &Path,
        title: &str,
        description: &str,
        on_complete: Box<dyn FnOnce(AgentStatus) + Send + 'static>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let prompt = format!("Task: {}\nDescription: {}", title, description);
        let escaped_prompt = shell_escape(&prompt);
        let run_cmd = self.command_template.replace("{prompt}", &escaped_prompt);

        info!("Spawning generic CLI command in background: {}", run_cmd);

        let mut child = Command::new("sh")
            .arg("-c")
            .arg(&run_cmd)
            .current_dir(project_path)
            .spawn()?;

        let pid = child.id().ok_or("Failed to get spawned process ID")?;
        let session_id = SessionId::Cli(pid).to_string();

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
        if let Ok(SessionId::Cli(pid)) = session_id.parse::<SessionId>() {
            if is_pid_running(pid) {
                return Ok(AgentStatus::Running);
            }
        }
        Ok(AgentStatus::Failed("Session lost".into()))
    }
}
