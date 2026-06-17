use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub projects_dir: PathBuf,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub opencode_server_url: Option<String>,
    #[serde(default = "default_agent_type")]
    pub agent_type: String,
    #[serde(default)]
    pub generic_cli_command: Option<String>,
}

fn default_port() -> u16 {
    3000
}

fn default_agent_type() -> String {
    "opencode".to_string()
}

impl Config {
    pub fn load() -> Self {
        let config_path = Self::path();
        if !config_path.exists() {
            let default_config = Config {
                projects_dir: directories::UserDirs::new()
                    .map(|u| u.home_dir().join("dev"))
                    .unwrap_or_else(|| PathBuf::from("./dev")),
                port: 3000,
                opencode_server_url: Some("http://localhost:4096".to_string()),
                agent_type: "opencode".to_string(),
                generic_cli_command: Some("claude run {prompt}".to_string()),
            };
            if let Some(parent) = config_path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(
                &config_path,
                serde_json::to_string_pretty(&default_config).unwrap(),
            )
            .unwrap();
            return default_config;
        }

        let content = fs::read_to_string(&config_path).expect("Failed to read config file");
        serde_json::from_str(&content).expect("Failed to parse config file")
    }

    pub fn path() -> PathBuf {
        let base_dirs = directories::BaseDirs::new().expect("Failed to get base dirs");
        base_dirs.home_dir().join(".config").join("orcwiz").join("config.json")
    }
}
