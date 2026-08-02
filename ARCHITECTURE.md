# Arquitetura

Axis é um aplicativo Windows local com frontend React e backend Tauri/Rust.

- `src/`: interface, estado local e chamadas IPC estreitas.
- `src-tauri/src/agents.rs`: convenções de descoberta para cada agente.
- `src-tauri/src/skills.rs`: download público, validação de ZIP, inspeção, hash, vault e instalação.
- `src-tauri/src/storage.rs`: SQLite sob LocalAppData.
- `scripts/sync-desktop-shortcut.ps1`: atualiza o atalho da Área de Trabalho após uma build local.

O renderer não recebe acesso genérico ao sistema de arquivos nem execução de comandos. Conteúdo de skills é lido e copiado; não é executado pelo Axis.
