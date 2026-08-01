mod agents;
mod models;
mod skills;
mod storage;

use models::{Dashboard, GithubInspection, InstallRequest, UpdateStatus};
use std::{path::PathBuf, process::Command};

fn snapshot() -> Result<Dashboard, String> {
    let workspaces = storage::workspaces()?;
    let paths: Vec<PathBuf> = workspaces.iter().map(|w| PathBuf::from(&w.path)).collect();
    let agents: Vec<_> = agents::adapters()
        .iter()
        .map(|adapter| adapter.detect(&paths))
        .collect();
    let skills = skills::discover(&agents)?;
    Ok(Dashboard {
        agents,
        skills,
        activities: storage::activities()?,
        workspaces,
        sources: storage::sources()?,
        first_run: storage::is_first_run()?,
        data_path: storage::data_dir()?.display().to_string(),
    })
}

#[tauri::command]
fn get_dashboard() -> Result<Dashboard, String> {
    snapshot()
}
#[tauri::command]
fn rescan() -> Result<Dashboard, String> {
    storage::activity("scan", "Scanned agents and skills")?;
    storage::finish_onboarding()?;
    snapshot()
}
#[tauri::command]
fn choose_workspace() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.display().to_string())
}
#[tauri::command]
fn add_workspace(path: String) -> Result<Dashboard, String> {
    storage::add_workspace(&path)?;
    snapshot()
}
#[tauri::command]
fn remove_workspace(id: i64) -> Result<Dashboard, String> {
    storage::remove_workspace(id)?;
    snapshot()
}
#[tauri::command]
fn add_source(url: String) -> Result<Dashboard, String> {
    storage::add_source(&url)?;
    snapshot()
}
#[tauri::command]
fn remove_source(id: i64) -> Result<Dashboard, String> {
    storage::remove_source(id)?;
    snapshot()
}
#[tauri::command]
fn inspect_github(url: String) -> Result<GithubInspection, String> {
    skills::inspect_github(&url)
}
#[tauri::command]
fn install_github(request: InstallRequest) -> Result<Dashboard, String> {
    skills::install(request)?;
    snapshot()
}
#[tauri::command]
fn check_updates() -> Result<Vec<UpdateStatus>, String> {
    skills::check_updates()
}
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|_| "Folder no longer exists".to_string())?;
    if !canonical.exists() {
        return Err("Folder no longer exists".into());
    }
    Command::new("explorer.exe")
        .arg(canonical)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    storage::connect().expect("failed to initialize Axis storage");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_dashboard,
            rescan,
            choose_workspace,
            add_workspace,
            remove_workspace,
            add_source,
            remove_source,
            inspect_github,
            install_github,
            check_updates,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Axis");
}
