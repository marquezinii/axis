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
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            title TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            tool_calls TEXT,
            token_usage TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS file_changes (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
            message_id TEXT REFERENCES chat_messages(id),
            file_path TEXT NOT NULL,
            diff TEXT,
            change_type TEXT NOT NULL
        );
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

pub fn installation_provenance(path: &str) -> Option<(String, String)> {
    connect()
        .ok()?
        .query_row(
            "SELECT repository_url, relative_path FROM installations WHERE destination=?1",
            [path],
            |r| Ok((r.get(0)?, r.get(1)?)),
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

pub fn save_session(id: &str, workspace_id: i64, provider: &str) -> Result<(), String> {
    connect()?
        .execute(
            "INSERT INTO chat_sessions(id, workspace_id, provider) VALUES(?1, ?2, ?3)",
            rusqlite::params![id, workspace_id, provider],
        )
        .map_err(|e| e.to_string())?;
    activity("chat_session", &format!("Started {} session in workspace {}", provider, workspace_id))
}

pub fn update_session_title(id: &str, title: &str) -> Result<(), String> {
    connect()?
        .execute(
            "UPDATE chat_sessions SET title=?1, updated_at=datetime('now') WHERE id=?2",
            rusqlite::params![title, id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_message(
    id: &str, session_id: &str, role: &str, content: &str,
    tool_calls: Option<&str>, token_usage: Option<&str>,
) -> Result<(), String> {
    connect()?
        .execute(
            "INSERT INTO chat_messages(id, session_id, role, content, tool_calls, token_usage) VALUES(?1,?2,?3,?4,?5,?6)",
            rusqlite::params![id, session_id, role, content, tool_calls, token_usage],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_file_change(
    id: &str, session_id: &str, message_id: Option<&str>,
    file_path: &str, diff: Option<&str>, change_type: &str,
) -> Result<(), String> {
    connect()?
        .execute(
            "INSERT INTO file_changes(id, session_id, message_id, file_path, diff, change_type) VALUES(?1,?2,?3,?4,?5,?6)",
            rusqlite::params![id, session_id, message_id, file_path, diff, change_type],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_sessions(workspace_id: i64) -> Result<Vec<crate::models::SessionInfo>, String> {
    let db = connect()?;
    let mut stmt = db
        .prepare("SELECT id, workspace_id, provider, title, created_at, updated_at FROM chat_sessions WHERE workspace_id=?1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    stmt.query_map(rusqlite::params![workspace_id], |r| {
        Ok(crate::models::SessionInfo {
            id: r.get(0)?,
            workspace_id: r.get(1)?,
            provider: r.get(2)?,
            title: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn get_messages(session_id: &str) -> Result<Vec<crate::models::ChatMessageView>, String> {
    let db = connect()?;
    let mut stmt = db
        .prepare("SELECT id, session_id, role, content, tool_calls, token_usage, created_at FROM chat_messages WHERE session_id=?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    stmt.query_map(rusqlite::params![session_id], |r| {
        Ok(crate::models::ChatMessageView {
            id: r.get(0)?,
            session_id: r.get(1)?,
            role: r.get(2)?,
            content: r.get(3)?,
            tool_calls: r.get(4)?,
            token_usage: r.get(5)?,
            created_at: r.get(6)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn get_file_changes(session_id: &str) -> Result<Vec<crate::models::FileChangeView>, String> {
    let db = connect()?;
    let mut stmt = db
        .prepare("SELECT id, session_id, message_id, file_path, diff, change_type FROM file_changes WHERE session_id=?1 ORDER BY rowid ASC")
        .map_err(|e| e.to_string())?;
    stmt.query_map(rusqlite::params![session_id], |r| {
        Ok(crate::models::FileChangeView {
            id: r.get(0)?,
            session_id: r.get(1)?,
            message_id: r.get(2)?,
            file_path: r.get(3)?,
            diff: r.get(4)?,
            change_type: r.get(5)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

pub fn delete_chat_session(id: &str) -> Result<(), String> {
    connect()?
        .execute("DELETE FROM chat_sessions WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    activity("chat_session", "Deleted chat session")
}
