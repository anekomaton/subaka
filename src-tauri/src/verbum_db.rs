use rusqlite::{Connection, OpenFlags, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerbumArticle {
    pub id: String,
    pub dict_id: String,
    pub headword: String,
    pub norm_hw: String,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerbumDbStatus {
    pub ready: bool,
    pub path: Option<String>,
    pub size_mb: Option<f64>,
    pub total_articles: Option<i64>,
    pub message: String,
}

pub struct VerbumDbManager {
    db_path: Mutex<Option<PathBuf>>,
    conn: Mutex<Option<Connection>>,
}

impl VerbumDbManager {
    pub fn new() -> Self {
        Self {
            db_path: Mutex::new(None),
            conn: Mutex::new(None),
        }
    }

    pub fn initialize(&self, app: &AppHandle) -> VerbumDbStatus {
        let mut db_path_lock = self.db_path.lock().unwrap();
        let mut conn_lock = self.conn.lock().unwrap();

        let mut candidate_paths: Vec<PathBuf> = Vec::new();

        // 1. Program resources folder: <exe_dir>/resources/verbum_offline.sqlite3
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                candidate_paths.push(exe_dir.join("resources").join("verbum_offline.sqlite3"));
                candidate_paths.push(exe_dir.join("verbum_offline.sqlite3"));
            }
        }

        // 2. App resource_dir
        if let Ok(res_dir) = app.path().resource_dir() {
            candidate_paths.push(res_dir.join("resources").join("verbum_offline.sqlite3"));
            candidate_paths.push(res_dir.join("verbum_offline.sqlite3"));
        }

        // 3. App local data directory
        if let Ok(app_dir) = app.path().app_local_data_dir() {
            candidate_paths.push(app_dir.join("resources").join("verbum_offline.sqlite3"));
            candidate_paths.push(app_dir.join("verbum_offline.sqlite3"));
        }

        // 4. Current working directory & temp
        if let Ok(cwd) = std::env::current_dir() {
            candidate_paths.push(cwd.join("resources").join("verbum_offline.sqlite3"));
            candidate_paths.push(cwd.join("verbum_offline.sqlite3"));
            candidate_paths.push(cwd.join("dist").join("verbum_offline.sqlite3"));
        }
        candidate_paths.push(std::env::temp_dir().join("verbum_offline.sqlite3"));

        for p in candidate_paths {
            if p.exists() {
                if let Ok(conn) = Connection::open_with_flags(
                    &p,
                    OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
                ) {
                    let _ = conn.execute_batch(
                        "PRAGMA query_only = 1;
                         PRAGMA mmap_size = 134217728;
                         PRAGMA cache_size = -32000;",
                    );

                    let size_bytes = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                    let size_mb = (size_bytes as f64) / (1024.0 * 1024.0);

                    let total_articles: Option<i64> = conn
                        .query_row("SELECT count(*) FROM articles", [], |row| row.get(0))
                        .ok();

                    let path_str = p.to_string_lossy().to_string();
                    *db_path_lock = Some(p);
                    *conn_lock = Some(conn);

                    return VerbumDbStatus {
                        ready: true,
                        path: Some(path_str),
                        size_mb: Some(size_mb),
                        total_articles,
                        message: "Verbum offline dictionaries ready".into(),
                    };
                }
            }
        }

        VerbumDbStatus {
            ready: false,
            path: None,
            size_mb: None,
            total_articles: None,
            message: "Verbum offline database not yet downloaded in resources".into(),
        }
    }

    pub fn get_status(&self) -> VerbumDbStatus {
        let db_path_lock = self.db_path.lock().unwrap();
        let conn_lock = self.conn.lock().unwrap();

        if let (Some(path), Some(conn)) = (db_path_lock.as_ref(), conn_lock.as_ref()) {
            let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let size_mb = (size_bytes as f64) / (1024.0 * 1024.0);
            let total_articles: Option<i64> = conn
                .query_row("SELECT count(*) FROM articles", [], |row| row.get(0))
                .ok();

            VerbumDbStatus {
                ready: true,
                path: Some(path.to_string_lossy().to_string()),
                size_mb: Some(size_mb),
                total_articles,
                message: "Verbum offline dictionaries ready".into(),
            }
        } else {
            VerbumDbStatus {
                ready: false,
                path: None,
                size_mb: None,
                total_articles: None,
                message: "Verbum offline database not loaded".into(),
            }
        }
    }

    pub fn search(&self, term: &str) -> Vec<VerbumArticle> {
        let conn_lock = self.conn.lock().unwrap();
        let Some(conn) = conn_lock.as_ref() else {
            return Vec::new();
        };

        let clean = term.replace('\u{0301}', "").replace('+', "").to_lowercase().trim().to_string();
        if clean.is_empty() {
            return Vec::new();
        }

        // Try exact match first
        let mut results = Vec::new();
        let mut stmt = match conn.prepare(
            "SELECT id, dict_id, headword, norm_hw, html FROM articles WHERE norm_hw = ? LIMIT 25"
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map(params![clean], |row| {
            Ok(VerbumArticle {
                id: row.get(0)?,
                dict_id: row.get(1)?,
                headword: row.get(2)?,
                norm_hw: row.get(3)?,
                html: row.get(4)?,
            })
        });

        if let Ok(mapped) = rows {
            for item in mapped.flatten() {
                results.push(item);
            }
        }

        // If no exact match, try prefix match
        if results.is_empty() {
            let prefix = format!("{}%", clean);
            if let Ok(mut stmt_prefix) = conn.prepare(
                "SELECT id, dict_id, headword, norm_hw, html FROM articles WHERE norm_hw LIKE ? LIMIT 15"
            ) {
                if let Ok(mapped) = stmt_prefix.query_map(params![prefix], |row| {
                    Ok(VerbumArticle {
                        id: row.get(0)?,
                        dict_id: row.get(1)?,
                        headword: row.get(2)?,
                        norm_hw: row.get(3)?,
                        html: row.get(4)?,
                    })
                }) {
                    for item in mapped.flatten() {
                        results.push(item);
                    }
                }
            }
        }

        results
    }
}
