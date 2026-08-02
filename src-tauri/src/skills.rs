use crate::{
    agents,
    models::{DetectedSkill, GithubInspection, GithubSkill, InstallRequest, UpdateStatus},
    storage,
};
use directories::BaseDirs;
use reqwest::blocking::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
};
use tempfile::TempDir;
use walkdir::WalkDir;

const MAX_ARCHIVE: u64 = 100 * 1024 * 1024;
const MAX_EXTRACTED: u64 = 250 * 1024 * 1024;
const MAX_FILES: usize = 10_000;

#[derive(Debug, Clone, PartialEq)]
pub struct GithubRef {
    pub owner: String,
    pub repo: String,
    pub path: Option<String>,
    pub reference: Option<String>,
}

pub fn parse_github_url(input: &str) -> Result<GithubRef, String> {
    let trimmed = input.trim().trim_end_matches('/').trim_end_matches(".git");
    if trimmed.contains("://")
        && !trimmed.starts_with("https://github.com/")
        && !trimmed.starts_with("http://github.com/")
    {
        return Err("Only public github.com repositories are supported".into());
    }
    let value = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .unwrap_or(trimmed);
    let parts: Vec<_> = value.split('/').filter(|p| !p.is_empty()).collect();
    let valid_slug = |value: &str| {
        !value.is_empty()
            && value != "."
            && value != ".."
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    if parts.len() < 2 || !valid_slug(parts[0]) || !valid_slug(parts[1]) {
        return Err("Enter a public GitHub repository or skill URL".into());
    }
    let (reference, path) = if parts.get(2) == Some(&"tree") && parts.len() >= 4 {
        (
            Some(parts[3].to_string()),
            (parts.len() > 4).then(|| parts[4..].join("/")),
        )
    } else {
        (None, None)
    };
    if path.as_deref().is_some_and(|value| {
        Path::new(value)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    }) {
        return Err("The GitHub skill path is unsafe".into());
    }
    Ok(GithubRef {
        owner: parts[0].into(),
        repo: parts[1].into(),
        path,
        reference,
    })
}

#[derive(Deserialize)]
struct RepoInfo {
    default_branch: String,
}
#[derive(Deserialize)]
struct CommitInfo {
    sha: String,
}
struct Download {
    _temp: TempDir,
    root: PathBuf,
    parsed: GithubRef,
    tracked_ref: String,
    commit: String,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Axis/0.1")
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())
}

fn download_repo(input: &str) -> Result<Download, String> {
    let parsed = parse_github_url(input)?;
    let client = client()?;
    let api = format!(
        "https://api.github.com/repos/{}/{}",
        parsed.owner, parsed.repo
    );
    let info: RepoInfo = client
        .get(&api)
        .send()
        .map_err(|_| "The repository could not be reached".to_string())?
        .error_for_status()
        .map_err(|_| "Public GitHub repository not found".to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    let tracked_ref = parsed.reference.clone().unwrap_or(info.default_branch);
    let commit: CommitInfo = client
        .get(format!("{api}/commits/{tracked_ref}"))
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("{api}/zipball/{tracked_ref}"))
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    if response.content_length().unwrap_or(0) > MAX_ARCHIVE {
        return Err("Repository archive exceeds the 100 MB safety limit".into());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_ARCHIVE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_ARCHIVE {
        return Err("Repository archive exceeds the 100 MB safety limit".into());
    }
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let extracted = temp.path().join("repo");
    fs::create_dir(&extracted).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "GitHub returned an invalid archive".to_string())?;
    if zip.len() > MAX_FILES {
        return Err("Repository contains too many files".into());
    }
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let mode = entry.unix_mode().unwrap_or(0);
        if mode & 0o170000 == 0o120000 {
            return Err("Repository contains a symbolic link; review it manually".into());
        }
        total = total.saturating_add(entry.size());
        if total > MAX_EXTRACTED {
            return Err("Repository expands beyond the 250 MB safety limit".into());
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or("Archive contains an unsafe path")?;
        let relative: PathBuf = enclosed.components().skip(1).collect();
        if relative.as_os_str().is_empty() {
            continue;
        }
        let out = extracted.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?
        } else {
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?
            }
            let mut file = fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
        }
    }
    Ok(Download {
        _temp: temp,
        root: extracted,
        parsed,
        tracked_ref,
        commit: commit.sha,
    })
}

