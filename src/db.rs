use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: i64,
    pub linear_task_id: String,
    pub session_id: Option<String>,
    pub project_path: String,
    pub status: String,
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
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY,
                linear_task_id TEXT NOT NULL,
                session_id TEXT,
                project_path TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        Ok(Db { conn: Mutex::new(conn) })
    }

    pub fn insert_session(&self, linear_task_id: &str, project_path: &str) -> Result<i64> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (linear_task_id, project_path, status, created_at) 
             VALUES (?1, ?2, 'pending', ?3)",
            params![linear_task_id, project_path, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_session_id(&self, id: i64, session_id: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE sessions SET session_id = ?1, status = 'running' WHERE id = ?2",
            params![session_id, id],
        )?;
        Ok(())
    }

    pub fn update_status(&self, id: i64, status: &str) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "UPDATE sessions SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn get_sessions(&self) -> Result<Vec<Session>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, linear_task_id, session_id, project_path, status, created_at FROM sessions ORDER BY created_at DESC")?;
        let session_iter = stmt.query_map([], |row| {
            let created_at_str: String = row.get(5)?;
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                .unwrap_or_default()
                .with_timezone(&Utc);

            Ok(Session {
                id: row.get(0)?,
                linear_task_id: row.get(1)?,
                session_id: row.get(2)?,
                project_path: row.get(3)?,
                status: row.get(4)?,
                created_at,
            })
        })?;

        let mut sessions = Vec::new();
        for s in session_iter {
            sessions.push(s?);
        }
        Ok(sessions)
    }

    pub fn is_task_processed(&self, linear_task_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT count(1) FROM sessions WHERE linear_task_id = ?1")?;
        let count: i64 = stmt.query_row(params![linear_task_id], |row| row.get(0))?;
        Ok(count > 0)
    }
}
