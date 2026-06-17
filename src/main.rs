use std::sync::Arc;
use tracing::info;

mod agent;
mod cli;
mod config;
mod db;
mod orchestrator;
mod runner;
mod service;
mod web;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt::init();

    // Run CLI. If it returns Ok(true), start command was called and we should run the server/orchestrator.
    // Otherwise, we handled a client subcommand and can exit now.
    if !cli::run_cli().await? {
        return Ok(());
    }

    let config = config::Config::load();
    let db = Arc::new(db::Db::new()?);
    let runner = Arc::new(runner::Runner::new(config.opencode_server_url.clone()));

    let agent: Arc<dyn agent::Agent> = if config.agent_type == "opencode" {
        Arc::new(agent::OpencodeAgent::new(config.opencode_server_url.clone()))
    } else {
        let cmd_template = config
            .generic_cli_command
            .clone()
            .unwrap_or_else(|| "claude run {prompt}".to_string());
        Arc::new(agent::GenericCliAgent::new(cmd_template))
    };

    info!("Starting Orcwiz Orchestrator on port {}", config.port);

    // Start background orchestrator loop
    let orchestrator = orchestrator::Orchestrator::new(Arc::clone(&db), runner, agent);
    orchestrator.start();

    // Start the web server on the main thread
    web::start_server(db, config.port).await;

    Ok(())
}