fn parse_skill(path: &Path) -> Result<(String, String, String), String> {
    let markdown = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let body = markdown
        .strip_prefix("---")
        .ok_or("SKILL.md is missing YAML frontmatter")?;
    let end = body
        .find("\n---")
        .ok_or("SKILL.md has invalid YAML frontmatter")?;
    let yaml: &str = &body[..end];
    let value: serde_yaml::Value =
        serde_yaml::from_str(yaml).map_err(|e| format!("Invalid YAML: {e}"))?;
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| {
            path.parent()
                .and_then(Path::file_name)
                .and_then(|v| v.to_str())
                .unwrap_or("Unnamed")
        })
        .trim()
        .to_string();
    let description = value
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("No description provided")
        .trim()
        .to_string();
    if name.is_empty() || name.len() > 128 {
        return Err("Skill name is invalid".into());
    }
    Ok((name, description, markdown))
}

fn risk_for(root: &Path) -> (String, Vec<String>) {
    let mut reasons = Vec::new();
    let script_ext = ["ps1", "bat", "cmd", "exe", "dll", "py", "js", "sh", "msi"];
    let suspicious = [
        ("curl |", "piped network download"),
        ("wget |", "piped network download"),
        ("remove-item -recurse", "destructive filesystem command"),
        ("rm -rf", "destructive filesystem command"),
        (".ssh", "SSH path reference"),
        ("credential", "credential reference"),
        ("set-executionpolicy", "PowerShell policy mutation"),
    ];
    for entry in WalkDir::new(root)
        .follow_links(false)
        .max_depth(12)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
    {
        let ext = entry
            .path()
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if script_ext.contains(&ext.as_str()) {
            reasons.push(format!("Contains .{ext} executable or script"))
        }
        if entry
            .metadata()
            .map(|m| m.len() < 1024 * 1024)
            .unwrap_or(false)
            && let Ok(text) = fs::read_to_string(entry.path())
        {
            let lower = text.to_ascii_lowercase();
            for (needle, label) in suspicious {
                if lower.contains(needle) {
                    reasons.push(label.into())
                }
            }
        }
    }
    reasons.sort();
    reasons.dedup();
    let risk = if reasons.iter().any(|r| {
        r.contains("destructive") || r.contains("piped") || r.contains(".exe") || r.contains(".dll")
    }) {
        "Elevated risk"
    } else if reasons.is_empty() {
        "Low risk"
    } else {
        "Review recommended"
    };
    (risk.into(), reasons)
}

pub fn hash_dir(root: &Path) -> Result<String, String> {
    let mut files: Vec<_> = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(|e| e.path().to_path_buf())
        .collect();
    files.sort();
    let mut hash = Sha256::new();
    for file in files {
        let rel = file.strip_prefix(root).map_err(|e| e.to_string())?;
        hash.update(rel.to_string_lossy().as_bytes());
        hash.update(fs::read(&file).map_err(|e| e.to_string())?)
    }
    Ok(hex::encode(hash.finalize()))
}

