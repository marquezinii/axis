# Como contribuir

## Ambiente local

Instale Node.js 22, pnpm, Rust stable com MSVC, Visual Studio Build Tools e WebView2. Depois execute `pnpm install` e `pnpm tauri dev`.

## Antes de abrir um pull request

```powershell
pnpm format:check
pnpm check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Mantenha o escopo pequeno, descreva a validação e nunca inclua credenciais, dados locais do Axis ou conteúdo pessoal nos commits.
