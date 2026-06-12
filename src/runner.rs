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

    pub async fn run_opencode(
        &self, 
        task_id: i64, 
        db: std::sync::Arc<crate::db::Db>, 
        project_path: std::path::PathBuf, 
        title: String, 
        description: String
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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

        let mut child = cmd
            .current_dir(project_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let stderr = child.stderr.take().expect("Failed to capture stderr");

        // Consume stderr in background to prevent pipe buffer from filling up and deadlocking
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut reader = tokio::io::BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                warn!("opencode stderr: {}", line);
            }
        });

        // Read stdout chunk by chunk to avoid blocking on newlines (in case of spinners, etc.)
        use tokio::io::AsyncReadExt;
        let mut reader = stdout;
        let mut buf = [0u8; 1024];
        let mut found_session = false;
        let mut output_acc = String::new();

        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]);
                    // Print chunk to terminal just so we can see what's happening
                    print!("{}", chunk);
                    
                    if !found_session {
                        output_acc.push_str(&chunk);
                        if let Some(idx) = output_acc.find("ses_") {
                            // find end of session ID
                            let after_ses = &output_acc[idx..];
                            let end_idx = after_ses.find(|c: char| !c.is_alphanumeric() && c != '_');
                            
                            if let Some(e) = end_idx {
                                let session_id = &after_ses[..e];
                                info!("Extracted session id: {}", session_id);
                                let _ = db.update_task_session(task_id, session_id);
                                found_session = true;
                            } else if after_ses.len() > 35 {
                                // If no terminator is found but it's long enough, it's likely complete
                                let session_id = after_ses;
                                info!("Extracted session id: {}", session_id);
                                let _ = db.update_task_session(task_id, session_id);
                                found_session = true;
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!("Error reading stdout: {}", e);
                    break;
                }
            }
        }

        let _ = child.wait().await?;

        if !found_session {
            let list_output = Command::new("opencode")
                .arg("session")
                .arg("list")
                .output()
                .await?;
            let list_str = String::from_utf8_lossy(&list_output.stdout);
            if let Some(idx) = list_str.find("ses_") {
                let end_idx = list_str[idx..].find(|c: char| !c.is_alphanumeric() && c != '_').unwrap_or(list_str[idx..].len());
                let session_id = &list_str[idx..idx+end_idx];
                let _ = db.update_task_session(task_id, session_id);
            }
        }

        let _ = db.update_task_status(task_id, "review");

        Ok(())
    }
}
