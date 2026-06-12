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
    /// Task management commands
    Task {
        #[command(subcommand)]
        action: TaskCommands,
    },
}

#[derive(Subcommand)]
enum TaskCommands {
    /// Add a new task
    Add {
        title: String,
        project_path: String,
        description: Option<String>,
        #[arg(long)]
        parent_id: Option<i64>,
    },
    /// View task detail
    Info {
        id: i64,
    },
    /// Run a task
    Run {
        id: i64,
    },
    /// Update a task's status
    SetStatus {
        id: i64,
        status: String,
    },
    /// Update a task's details (only if in backlog)
    Update {
        id: i64,
        #[arg(short, long)]
        title: Option<String>,
        #[arg(short, long)]
        project_path: Option<String>,
        #[arg(short, long)]
        description: Option<String>,
        #[arg(long)]
        parent_id: Option<i64>,
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
        Commands::Task { action } => match action {
            TaskCommands::Add { title, project_path, description, parent_id } => {
                let config = config::Config::load();
                let url = format!("http://localhost:{}/api/tasks", config.port);
                let client = reqwest::Client::new();
                
                let payload = serde_json::json!({
                    "title": title,
                    "project_path": project_path,
                    "description": description,
                    "parent_id": parent_id
                });

                let res = client.post(&url).json(&payload).send().await?;
                if res.status().is_success() {
                    let json: serde_json::Value = res.json().await?;
                    println!("Task {} added successfully.", json["id"]);
                } else {
                    println!("Error adding task.");
                }
            }
            TaskCommands::Info { id } => {
                let config = config::Config::load();
                let url = format!("http://localhost:{}/api/tasks/{}", config.port, id);
                let client = reqwest::Client::new();
                let res = client.get(&url).send().await?;
                if res.status().is_success() {
                    let task: db::Task = res.json().await?;
                    println!("Task ID:       {}", task.id);
                    if let Some(pid) = task.parent_id {
                        println!("Parent ID:     {}", pid);
                    }
                    println!("Title:         {}", task.title);
                    println!("Status:        {}", task.status);
                    println!("Project Path:  {}", task.project_path);
                    println!("Session ID:    {}", task.session_id.unwrap_or_else(|| "N/A".to_string()));
                    println!("Created At:    {}", task.created_at);
                    println!("Description:\n{}", task.description.unwrap_or_else(|| "N/A".to_string()));
                } else {
                    println!("Error: Task not found or server error.");
                }
            }
            TaskCommands::Run { id } => {
                let config = config::Config::load();
                let url = format!("http://localhost:{}/api/tasks/{}/run", config.port, id);
                let client = reqwest::Client::new();
                
                let res = client.post(&url).send().await?;
                if res.status().is_success() {
                    println!("Task {} run triggered successfully.", id);
                } else {
                    println!("Error triggering task run.");
                }
            }
            TaskCommands::SetStatus { id, status } => {
                let config = config::Config::load();
                let url = format!("http://localhost:{}/api/tasks/{}/status", config.port, id);
                let client = reqwest::Client::new();
                
                let payload = serde_json::json!({
                    "status": status
                });

                let res = client.put(&url).json(&payload).send().await?;
                if res.status().is_success() {
                    println!("Task {} status updated to '{}' successfully.", id, status);
                } else {
                    println!("Error updating task status.");
                }
            }
            TaskCommands::Update { id, title, project_path, description, parent_id } => {
                let config = config::Config::load();
                let url = format!("http://localhost:{}/api/tasks/{}", config.port, id);
                let client = reqwest::Client::new();
                
                let payload = serde_json::json!({
                    "title": title,
                    "project_path": project_path,
                    "description": description,
                    "parent_id": parent_id
                });

                let res = client.put(&url).json(&payload).send().await?;
                if res.status().is_success() {
                    println!("Task {} updated successfully.", id);
                } else if res.status() == reqwest::StatusCode::BAD_REQUEST {
                    let text = res.text().await.unwrap_or_default();
                    println!("Failed to update task: {}", text);
                } else {
                    println!("Error updating task.");
                }
            }
        },
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

                                let desc = task.description.clone().unwrap_or_default();
                                let title = task.title.clone();
                                let task_id = task.id;
                                let project_path = match runner_clone.prepare_project(&task.project_path).await {
                                    Ok(p) => p,
                                    Err(e) => {
                                        error!("Failed to prepare project for task {}: {}", task.id, e);
                                        continue;
                                    }
                                };

                                let db_for_runner = Arc::clone(&db_clone);
                                let runner_for_spawn = Arc::clone(&runner_clone);

                                tokio::spawn(async move {
                                    if let Err(e) = runner_for_spawn.run_opencode(task_id, db_for_runner, project_path, title, desc).await {
                                        error!("opencode execution failed for task {}: {}", task_id, e);
                                    }
                                });
                            }
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            });

            // Start the web server on the main thread
            web::start_server(db, config.port).await;
        }
    }

    Ok(())
}
