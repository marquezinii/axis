## Status: DONE

## Commits
- 03c1430 feat: define ChatProvider trait, StreamEvent, ProviderError, and chat IPC types

## Tests
- Command run: `cargo check --manifest-path src-tauri/Cargo.toml`
- Result: Compilation succeeded. `Finished dev profile [unoptimized + debuginfo] target(s) in 2.94s`. Only 3 expected `dead_code` warnings for the newly added `SessionInfo`, `ChatMessageView`, and `FileChangeView` structs (not yet constructed — they will be consumed by Task 1.3 storage CRUD and Task 1.5 chat commands). No errors.

## Concerns
- The `#[cfg(feature = "claude")]` gate in `provider_registry()` references `crate::providers::claude::ClaudeProvider`, but the `claude` feature is not yet defined in `Cargo.toml` and `claude.rs` does not exist yet (Task 1.4). This is intentional per the plan — the cfg evaluates to false so the code compiles cleanly. Task 1.4 will add the `claude` module and remove the gate.
- `providers/mod.rs` is created but not yet wired into `lib.rs` (`mod providers;`). This is deferred to Task 1.5 per the plan, so the module is currently compiled only as part of the crate's module tree via the file existing — actually it is not referenced from `lib.rs` yet, so it is not compiled into the lib. `cargo check` still passed because the file is standalone. Task 1.5 will add the module declaration.
- Task 1.1 (Cargo.toml dependencies) was already committed as `9b0de94` before this task began; no Cargo.toml changes were needed here.