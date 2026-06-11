use clap::{Parser, Subcommand};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, error};

mod config;
mod db;
mod linear;
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
    /// List all sessions
    Sessions,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    match &cli.command {
        Commands::Install => {
            service::install_service()?;
        }
        Commands::Sessions => {
            let db = db::Db::new()?;
            let sessions = db.get_sessions()?;
            println!("{:-<80}", "");
            println!("{:<5} | {:<20} | {:<15} | {}", "ID", "Linear Task", "Session ID", "Status");
            println!("{:-<80}", "");
            for s in sessions {
                println!(
                    "{:<5} | {:<20} | {:<15} | {}",
                    s.id,
                    s.linear_task_id,
                    s.session_id.unwrap_or_else(|| "N/A".to_string()),
                    s.status
                );
            }
            println!("{:-<80}", "");
        }
        Commands::Start => {
            let config = config::Config::load();
            let db = Arc::new(db::Db::new()?);
            let linear_client = Arc::new(linear::LinearClient::new(config.linear_api_key.clone()));
            let runner = Arc::new(runner::Runner::new(config.projects_dir.clone()));

            info!("Starting Orcwiz Orchestrator on port {}", config.port);

            let db_clone = Arc::clone(&db);
            tokio::spawn(async move {
                loop {
                    info!("Polling Linear for new tasks...");
                    match linear_client.fetch_todo_tasks().await {
                        Ok(tasks) => {
                            for task in tasks {
                                match db_clone.is_task_processed(&task.id) {
                                    Ok(processed) => {
                                        if !processed {
                                            info!("Found new task: {}", task.title);
                                            let desc = task.description.as_deref().unwrap_or("");
                                            
                                            // Prepare project
                                            let project_path = match runner.prepare_project(desc).await {
                                                Ok(p) => p,
                                                Err(e) => {
                                                    error!("Failed to prepare project for task {}: {}", task.id, e);
                                                    continue;
                                                }
                                            };

                                            let session_db_id = db_clone.insert_session(&task.id, &project_path.to_string_lossy()).unwrap();
                                            
                                            // Run opencode
                                            match runner.run_opencode(&project_path, &task.title, desc).await {
                                                Ok(session_id) => {
                                                    if let Some(sid) = session_id {
                                                        info!("opencode session created: {}", sid);
                                                        let _ = db_clone.update_session_id(session_db_id, &sid);
                                                    }
                                                    let _ = db_clone.update_status(session_db_id, "completed");
                                                }
                                                Err(e) => {
                                                    error!("Failed to run opencode for task {}: {}", task.id, e);
                                                    let _ = db_clone.update_status(session_db_id, "failed");
                                                }
                                            }
                                        }
                                    }
                                    Err(e) => error!("DB error checking task: {}", e),
                                }
                            }
                        }
                        Err(e) => error!("Failed to fetch tasks from Linear: {}", e),
                    }
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
            });

            // Start web server (blocks)
            web::start_server(db, config.port).await;
        }
    }

    Ok(())
}
