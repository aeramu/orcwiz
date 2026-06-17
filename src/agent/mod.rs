use std::fmt;
use std::path::Path;
use std::str::FromStr;

pub mod cli;
pub mod opencode;

pub use cli::GenericCliAgent;
pub use opencode::OpencodeAgent;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentStatus {
    Running,
    Success,
    Failed(String),
}

#[async_trait::async_trait]
pub trait Agent: Send + Sync {
    /// Starts the agent execution for a task in the background.
    /// Returns a session identifier (e.g. `cli|<pid>` or `sdk|<session_id>`).
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionId {
    Cli(u32),
    Opencode(String),
}

impl FromStr for SessionId {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        // Check new formats first
        let parts: Vec<&str> = s.split('|').collect();
        if parts.len() == 2 {
            match parts[0] {
                "cli" => {
                    let pid = parts[1]
                        .parse::<u32>()
                        .map_err(|e| format!("Failed to parse PID: {}", e))?;
                    return Ok(SessionId::Cli(pid));
                }
                "opencode" => return Ok(SessionId::Opencode(parts[1].to_string())),
                _ => {}
            }
        }

        // Fallback for old formats:
        // pid_{pid}_task_{task_id}
        if s.starts_with("pid_") {
            let subparts: Vec<&str> = s.split('_').collect();
            if subparts.len() >= 2 {
                if let Ok(pid) = subparts[1].parse::<u32>() {
                    return Ok(SessionId::Cli(pid));
                }
            }
        }
        // opencode|{session_id}|task|{task_id}
        if s.starts_with("opencode|") {
            if parts.len() >= 2 {
                return Ok(SessionId::Opencode(parts[1].to_string()));
            }
        }

        Err(format!("Invalid session ID format: '{}'", s))
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SessionId::Cli(pid) => write!(f, "cli|{}", pid),
            SessionId::Opencode(sid) => write!(f, "opencode|{}", sid),
        }
    }
}
