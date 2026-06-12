use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;
use tracing::{info, warn};

pub struct Runner {
    opencode_server_url: Option<String>,
}

impl Runner {
    pub fn new(opencode_server_url: Option<String>) -> Self {
        Self { opencode_server_url }
    }

    pub async fn prepare_project(&self, project_path_str: &str) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        let expanded = if project_path_str.starts_with("~/") {
            let home = directories::UserDirs::new().unwrap().home_dir().to_path_buf();
            home.join(project_path_str.trim_start_matches("~/"))
        } else {
            PathBuf::from(project_path_str)
        };
        
        if !expanded.exists() {
            std::fs::create_dir_all(&expanded)?;
            info!("Created project directory at {:?}", expanded);
        }
        
        Ok(expanded)
    }

    pub async fn run_opencode(&self, project_path: &Path, title: &str, description: &str) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
        let prompt = format!(
            "Task: {}\nDescription: {}",
            title,
            description
        );

        info!("Running opencode for task: {}", title);

        let mut cmd = Command::new("opencode");
        cmd.arg("run").arg(&prompt);

        if let Some(ref server_url) = self.opencode_server_url {
            info!("Checking if opencode server at {} is running...", server_url);
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_millis(500))
                .build();
            
            if let Ok(client) = client {
                match client.get(server_url).send().await {
                    Ok(_) => {
                        info!("opencode server is running at {}. Attaching to it.", server_url);
                        cmd.arg("--attach").arg(server_url);
                    }
                    Err(e) => {
                        warn!("opencode server at {} is not reachable: {}. Running locally.", server_url, e);
                    }
                }
            }
        }

        let child = cmd
            .current_dir(project_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let mut session_id = None;

        let output = child.wait_with_output().await?;

        let stdout_str = String::from_utf8_lossy(&output.stdout);
        let stderr_str = String::from_utf8_lossy(&output.stderr);
        
        info!("opencode output: {}", stdout_str);
        if !stderr_str.is_empty() {
            warn!("opencode stderr: {}", stderr_str);
        }

        if let Some(idx) = stdout_str.find("ses_") {
            let end_idx = stdout_str[idx..].find(|c: char| !c.is_alphanumeric() && c != '_').unwrap_or(stdout_str[idx..].len());
            session_id = Some(stdout_str[idx..idx+end_idx].to_string());
        }

        if session_id.is_none() {
            let list_output = Command::new("opencode")
                .arg("session")
                .arg("list")
                .output()
                .await?;
            let list_str = String::from_utf8_lossy(&list_output.stdout);
            if let Some(idx) = list_str.find("ses_") {
                let end_idx = list_str[idx..].find(|c: char| !c.is_alphanumeric() && c != '_').unwrap_or(list_str[idx..].len());
                session_id = Some(list_str[idx..idx+end_idx].to_string());
            }
        }

        Ok(session_id)
    }
}
