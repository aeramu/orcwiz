use std::sync::Arc;
use tracing::{error, info, warn};

use crate::agent::{Agent, AgentStatus};
use crate::db::Db;
use crate::runner::Runner;

pub struct Orchestrator {
    db: Arc<Db>,
    runner: Arc<Runner>,
    agent: Arc<dyn Agent>,
}

impl Orchestrator {
    pub fn new(db: Arc<Db>, runner: Arc<Runner>, agent: Arc<dyn Agent>) -> Self {
        Self { db, runner, agent }
    }

    /// Starts the background orchestration loop.
    pub fn start(self) {
        let db = self.db;
        let runner = self.runner;
        let agent = self.agent;

        tokio::spawn(async move {
            loop {
                if let Ok(tasks) = db.list_tasks() {
                    for task in tasks {
                        if task.status == "todo" {
                            // Only run tasks that have been assigned
                            if task.assigned_agent.is_none() {
                                continue;
                            }
                            info!("Found todo task: {}", task.title);
                            let _ = db.update_task_status(task.id, "in_progress");

                            let desc = task.description.clone().unwrap_or_default();
                            let title = task.title.clone();
                            let task_id = task.id;
                            let assigned_agent = task.assigned_agent.clone();

                            let project_path = match runner.prepare_project(&task.project_path).await {
                                Ok(p) => p,
                                Err(e) => {
                                    error!("Failed to prepare project for task {}: {}", task.id, e);
                                    let _ = db.update_task_status(task.id, "failed");
                                    continue;
                                }
                            };

                            let db_for_runner = Arc::clone(&db);
                            let db_for_callback = Arc::clone(&db);
                            let agent_for_spawn = Arc::clone(&agent);

                            let on_complete = Box::new(move |status: AgentStatus| {
                                match status {
                                    AgentStatus::Success => {
                                        info!("Task {} finished successfully", task_id);
                                        let _ = db_for_callback.update_task_status(task_id, "review");
                                    }
                                    AgentStatus::Failed(err) => {
                                        warn!("Task {} failed: {}", task_id, err);
                                        let _ = db_for_callback.update_task_status(task_id, "failed");
                                    }
                                    AgentStatus::Running => {}
                                }
                            });

                            tokio::spawn(async move {
                                match agent_for_spawn
                                    .start_task(task_id, &project_path, &title, &desc, assigned_agent.as_deref(), on_complete)
                                    .await
                                {
                                    Ok(sess_id) => {
                                        info!(
                                            "Successfully started task {} with session: {}",
                                            task_id, sess_id
                                        );
                                        let _ = db_for_runner.update_task_session(task_id, &sess_id);
                                    }
                                    Err(e) => {
                                        error!("Failed to start task {}: {}", task_id, e);
                                        let _ = db_for_runner.update_task_status(task_id, "failed");
                                    }
                                }
                            });
                        }

                        if task.status == "in_progress" {
                            if let Some(ref sess_id) = task.session_id {
                                let task_id = task.id;
                                let project_path = match runner.prepare_project(&task.project_path).await {
                                    Ok(p) => p,
                                    Err(e) => {
                                        error!(
                                            "Failed to prepare project path to check status for task {}: {}",
                                            task.id, e
                                        );
                                        continue;
                                    }
                                };

                                let agent_clone = Arc::clone(&agent);
                                let db_clone = Arc::clone(&db);
                                let sess_id_clone = sess_id.clone();
                                tokio::spawn(async move {
                                    match agent_clone.check_status(&sess_id_clone, &project_path).await {
                                        Ok(AgentStatus::Success) => {
                                            info!("Task {} finished successfully", task_id);
                                            let _ = db_clone.update_task_status(task_id, "review");
                                        }
                                        Ok(AgentStatus::Failed(err)) => {
                                            warn!("Task {} failed: {}", task_id, err);
                                            let _ = db_clone.update_task_status(task_id, "failed");
                                        }
                                        Ok(AgentStatus::Running) => {
                                            // Still running
                                        }
                                        Err(e) => {
                                            warn!(
                                                "Error checking status for task {}: {}",
                                                task_id, e
                                            );
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        });
    }
}
