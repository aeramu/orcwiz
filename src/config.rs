use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub linear_api_key: String,
    pub projects_dir: PathBuf,
    #[serde(default = "default_port")]
    pub port: u16,
    // Linear team ID or query to poll
    pub linear_team_id: Option<String>,
    #[serde(default)]
    pub opencode_server_url: Option<String>,
}

fn default_port() -> u16 {
    3000
}

impl Config {
    pub fn load() -> Self {
        let config_path = Self::path();
        if !config_path.exists() {
            let default_config = Config {
                linear_api_key: "YOUR_LINEAR_API_KEY".to_string(),
                projects_dir: directories::UserDirs::new()
                    .map(|u| u.home_dir().join("dev"))
                    .unwrap_or_else(|| PathBuf::from("./dev")),
                port: 3000,
                linear_team_id: None,
                opencode_server_url: Some("http://localhost:4096".to_string()),
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
        base_dirs.config_dir().join("orcwiz").join("config.json")
    }
}
