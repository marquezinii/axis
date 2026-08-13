#[cfg(test)]
mod tests {
    use axis_lib::storage;

    #[test]
    fn test_chat_tables_exist_after_connect() {
        let conn = storage::connect().expect("connect should succeed");
        // Verify tables exist by querying sqlite_master
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='chat_sessions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "chat_sessions table should exist");
    }

    #[test]
    fn test_save_and_get_session() {
        // Create a workspace so the foreign key constraint is satisfied
        let conn = storage::connect().expect("connect should succeed");
        conn.execute(
            "INSERT OR IGNORE INTO workspaces(path) VALUES('/tmp/axis-test-workspace')",
            [],
        )
        .expect("insert workspace");
        let workspace_id: i64 = conn
            .query_row(
                "SELECT id FROM workspaces WHERE path='/tmp/axis-test-workspace'",
                [],
                |r| r.get(0),
            )
            .expect("get workspace id");

        let id = format!("test-session-{}", uuid::Uuid::new_v4());
        storage::save_session(&id, workspace_id, "claude").expect("save_session");
        let sessions = storage::get_sessions(workspace_id).expect("get_sessions");
        assert!(sessions.iter().any(|s| s.id == id));
    }

    #[test]
    fn test_installation_provenance_roundtrip() {
        let destination = format!("/tmp/axis-provenance-{}", uuid::Uuid::new_v4());
        assert!(storage::installation_provenance(&destination).is_none());
        storage::save_installation(
            "provenance-test",
            "https://github.com/owner/repo",
            "main",
            "skills/demo",
            "abcdef",
            "hash",
            &destination,
        )
        .expect("save_installation should succeed");
        let provenance = storage::installation_provenance(&destination).expect("provenance");
        assert_eq!(provenance.0, "https://github.com/owner/repo");
        assert_eq!(provenance.1, "skills/demo");
    }
}
