#[cfg(test)]
mod tests {
    use axis_lib::storage;

    #[test]
    fn test_session_lifecycle() {
        let sid = format!("int-{}", uuid::Uuid::new_v4());
        // Create workspace first
        storage::add_workspace("C:\\").unwrap();
        let workspaces = storage::workspaces().unwrap();
        let ws_id = workspaces.last().unwrap().id;

        storage::save_session(&sid, ws_id, "claude").unwrap();
        let sessions = storage::get_sessions(ws_id).unwrap();
        assert!(sessions.iter().any(|s| s.id == sid));

        storage::delete_chat_session(&sid).unwrap();
        let after = storage::get_sessions(ws_id).unwrap();
        assert!(!after.iter().any(|s| s.id == sid));
    }

    #[test]
    fn test_message_persistence() {
        let sid = format!("msg-{}", uuid::Uuid::new_v4());
        let workspaces = storage::workspaces().unwrap();
        let ws_id = workspaces.last().unwrap().id;

        storage::save_session(&sid, ws_id, "claude").unwrap();

        let mid = uuid::Uuid::new_v4().to_string();
        storage::save_message(&mid, &sid, "user", "Hello", None, None).unwrap();

        let msgs = storage::get_messages(&sid).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "Hello");
    }
}