//! systemd user unit and launchd plist for `dbench serve`.

use std::ffi::OsString;
use std::path::Path;

pub const LAUNCHD_LABEL: &str = "com.awesome-local-ai.dbench";
/// Seconds systemd waits before restarting a stopped server.
pub const SYSTEMD_RESTART_SEC: u32 = 5;

/// Quote one argument for a systemd `ExecStart=` line.
fn systemd_escape(arg: &str) -> String {
    arg.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('%', "%%")
        .replace('$', "$$")
}

fn systemd_quote(arg: &str) -> String {
    let escaped = systemd_escape(arg);
    if escaped.is_empty() || escaped.contains(char::is_whitespace) || escaped != arg {
        format!("\"{escaped}\"")
    } else {
        escaped
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn systemd(exe: &Path, argv: &[OsString], path_env: &str) -> String {
    let mut exec = vec![systemd_quote(&exe.to_string_lossy())];
    exec.extend(argv.iter().map(|a| systemd_quote(&a.to_string_lossy())));
    format!(
        "\
[Unit]
Description=dbench benchmark node server
Wants=network-online.target
After=network-online.target

[Service]
ExecStart={exec}
Environment=\"PATH={path}\"
Restart=always
RestartSec={SYSTEMD_RESTART_SEC}
# Stop only dbench itself: the harness keeps running across a dbench restart
# and the new server adopts it.
KillMode=process

[Install]
WantedBy=default.target
",
        exec = exec.join(" "),
        path = systemd_escape(path_env),
    )
}

pub fn launchd(exe: &Path, argv: &[OsString], path_env: &str, log_file: &Path) -> String {
    let mut args = format!(
        "    <string>{}</string>\n",
        xml_escape(&exe.to_string_lossy())
    );
    for a in argv {
        args.push_str(&format!(
            "    <string>{}</string>\n",
            xml_escape(&a.to_string_lossy())
        ));
    }
    let log = xml_escape(&log_file.to_string_lossy());
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
{args}  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>{path}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <!-- Leave the harness running when dbench exits; the next dbench adopts it. -->
  <key>AbandonProcessGroup</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
</dict>
</plist>
"#,
        path = xml_escape(path_env),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn systemd_unit() {
        let argv: Vec<OsString> = [
            "serve",
            "--bind",
            "100.1.2.3:7717",
            "--repo",
            "/home/j/my repo",
        ]
        .map(Into::into)
        .to_vec();
        let u = systemd(
            Path::new("/home/j/.local/bin/dbench"),
            &argv,
            "/usr/bin:/bin",
        );
        assert!(u.contains("ExecStart=/home/j/.local/bin/dbench serve --bind 100.1.2.3:7717 --repo \"/home/j/my repo\"\n"), "{u}");
        assert!(u.contains("KillMode=process"));
        assert!(u.contains("Environment=\"PATH=/usr/bin:/bin\""));
        assert_eq!(systemd_quote("50%"), "\"50%%\"");
    }

    #[test]
    fn launchd_plist() {
        let argv: Vec<OsString> = ["serve", "--repo", "/a&b"].map(Into::into).to_vec();
        let p = launchd(
            Path::new("/x/dbench"),
            &argv,
            "/opt/homebrew/bin:/usr/bin",
            Path::new("/h/.dbench/dbench.log"),
        );
        assert!(p.contains("<string>/a&amp;b</string>"));
        assert!(p.contains("<key>AbandonProcessGroup</key>"));
        assert!(p.contains(LAUNCHD_LABEL));
    }
}
