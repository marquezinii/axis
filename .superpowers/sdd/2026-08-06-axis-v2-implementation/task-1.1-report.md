## Status: DONE

## Commits
- 9b0de94 build: add chat provider dependencies (reqwest stream, tokio, eventsource-stream, async-trait)

## Tests
- Command run: `cargo check --manifest-path src-tauri/Cargo.toml`
- Result: Success. Downloaded and compiled new crates (eventsource-stream v0.2.3, async-trait v0.1.91, tokio v1.53.1, futures-util v0.3.33, plus transitive deps nom, tokio-macros, tokio-util, wasm-streams). Finished `dev` profile with no errors. (The PowerShell "RemoteException" line in the captured output is just the shell surfacing cargo's stderr stream; the cargo result itself was clean.)

## Concerns
- The plan brief (Task 1.1) lists only `tokio`, `eventsource-stream`, and `async-trait` as new deps, but the task summary also requested `futures-util`. I added `futures-util = "0.3"` as well since it is a standard companion for async stream processing and was explicitly requested in the task summary. It is currently unused (no code references yet), so it may produce an unused-dependency note in later tasks until Task 1.2+ consumes it.
- `Cargo.toml` version remains `0.1.0`. The `0.2.0` version bump is a separate later task (Step 4 in the plan), so I left it untouched per the "just adding deps" instruction.
- `reqwest` `stream` feature added as specified; `default-features = false` preserved.