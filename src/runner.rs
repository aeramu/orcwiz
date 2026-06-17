use std::path::PathBuf;
use tracing::info;

pub struct Runner {
    #[allow(dead_code)]
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

}