pub fn discover(
    agents_found: &[crate::models::AgentDetection],
) -> Result<Vec<DetectedSkill>, String> {
    let mut roots: HashMap<String, Vec<String>> = HashMap::new();
    for agent in agents_found {
        for root in &agent.skill_paths {
            roots
                .entry(root.clone())
                .or_default()
                .push(agent.display_name.clone())
        }
    }
    let mut found: BTreeMap<String, DetectedSkill> = BTreeMap::new();
    for (root, root_agents) in roots {
        let root_path = PathBuf::from(&root);
        if !root_path.is_dir() {
            continue;
        }
        for entry in WalkDir::new(&root_path)
            .follow_links(false)
            .max_depth(8)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file() && e.file_name() == "SKILL.md")
        {
            let dir = entry.path().parent().unwrap_or(&root_path);
            let canonical = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
            let key = canonical.to_string_lossy().to_ascii_lowercase();
            if let Ok((name, description, markdown)) = parse_skill(entry.path()) {
                if let Some(existing) = found.get_mut(&key) {
                    for a in &root_agents {
                        if !existing.agents.contains(a) {
                            existing.agents.push(a.clone())
                        }
                    }
                    continue;
                }
                let (risk, risk_reasons) = risk_for(dir);
                let content_hash = hash_dir(dir)?;
                let path = canonical.display().to_string();
                let installed = storage::installation_hash(&path);
                let managed = installed.is_some();
                let modified = installed.as_deref().is_some_and(|h| h != content_hash);
                let files = WalkDir::new(dir)
                    .follow_links(false)
                    .max_depth(12)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|e| e.file_type().is_file())
                    .filter_map(|e| {
                        e.path()
                            .strip_prefix(dir)
                            .ok()
                            .map(|p| p.display().to_string())
                    })
                    .collect();
                found.insert(
                    key,
                    DetectedSkill {
                        id: hex::encode(Sha256::digest(path.as_bytes()))[..12].into(),
                        name,
                        description,
                        path,
                        source: if managed {
                            "Axis Vault".into()
                        } else {
                            "Source unknown".into()
                        },
                        agents: root_agents.clone(),
                        managed,
                        modified,
                        risk,
                        risk_reasons,
                        files,
                        markdown,
                        content_hash,
                    },
                );
            }
        }
    }
    Ok(found.into_values().collect())
}

pub fn inspect_github(input: &str) -> Result<GithubInspection, String> {
    let download = download_repo(input)?;
    let base = download
        .parsed
        .path
        .as_ref()
        .map(|p| download.root.join(p))
        .unwrap_or_else(|| download.root.clone());
    if !base.exists() {
        return Err("The requested path was not found in the repository".into());
    }
    let mut skills = Vec::new();
    for entry in WalkDir::new(&base)
        .follow_links(false)
        .max_depth(10)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && e.file_name() == "SKILL.md")
    {
        let dir = entry.path().parent().unwrap();
        if let Ok((name, description, _)) = parse_skill(entry.path()) {
            let (risk, risk_reasons) = risk_for(dir);
            skills.push(GithubSkill {
                relative_path: dir
                    .strip_prefix(&download.root)
                    .unwrap()
                    .display()
                    .to_string()
                    .replace('\\', "/"),
                name,
                description,
                risk,
                risk_reasons,
            })
        }
    }
    if skills.is_empty() {
        return Err("No valid SKILL.md files were found".into());
    }
    Ok(GithubInspection {
        repository: format!("{}/{}", download.parsed.owner, download.parsed.repo),
        repository_url: format!(
            "https://github.com/{}/{}",
            download.parsed.owner, download.parsed.repo
        ),
        tracked_ref: download.tracked_ref,
        commit: download.commit,
        requested_path: download.parsed.path,
        skills,
    })
}

fn safe_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_ascii_lowercase()
}
fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    for entry in WalkDir::new(source).follow_links(false).into_iter() {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_symlink() {
            return Err("Symbolic links are not installed".into());
        };
        let rel = entry
            .path()
            .strip_prefix(source)
            .map_err(|e| e.to_string())?;
        if rel.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("Unsafe path rejected".into());
        };
        let out = destination.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?
        } else {
            if let Some(p) = out.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?
            };
            fs::copy(entry.path(), out).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn replace_tree(staged: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return fs::rename(staged, destination).map_err(|e| e.to_string());
    }

    let previous = destination.with_file_name(format!(".axis-previous-{}", uuid::Uuid::new_v4()));
    fs::rename(destination, &previous).map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(staged, destination) {
        let _ = fs::rename(&previous, destination);
        return Err(error.to_string());
    }
    fs::remove_dir_all(previous).map_err(|e| e.to_string())
}

