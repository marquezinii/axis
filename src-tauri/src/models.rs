use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetection {
    pub id: String,
    pub display_name: String,
    pub status: String,
    pub version: Option<String>,
    pub executable: Option<String>,
    pub config_paths: Vec<String>,
    pub skill_paths: Vec<String>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
    pub agents: Vec<String>,
    pub managed: bool,
    pub modified: bool,
    pub risk: String,
    pub risk_reasons: Vec<String>,
    pub files: Vec<String>,
    pub markdown: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: i64,
    pub kind: String,
    pub message: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: i64,
    pub path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: i64,
    pub url: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub agents: Vec<AgentDetection>,
    pub skills: Vec<DetectedSkill>,
    pub activities: Vec<Activity>,
    pub workspaces: Vec<Workspace>,
    pub sources: Vec<Source>,
    pub first_run: bool,
    pub data_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSkill {
    pub relative_path: String,
    pub name: String,
    pub description: String,
    pub risk: String,
    pub risk_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubInspection {
    pub repository: String,
    pub repository_url: String,
    pub tracked_ref: String,
    pub commit: String,
    pub requested_path: Option<String>,
    pub skills: Vec<GithubSkill>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub name: String,
    pub repository_url: String,
    pub installed_commit: String,
    pub available_commit: Option<String>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub url: String,
    pub skills: Vec<String>,
    pub agents: Vec<String>,
}
