use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub project_path: String,
    pub session_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn new() -> Result<Self> {
        let base_dirs = directories::BaseDirs::new().expect("Failed to get base dirs");
        let db_dir = base_dirs.data_dir().join("orcwiz");
        if !db_dir.exists() {
            std::fs::create_dir_all(&db_dir).unwrap();
        }
        let db_path = db_dir.join("orcwiz.db");

        let conn = Connection::open(db_path)?;
        
        // We drop the old sessions table or just create tasks table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL,
                project_path TEXT NOT NULL,
                session_id TEXT,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        Ok(Db { conn: Mutex::new(conn) })
    }

    pub fn add_task(&self, title: &str, project_path: &str, description: Option<&str>) -> Result<i64> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (title, description, status, project_path, created_at) 
             VALUES (?1, ?2, 'backlog', ?3, ?4)",
            params![title, description, project_path, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_task_session(&self, id: i64, session_id: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE tasks SET session_id = ?1, status = 'in_progress' WHERE id = ?2",
            params![session_id, id],
        )?;
        Ok(())
    }

    pub fn update_task_status(&self, id: i64, status: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE tasks SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn list_tasks(&self) -> Result<Vec<Task>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, title, description, status, project_path, session_id, created_at FROM tasks ORDER BY created_at ASC")?;
        let task_iter = stmt.query_map([], |row| {
            let created_at_str: String = row.get(6)?;
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                .unwrap_or_default()
                .with_timezone(&Utc);

            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                project_path: row.get(4)?,
                session_id: row.get(5)?,
                created_at,
            })
        })?;

        let mut tasks = Vec::new();
        for t in task_iter {
            tasks.push(t?);
        }
        Ok(tasks)
    }

    pub fn get_task(&self, id: i64) -> Result<Option<Task>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, title, description, status, project_path, session_id, created_at FROM tasks WHERE id = ?1")?;
        let mut task_iter = stmt.query_map(params![id], |row| {
            let created_at_str: String = row.get(6)?;
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                .unwrap_or_default()
                .with_timezone(&Utc);

            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                project_path: row.get(4)?,
                session_id: row.get(5)?,
                created_at,
            })
        })?;

        if let Some(t) = task_iter.next() {
            Ok(Some(t?))
        } else {
            Ok(None)
        }
    }
}
