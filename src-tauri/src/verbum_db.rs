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
    cached_size_mb: Mutex<Option<f64>>,
    cached_total_articles: Mutex<Option<i64>>,
}

impl VerbumDbManager {
    pub fn new() -> Self {
        Self {
            db_path: Mutex::new(None),
            conn: Mutex::new(None),
            cached_size_mb: Mutex::new(None),
            cached_total_articles: Mutex::new(None),
        }
    }

    pub fn initialize(&self, app: &AppHandle) -> VerbumDbStatus {
        let mut db_path_lock = self.db_path.lock().unwrap();
        let mut conn_lock = self.conn.lock().unwrap();

        // If already connected and ready, return existing status without re-opening
        if let (Some(path), Some(_)) = (db_path_lock.as_ref(), conn_lock.as_ref()) {
            let size_mb = *self.cached_size_mb.lock().unwrap();
            let total_articles = *self.cached_total_articles.lock().unwrap();
            return VerbumDbStatus {
                ready: true,
                path: Some(path.to_string_lossy().to_string()),
                size_mb,
                total_articles,
                message: "Verbum offline dictionaries ready".into(),
            };
        }

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
                    *self.cached_size_mb.lock().unwrap() = Some(size_mb);
                    *self.cached_total_articles.lock().unwrap() = total_articles;
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

        if let (Some(path), Some(_conn)) = (db_path_lock.as_ref(), conn_lock.as_ref()) {
            let size_mb = *self.cached_size_mb.lock().unwrap();
            let total_articles = *self.cached_total_articles.lock().unwrap();

            VerbumDbStatus {
                ready: true,
                path: Some(path.to_string_lossy().to_string()),
                size_mb,
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

        let clean = term.replace(['\u{0301}', '\u{0300}', '+'], "").to_lowercase().trim().to_string();
        if clean.is_empty() {
            return Vec::new();
        }

        // Build list of spelling variants (accent stripped, ё/е, ў/у)
        let mut variants = vec![clean.clone()];
        if clean.contains('ё') {
            variants.push(clean.replace('ё', "е"));
        } else if clean.contains('е') {
            variants.push(clean.replace('е', "ё"));
        }
        if clean.starts_with('ў') {
            variants.push(format!("у{}", &clean['ў'.len_utf8()..]));
        } else if clean.starts_with('у') {
            variants.push(format!("ў{}", &clean['у'.len_utf8()..]));
        }

        // Also add potential base stems for common noun/adjective inflections
        let mut base_candidates = Vec::new();
        for v in &variants {
            for suffix in ["ай", "аю", "ая", "ыя", "ія", "ага", "яго", "аму", "яму", "ам", "ем", "ём", "ям", "амі", "ямі", "ах", "ях", "цы", "цы", "ку", "ка", "кі", "ку", "кам"] {
                if v.len() > suffix.len() + 2 && v.ends_with(suffix) {
                    let stem = &v[..v.len() - suffix.len()];
                    base_candidates.push(format!("{}а", stem));
                    base_candidates.push(format!("{}ь", stem));
                    base_candidates.push(stem.to_string());
                }
            }
        }
        for bc in base_candidates {
            if !variants.contains(&bc) {
                variants.push(bc);
            }
        }

        // Ranking priority for dictionaries:
        // Explanatory dictionaries first, then synonyms, By-Ru, etymological, Ru-By, and foreign
        fn dict_priority(dict_id: &str) -> i32 {
            match dict_id {
                "tsblm2022" => 1,
                "tsbm" => 2,
                "tsblm" => 3,
                "brs" => 4,
                "klyshka" => 5,
                "esbm" => 6,
                "sis1999" | "sis2005" => 7,
                "rbs10" => 8,
                "rbs" => 9,
                "susha" => 10,
                _ => 20,
            }
        }

        let mut results = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        // 1. Exact match across all spelling variants (clean, yo/ye, u/w, apostrophes)
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id, dict_id, headword, norm_hw, html FROM articles WHERE norm_hw = ?"
        ) {
            for (idx, var) in variants.iter().enumerate() {
                if let Ok(mapped) = stmt.query_map(params![var], |row| {
                    Ok(VerbumArticle {
                        id: row.get(0)?,
                        dict_id: row.get(1)?,
                        headword: row.get(2)?,
                        norm_hw: row.get(3)?,
                        html: row.get(4)?,
                    })
                }) {
                    for item in mapped.flatten() {
                        let key = format!("{}:{}", item.dict_id, item.id);
                        if seen_ids.insert(key) {
                            results.push(item);
                        }
                    }
                }
                // If primary exact word has results, stop checking less likely base candidates to preserve exactness
                if idx == 0 && !results.is_empty() && results.len() >= 3 {
                    // Collect remaining variant matches but stop going into base stem candidates
                }
            }
        }

        // 2. If still no results, try prefix match on clean term
        if results.is_empty() {
            let prefix = format!("{}%", clean);
            if let Ok(mut stmt_prefix) = conn.prepare(
                "SELECT id, dict_id, headword, norm_hw, html FROM articles WHERE norm_hw LIKE ? LIMIT 30"
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
                        let key = format!("{}:{}", item.dict_id, item.id);
                        if seen_ids.insert(key) {
                            results.push(item);
                        }
                    }
                }
            }
        }

        // Sort results by relevance:
        // 1. Exact match with search term (norm_hw == clean)
        // 2. Dictionary priority rank (TSBLM > BRS > Klyshka > ESBM > RBS10 > Susha)
        // 3. Shorter headword length
        results.sort_by(|a, b| {
            let a_exact = a.norm_hw == clean;
            let b_exact = b.norm_hw == clean;
            if a_exact != b_exact {
                return b_exact.cmp(&a_exact);
            }
            let a_prio = dict_priority(&a.dict_id);
            let b_prio = dict_priority(&b.dict_id);
            if a_prio != b_prio {
                return a_prio.cmp(&b_prio);
            }
            a.norm_hw.len().cmp(&b.norm_hw.len())
        });

        results
    }
}
