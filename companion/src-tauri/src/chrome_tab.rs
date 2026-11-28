//! Chrome's own tab identity, not a window-title heuristic. Fixed read-only
//! AppleScript; no URLs, titles, DOM, private-window IDs, or user input.
#[cfg(target_os = "macos")]
pub const SCRIPT: &str = r#"
if application id "com.google.Chrome" is not running then return "inactive"
with timeout of 10 seconds
    tell application id "com.google.Chrome"
        if not frontmost then return "inactive"
        if (count of windows) is 0 then return "inactive"
        if (mode of front window) is not "normal" then return "private"
        set tabID to (id of active tab of front window) as text
        if not frontmost then return "inactive"
        if (mode of front window) is not "normal" then return "private"
        if ((id of active tab of front window) as text) is not tabID then return "inactive"
        return "tab:" & tabID
    end tell
end timeout
"#;

#[cfg(any(test, target_os = "macos"))]
pub fn parse(output: &str, pid: i32) -> Result<(Option<String>, Option<String>), String> {
    match output.trim() {
        "inactive" => Ok((None, Some("Waiting for a normal foreground Chrome window".into()))),
        "private" => Ok((None, Some("Private Chrome window skipped".into()))),
        value => {
            let id = value.strip_prefix("tab:").ok_or("Unexpected Chrome tab response")?;
            if pid <= 0 || id.is_empty() || id.len() > 32 || !id.bytes().all(|c| c.is_ascii_digit()) {
                return Err("Invalid Chrome tab identifier".into());
            }
            Ok((Some(format!("chrome:{pid}:{id}")), None))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_tab_id_changes_without_titles() {
        let a = parse("tab:123\n", 12).unwrap().0;
        assert_eq!(a, parse("tab:123", 12).unwrap().0);
        assert_ne!(a, parse("tab:124", 12).unwrap().0);
        assert_ne!(a, parse("tab:123", 13).unwrap().0);
    }
    #[test]
    fn private_and_invalid_data_never_create_reference() {
        assert!(parse("private", 12).unwrap().0.is_none());
        assert!(parse("inactive", 12).unwrap().0.is_none());
        assert!(parse("tab:https://example.org", 12).is_err());
        assert!(parse("tab:123\n456", 12).is_err());
        assert!(parse("tab:", 12).is_err());
    }
}
