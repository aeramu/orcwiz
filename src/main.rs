use clap::{Parser, Subcommand};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, error};

mod config;
mod db;
mod runner;
mod service;
mod web;

#[derive(Parser)]
#[command(name = "orcwiz")]
#[command(about = "AI Agent Orchestration Tool", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the orchestrator and web server
    Start,
    /// Install as a background service
    Install,
    /// View the kanban board
    Board,
    /// Add a new task
    Add {
        title: String,
        project_path: String,
        description: Option<String>,
    },
    /// Run a task (moves it to 'todo' status)
    Run {
        id: i64,
    },
    /// Update a task's status
    Status {
        id: i64,
        status: String,
    },
}

fn truncate(s: &str, max_width: usize) -> String {
    if s.len() > max_width {
        format!("{}...", &s[..max_width - 3])
    } else {
        s.to_string()
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    match &cli.command {
        Commands::Install => {
            service::install_service()?;
        }
        Commands::Board => {
            let config = config::Config::load();
            let url = format!("http://localhost:{}/api/tasks", config.port);
            let client = reqwest::Client::new();
            let res = client.get(&url).send().await?;
            if !res.status().is_success() {
                println!("Error: Failed to fetch tasks from server.");
                return Ok(());
            }
            let tasks: Vec<db::Task> = res.json().await?;
            
            println!("{:-<100}", "");
            println!("{:<5} | {:<30} | {:<15} | {:<15} | {}", "ID", "Title", "Status", "Session ID", "Project Path");
            println!("{:-<100}", "");
            for t in tasks {
                println!(
                    "{:<5} | {:<30} | {:<15} | {:<15} | {}",
                    t.id,
                    truncate(&t.title, 30),
                    t.status,
                    truncate(&t.session_id.unwrap_or_else(|| "N/A".to_string()), 15),
                    t.project_path
                );
            }
            println!("{:-<100}", "");
        }
        Commands::Add { title, project_path, description } => {
            let config = config::Config::load();
            let url = format!("http://localhost:{}/api/tasks", config.port);
            let client = reqwest::Client::new();
            
            let payload = serde_json::json!({
                "title": title,
                "project_path": project_path,
                "description": description
            });

            let res = client.post(&url).json(&payload).send().await?;
            if res.status().is_success() {
                println!("Task added successfully.");
            } else {
                println!("Error adding task.");
            }
        }
        Commands::Run { id } => {
            let config = config::Config::load();
            let url = format!("http://localhost:{}/api/tasks/{}/run", config.port, id);
            let client = reqwest::Client::new();
            
            let res = client.post(&url).send().await?;
            if res.status().is_success() {
                println!("Task run triggered successfully.");
            } else {
                println!("Error triggering task run.");
            }
        }
        Commands::Status { id, status } => {
            let config = config::Config::load();
            let url = format!("http://localhost:{}/api/tasks/{}/status", config.port, id);
            let client = reqwest::Client::new();
            
            let payload = serde_json::json!({
                "status": status
            });

            let res = client.put(&url).json(&payload).send().await?;
            if res.status().is_success() {
                println!("Task status updated successfully.");
            } else {
                println!("Error updating task status.");
            }
        }
        Commands::Start => {
            let config = config::Config::load();
            let db = Arc::new(db::Db::new()?);
            let runner = Arc::new(runner::Runner::new(config.opencode_server_url.clone()));

            info!("Starting Orcwiz Orchestrator on port {}", config.port);

            let db_clone = Arc::clone(&db);
            let runner_clone = Arc::clone(&runner);
            tokio::spawn(async move {
                loop {
                    if let Ok(tasks) = db_clone.list_tasks() {
                        for task in tasks {
                            if task.status == "todo" {
                                info!("Found todo task: {}", task.title);
                                let _ = db_clone.update_task_status(task.id, "in_progress");

                                let desc = task.description.as_deref().unwrap_or("");
                                let project_path = match runner_clone.prepare_project(&task.project_path).await {
                                    Ok(p) => p,
                                    Err(e) => {
                                        error!("Failed to prepare project for task {}: {}", task.id, e);
                                        continue;
                                    }
                                };

                                match runner_clone.run_opencode(&project_path, &task.title, desc).await {
                                    Ok(session_id) => {
                                        if let Some(sid) = session_id {
                                            info!("opencode session created: {}", sid);
                                            let _ = db_clone.update_task_session(task.id, &sid);
                                        }
                                        let _ = db_clone.update_task_status(task.id, "review");
                                    }
                                    Err(e) => {
                                        error!("Failed to run opencode for task {}: {}", task.id, e);
                                        let _ = db_clone.update_task_status(task.id, "backlog");
                                    }
                                }
                            }
                        }
                    }
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            });

            // Start web server (blocks)
            web::start_server(db, config.port).await;
        }
    }

    Ok(())
}
