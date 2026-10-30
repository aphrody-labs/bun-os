// SPDX-License-Identifier: GPL-3.0-only
//! Parser for `wsl --status`. Labels are localized, so values are matched by the English label
//! first; unknown lines are kept as notices and never fail the parse.

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslStatus {
    pub default_distribution: Option<String>,
    pub default_version: Option<u8>,
    /// The "kernel file is not found" notice is present.
    pub kernel_file_missing: bool,
    /// Every other non-empty line, verbatim, for the UI.
    pub notices: Vec<String>,
}

pub fn parse_wsl_status(output: &str) -> WslStatus {
    let mut st = WslStatus::default();
    let output = output.trim_start_matches('\u{FEFF}');
    for raw in output.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((label, value)) = line.split_once([':', '：']) {
            let label = label.trim().to_lowercase();
            let value = value.trim();
            if label.contains("default") && label.contains("distribution") {
                if !value.is_empty() {
                    st.default_distribution = Some(value.to_string());
                }
                continue;
            }
            if label.contains("default") && label.contains("version") {
                st.default_version = value.parse().ok();
                continue;
            }
        }
        let lower = line.to_lowercase();
        if lower.contains("kernel")
            && (lower.contains("not found") || lower.contains("not installed"))
        {
            st.kernel_file_missing = true;
        }
        st.notices.push(line.to_string());
    }
    st
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_OK: &str = "Default Distribution: bunos\nDefault Version: 2\n";
    const FIXTURE_NOTICES: &str = "\u{FEFF}Default Distribution: Ubuntu\r\nDefault Version: 2\r\n\r\nWSL1 is not supported with your current machine configuration.\r\nPlease enable the \"Virtual Machine Platform\" optional component and ensure virtualization is enabled in the BIOS.\r\n\r\nThe WSL 2 kernel file is not found. To update or restore the kernel please run \"wsl --update\".\r\n";

    #[test]
    fn plain_status() {
        let s = parse_wsl_status(FIXTURE_OK);
        assert_eq!(s.default_distribution.as_deref(), Some("bunos"));
        assert_eq!(s.default_version, Some(2));
        assert!(!s.kernel_file_missing && s.notices.is_empty());
    }

    #[test]
    fn status_with_bom_crlf_and_notices() {
        let s = parse_wsl_status(FIXTURE_NOTICES);
        assert_eq!(s.default_distribution.as_deref(), Some("Ubuntu"));
        assert!(s.kernel_file_missing);
        assert_eq!(s.notices.len(), 3);
    }

    #[test]
    fn empty_and_garbage_do_not_panic() {
        assert_eq!(parse_wsl_status(""), WslStatus::default());
        assert_eq!(parse_wsl_status("???").notices, vec!["???".to_string()]);
    }
}