pub fn install(request: InstallRequest) -> Result<String, String> {
    if request.skills.is_empty() || request.agents.is_empty() {
        return Err("Choose at least one skill and one agent".into());
    }
    let download = download_repo(&request.url)?;
    let repo_url = format!(
        "https://github.com/{}/{}",
        download.parsed.owner, download.parsed.repo
    );
    let home = BaseDirs::new()
        .ok_or("Could not resolve home folder")?
        .home_dir()
        .to_path_buf();
    let adapters = agents::adapters();
    let mut installed = 0;
    for relative in &request.skills {
        let source = download.root.join(relative);
        let canonical =
            fs::canonicalize(&source).map_err(|_| "Selected skill no longer exists".to_string())?;
        if !canonical.starts_with(&download.root) {
            return Err("Unsafe skill path rejected".into());
        };
        let (name, _, _) = parse_skill(&canonical.join("SKILL.md"))?;
        let hash = hash_dir(&canonical)?;
        let folder = safe_name(&name);
        if folder.is_empty() {
            return Err("Skill name cannot be used as a folder".into());
        }
        let vault = storage::data_dir()?
            .join("vault")
            .join(&folder)
            .join(&download.commit);
        if !vault.exists() {
            copy_tree(&canonical, &vault)?
        }
        for agent_id in &request.agents {
            let adapter = adapters
                .iter()
                .find(|a| a.id() == agent_id)
                .ok_or("Unknown target agent")?;
            let root = adapter
                .global_skill_paths(&home)
                .into_iter()
                .next()
                .ok_or("Agent has no skill destination")?;
            fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            let destination = root.join(&folder);
            let destination_text = destination.display().to_string();
            if destination.exists() {
                let recorded = storage::installation_hash(&destination_text).ok_or_else(|| {
                    format!("{} already exists and is unmanaged", destination.display())
                })?;
                if hash_dir(&destination)? != recorded {
                    return Err(format!(
                        "Local changes detected in {name}; current files were not changed"
                    ));
                }
                let backup = storage::data_dir()?.join("backups").join(format!(
                    "{}-{}-{}",
                    chrono::Utc::now().format("%Y%m%d%H%M%S"),
                    folder,
                    agent_id
                ));
                copy_tree(&destination, &backup)?;
            }
            let staged = root.join(format!(".axis-{}", uuid::Uuid::new_v4()));
            copy_tree(&canonical, &staged)?;
            replace_tree(&staged, &destination)?;
            storage::save_installation(
                &name,
                &repo_url,
                &download.tracked_ref,
                relative,
                &download.commit,
                &hash,
                &destination_text,
            )?;
            installed += 1;
        }
    }
    storage::activity(
        "install",
        &format!("Installed {installed} skill destination(s) from {repo_url}"),
    )?;
    Ok(format!("Installed {installed} skill destination(s)"))
}

fn remote_commit(repo_url: &str, reference: &str) -> Result<String, String> {
    let parsed = parse_github_url(repo_url)?;
    let api = format!(
        "https://api.github.com/repos/{}/{}/commits/{}",
        parsed.owner, parsed.repo, reference
    );
    let info: CommitInfo = client()?
        .get(api)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    Ok(info.sha)
}
pub fn check_updates() -> Result<Vec<UpdateStatus>, String> {
    let mut results = Vec::new();
    for (name, repo, tracked, installed) in storage::installations()? {
        match remote_commit(&repo, &tracked) {
            Ok(available) => results.push(UpdateStatus {
                name,
                repository_url: repo,
                installed_commit: installed.clone(),
                available_commit: Some(available.clone()),
                status: if available == installed {
                    "Up to date".into()
                } else {
                    "Update available".into()
                },
            }),
            Err(_) => results.push(UpdateStatus {
                name,
                repository_url: repo,
                installed_commit: installed,
                available_commit: None,
                status: "Source unavailable".into(),
            }),
        }
    }
    storage::activity("update", "Checked managed skill updates")?;
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_supported_github_urls() {
        let a = parse_github_url("owner/repo").unwrap();
        assert_eq!((a.owner.as_str(), a.repo.as_str()), ("owner", "repo"));
        let b = parse_github_url("https://github.com/o/r/tree/main/skills/a").unwrap();
        assert_eq!(b.path.as_deref(), Some("skills/a"));
    }
    #[test]
    fn rejects_non_github_shape() {
        assert!(parse_github_url("https://example.com/a").is_err());
        assert!(parse_github_url("https://github.com/o/r/tree/main/../secret").is_err());
    }
    #[test]
    fn stable_hash_changes_with_content() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("SKILL.md"), "a").unwrap();
        let a = hash_dir(d.path()).unwrap();
        fs::write(d.path().join("SKILL.md"), "b").unwrap();
        assert_ne!(a, hash_dir(d.path()).unwrap());
    }
}
