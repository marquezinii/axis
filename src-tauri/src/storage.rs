use crate::models::{Activity, Source, Workspace};
use directories::ProjectDirs;
use rusqlite::{Connection, params};
use std::{fs, path::PathBuf};

pub fn data_dir() -> Result<PathBuf, String> {
    let path = ProjectDirs::from("com", "Axis", "Axis")
        .ok_or("Could not resolve LocalAppData")?
        .data_local_dir()
        .to_path_buf();
    for child in ["vault", "sources", "staging", "backups", "logs", "cache"] {
        fs::create_dir_all(path.join(child)).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

pub fn connect() -> Result<Connection, String> {
    let db = Connection::open(data_dir()?.join("axis.db")).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS workspaces (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS installations (
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, repository_url TEXT NOT NULL, tracked_ref TEXT NOT NULL,
          relative_path TEXT NOT NULL, installed_commit TEXT NOT NULL, content_hash TEXT NOT NULL,
          destination TEXT NOT NULL UNIQUE, installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    ").map_err(|e| e.to_string())?;
    Ok(db)
}

pub fn activity(kind: &str, message: &str) -> Result<(), String> {
    connect()?
        .execute(
            "INSERT INTO activities(kind,message) VALUES(?1,?2)",
            params![kind, message],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn activities() -> Result<Vec<Activity>, String> {
    let db = connect()?;
    let mut stmt = db
        .prepare("SELECT id,kind,message,created_at FROM activities ORDER BY id DESC LIMIT 50")
        .map_err(|e| e.to_string())?;
    stmt.query_map([], |r| {
        Ok(Activity {
            id: r.get(0)?,
            kind: r.get(1)?,
            message: r.get(2)?,
            created_at: r.get(3)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn workspaces() -> Result<Vec<Workspace>, String> {
    let db = connect()?;
    let mut stmt = db
        .prepare("SELECT id,path,created_at FROM workspaces ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    stmt.query_map([], |r| {
        Ok(Workspace {
            id: r.get(0)?,
            path: r.get(1)?,
            created_at: r.get(2)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn add_workspace(path: &str) -> Result<(), String> {
    let canonical =
        fs::canonicalize(path).map_err(|_| "Workspace folder does not exist".to_string())?;
    if !canonical.is_dir() {
        return Err("Workspace must be a folder".into());
    }
    let value = canonical.display().to_string();
    connect()?
        .execute(
            "INSERT OR IGNORE INTO workspaces(path) VALUES(?1)",
            [&value],
        )
        .map_err(|e| e.to_string())?;
    activity("workspace", &format!("Added workspace {value}"))
}

pub fn remove_workspace(id: i64) -> Result<(), String> {
    connect()?
        .execute("DELETE FROM workspaces WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    activity("workspace", "Removed workspace")
}

pub fn sources() -> Result<Vec<Source>, String> {
    let db = connect()?;
    let mut stmt = db
        .prepare("SELECT id,url,created_at FROM sources ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    stmt.query_map([], |r| {
        Ok(Source {
            id: r.get(0)?,
            url: r.get(1)?,
            created_at: r.get(2)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn add_source(url: &str) -> Result<(), String> {
    crate::skills::parse_github_url(url)?;
    connect()?
        .execute("INSERT OR IGNORE INTO sources(url) VALUES(?1)", [url])
        .map_err(|e| e.to_string())?;
    activity("source", &format!("Added source {url}"))
}

pub fn remove_source(id: i64) -> Result<(), String> {
    connect()?
        .execute("DELETE FROM sources WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    activity("source", "Removed source")
}

pub fn is_first_run() -> Result<bool, String> {
    let db = connect()?;
    let value: Option<String> = db
        .query_row(
            "SELECT value FROM settings WHERE key='onboarding_done'",
            [],
            |r| r.get(0),
        )
        .ok();
    Ok(value.is_none())
}

pub fn finish_onboarding() -> Result<(), String> {
    connect()?
        .execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('onboarding_done','true')",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn installation_hash(path: &str) -> Option<String> {
    connect()
        .ok()?
        .query_row(
            "SELECT content_hash FROM installations WHERE destination=?1",
            [path],
            |r| r.get(0),
        )
        .ok()
}

pub fn save_installation(
    name: &str,
    repo: &str,
    tracked_ref: &str,
    rel: &str,
    commit: &str,
    hash: &str,
    destination: &str,
) -> Result<(), String> {
    connect()?.execute("INSERT OR REPLACE INTO installations(name,repository_url,tracked_ref,relative_path,installed_commit,content_hash,destination) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![name,repo,tracked_ref,rel,commit,hash,destination]).map_err(|e|e.to_string())?;
    Ok(())
}

pub fn installations() -> Result<Vec<(String, String, String, String)>, String> {
    let db = connect()?;
    let mut stmt=db.prepare("SELECT name,repository_url,tracked_ref,installed_commit FROM installations ORDER BY name").map_err(|e|e.to_string())?;
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
