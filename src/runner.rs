use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;
use tracing::{info, warn};

pub struct Runner {
    projects_dir: PathBuf,
    opencode_server_url: Option<String>,
}

impl Runner {
    pub fn new(projects_dir: PathBuf, opencode_server_url: Option<String>) -> Self {
        Self { projects_dir, opencode_server_url }
    }

    pub async fn prepare_project(&self, description: &str) -> Result<PathBuf, Box<dyn std::error::Error + Send + Sync>> {
        // Try to find a git URL in the description
        let git_url = description
            .split_whitespace()
            .find(|word| word.starts_with("git@") || word.starts_with("http") && word.ends_with(".git"));

        if let Some(url) = git_url {
            let folder_name = url.split('/').last().unwrap_or("unknown_repo").trim_end_matches(".git");
            let project_path = self.projects_dir.join(folder_name);
            
            if !project_path.exists() {
                info!("Cloning {} into {:?}", url, project_path);
                let status = Command::new("git")
                    .arg("clone")
                    .arg(url)
                    .current_dir(&self.projects_dir)
                    .status()
                    .await?;
                
                if !status.success() {
                    return Err(format!("Failed to clone repository: {}", url).into());
                }
            }
            return Ok(project_path);
        }

        // Try to find a local path
        // Simple heuristic: look for something starting with / or ~/ or ./ that exists
        let local_path_str = description
            .split_whitespace()
            .find(|word| word.starts_with('/') || word.starts_with("~/") || word.starts_with("./"));

        if let Some(path_str) = local_path_str {
            let expanded = if path_str.starts_with("~/") {
                let home = directories::UserDirs::new().unwrap().home_dir().to_path_buf();
                home.join(path_str.trim_start_matches("~/"))
            } else {
                PathBuf::from(path_str)
            };
            if expanded.exists() {
                return Ok(expanded);
            }
        }

        // Default: use a folder named "default_project"
        let default_project = self.projects_dir.join("default_project");
        if !default_project.exists() {
            std::fs::create_dir_all(&default_project)?;
        }
        Ok(default_project)
    }

    pub async fn run_opencode(&self, project_path: &Path, title: &str, description: &str) -> Result<Option<String>, Box<dyn std::error::Error + Send + Sync>> {
        let prompt = format!(
            "Task: {}\nDescription: {}\nMake sure to move the task to 'Ready to Review' when done.",
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

        // Capture stdout to extract session ID if possible
        // opencode session ids are usually like ses_...
        let mut session_id = None;

        let output = child.wait_with_output().await?;

        let stdout_str = String::from_utf8_lossy(&output.stdout);
        let stderr_str = String::from_utf8_lossy(&output.stderr);
        
        info!("opencode output: {}", stdout_str);
        if !stderr_str.is_empty() {
            warn!("opencode stderr: {}", stderr_str);
        }

        // Try to parse session id from stdout
        if let Some(idx) = stdout_str.find("ses_") {
            let end_idx = stdout_str[idx..].find(|c: char| !c.is_alphanumeric() && c != '_').unwrap_or(stdout_str[idx..].len());
            session_id = Some(stdout_str[idx..idx+end_idx].to_string());
        }

        if session_id.is_none() {
            // Alternatively, list sessions and get the first one
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
