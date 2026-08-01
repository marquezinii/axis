use crate::models::AgentDetection;
use directories::BaseDirs;
use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

pub trait AgentAdapter {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn executables(&self) -> &'static [&'static str];
    fn config_paths(&self, home: &Path) -> Vec<PathBuf>;
    fn global_skill_paths(&self, home: &Path) -> Vec<PathBuf>;
    fn project_skill_paths(&self, workspace: &Path) -> Vec<PathBuf>;
    fn capabilities(&self) -> Vec<String> {
        vec!["Skills".into(), "Discovery".into()]
    }

    fn detect(&self, workspaces: &[PathBuf]) -> AgentDetection {
        let home = BaseDirs::new()
            .map(|d| d.home_dir().to_path_buf())
            .unwrap_or_default();
        let executable = find_executable(self.executables());
        let configs = self.config_paths(&home);
        let mut skill_paths = self.global_skill_paths(&home);
        for workspace in workspaces {
            skill_paths.extend(self.project_skill_paths(workspace));
        }
        let has_config =
            configs.iter().any(|p| p.exists()) || skill_paths.iter().any(|p| p.exists());
        let status = if executable.is_some() {
            "Confirmed"
        } else if has_config {
            "Configuration only"
        } else {
            "Not installed"
        };
        let version = executable.as_deref().and_then(read_version);
        AgentDetection {
            id: self.id().into(),
            display_name: self.display_name().into(),
            status: status.into(),
            version,
            executable: executable.map(|p| p.display().to_string()),
            config_paths: configs
                .into_iter()
                .map(|p| p.display().to_string())
                .collect(),
            skill_paths: skill_paths
                .into_iter()
                .map(|p| p.display().to_string())
                .collect(),
            capabilities: self.capabilities(),
        }
    }
}

fn find_executable(names: &[&str]) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|value| {
        env::split_paths(&value).find_map(|dir| {
            names.iter().find_map(|name| {
                [
                    dir.join(name),
                    dir.join(format!("{name}.exe")),
                    dir.join(format!("{name}.cmd")),
                ]
                .into_iter()
                .find(|path| path.is_file())
            })
        })
    })
}

fn read_version(path: &Path) -> Option<String> {
    let output = Command::new(path).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

pub struct Codex;
impl AgentAdapter for Codex {
    fn id(&self) -> &'static str {
        "codex"
    }
    fn display_name(&self) -> &'static str {
        "Codex"
    }
    fn executables(&self) -> &'static [&'static str] {
        &["codex"]
    }
    fn config_paths(&self, h: &Path) -> Vec<PathBuf> {
        vec![h.join(".codex")]
    }
    fn global_skill_paths(&self, h: &Path) -> Vec<PathBuf> {
        vec![h.join(".agents/skills")]
    }
    fn project_skill_paths(&self, w: &Path) -> Vec<PathBuf> {
        vec![w.join(".agents/skills")]
    }
}

pub struct Claude;
impl AgentAdapter for Claude {
    fn id(&self) -> &'static str {
        "claude"
    }
    fn display_name(&self) -> &'static str {
        "Claude Code"
    }
    fn executables(&self) -> &'static [&'static str] {
        &["claude"]
    }
    fn config_paths(&self, h: &Path) -> Vec<PathBuf> {
        vec![h.join(".claude")]
    }
    fn global_skill_paths(&self, h: &Path) -> Vec<PathBuf> {
        vec![h.join(".claude/skills")]
    }
    fn project_skill_paths(&self, w: &Path) -> Vec<PathBuf> {
        vec![w.join(".claude/skills")]
    }
}

pub struct OpenCode;
impl AgentAdapter for OpenCode {
    fn id(&self) -> &'static str {
        "opencode"
    }
    fn display_name(&self) -> &'static str {
        "OpenCode"
    }
    fn executables(&self) -> &'static [&'static str] {
        &["opencode"]
    }
    fn config_paths(&self, h: &Path) -> Vec<PathBuf> {
        vec![h.join(".config/opencode")]
    }
    fn global_skill_paths(&self, h: &Path) -> Vec<PathBuf> {
        vec![
            h.join(".config/opencode/skills"),
            h.join(".claude/skills"),
            h.join(".agents/skills"),
        ]
    }
    fn project_skill_paths(&self, w: &Path) -> Vec<PathBuf> {
        vec![
            w.join(".opencode/skills"),
            w.join(".claude/skills"),
            w.join(".agents/skills"),
        ]
    }
}

pub struct Antigravity;
impl AgentAdapter for Antigravity {
    fn id(&self) -> &'static str {
        "antigravity"
    }
    fn display_name(&self) -> &'static str {
        "Antigravity"
    }
    fn executables(&self) -> &'static [&'static str] {
        &["antigravity"]
    }
    fn config_paths(&self, h: &Path) -> Vec<PathBuf> {
        vec![h.join(".gemini")]
    }
    fn global_skill_paths(&self, h: &Path) -> Vec<PathBuf> {
        vec![h.join(".gemini/config/skills")]
    }
    fn project_skill_paths(&self, w: &Path) -> Vec<PathBuf> {
        vec![w.join(".agents/skills")]
    }
}

pub fn adapters() -> Vec<Box<dyn AgentAdapter>> {
    vec![
        Box::new(Codex),
        Box::new(Claude),
        Box::new(OpenCode),
        Box::new(Antigravity),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adapters_have_unique_ids() {
        let ids: Vec<_> = adapters().iter().map(|a| a.id()).collect();
        assert_eq!(ids.len(), 4);
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            4
        );
    }
}
