# Axis Security

## Untrusted skills

Axis treats every external skill and every file in its repository as untrusted. Discovery and installation read and copy files only. Axis does not run `.ps1`, `.bat`, `.cmd`, `.exe`, `.py`, `.js`, `.sh`, hooks, or other repository content.

The static scanner reports heuristic signals such as executable/script files, piped downloads, destructive filesystem commands, credential/SSH references and policy mutation. A low-risk result is not a guarantee of safety.

## Path boundaries

- GitHub archives have compressed, expanded and file-count limits.
- ZIP entries must resolve through an enclosed relative path.
- Symbolic links are rejected during extraction and installation.
- Selected skills are canonicalized and must remain below staging.
- Destination paths are derived from the current user's OS home directory and known adapter conventions.
- Unmanaged destination folders are never overwritten.

## Provenance and integrity

Managed installations record repository URL, tracked ref, relative repository path, installed commit, destination and a SHA-256 tree hash in SQLite. Axis metadata is never injected into `SKILL.md`.

Before replacing a managed installation, Axis compares its current hash to the recorded hash. Local changes stop the operation. Clean managed files are backed up before atomic replacement. Canonical copies are retained in the Axis Vault.

## Network

Version 0.1 supports public GitHub repositories through the GitHub REST and zipball endpoints. Private authentication is not implemented, so Axis does not request or store GitHub credentials.

## Known limitations

- The scanner is heuristic and does not provide malware analysis or sandbox execution.
- Windows junction/reparse-point hardening depends on Rust filesystem link detection; suspicious repositories should still be reviewed.
- Development builds are unsigned and may trigger Windows reputation warnings.

Report security issues privately to the repository owner. Do not include secrets, personal paths or malicious payloads in a public issue.
