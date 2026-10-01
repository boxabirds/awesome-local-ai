//! The allow-listing CONNECT proxy: which hosts match, what it answers, what it logs.
//! Everything here runs on loopback; nothing needs the internet.

mod common;

use agent_sandbox::proxy::{parse_connect, spawn, AllowList, HostRule, HTTPS_PORT};
use common::TempDir;
use std::io::{BufRead, BufReader};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

const IO_TIMEOUT: Duration = Duration::from_secs(10);
const ANY_PORT: u16 = 0;
const OTHER_PORT: u16 = 8443;
const NPM: &str = "registry.npmjs.org";
const BIN: &str = env!("CARGO_BIN_EXE_agent-sandbox");

fn allow(entries: &[&str]) -> AllowList {
    AllowList::parse(&entries.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap()
}

#[test]
fn a_rule_is_a_host_on_port_443_unless_it_names_a_port() {
    assert_eq!(
        HostRule::parse(NPM).unwrap(),
        HostRule {
            host: NPM.into(),
            port: HTTPS_PORT
        }
    );
    assert_eq!(
        HostRule::parse("Example.COM.:8443").unwrap(),
        HostRule {
            host: "example.com".into(),
            port: OTHER_PORT
        }
    );
    assert_eq!(
        HostRule::parse("[::1]:8443").unwrap(),
        HostRule {
            host: "::1".into(),
            port: OTHER_PORT
        }
    );
}

#[test]
fn a_rule_that_is_not_a_plain_host_is_refused() {
    for bad in [
        "",
        "*",
        "*.npmjs.org",
        "https://registry.npmjs.org",
        "host/path",
        "host:notaport",
        "host:0",
        "a b",
        ".org",
        "host:",
    ] {
        assert!(HostRule::parse(bad).is_err(), "{bad:?} should not parse");
    }
}

#[test]
fn a_host_matches_itself_and_its_subdomains_only() {
    let a = allow(&[NPM]);
    assert!(a.allows(NPM, HTTPS_PORT));
    assert!(a.allows("cdn.registry.npmjs.org", HTTPS_PORT));
    assert!(
        !a.allows("npmjs.org", HTTPS_PORT),
        "the parent domain is not allowed"
    );
    assert!(
        !a.allows("evil-registry.npmjs.org", HTTPS_PORT),
        "a sibling is not a subdomain"
    );
    assert!(!a.allows("evilregistry.npmjs.org", HTTPS_PORT));
    assert!(!a.allows("registry.npmjs.org.attacker.com", HTTPS_PORT));
    assert!(!a.allows("evil-registry.npmjs.org.attacker.com", HTTPS_PORT));
    assert!(!a.allows("github.com", HTTPS_PORT));
    assert!(!a.allows("", HTTPS_PORT));
}

#[test]
fn matching_ignores_case_and_a_trailing_dot() {
    let a = allow(&["Registry.NPMJS.org"]);
    assert!(a.allows("REGISTRY.npmjs.ORG", HTTPS_PORT));
    assert!(a.allows("registry.npmjs.org.", HTTPS_PORT));
}

#[test]
fn the_port_must_match_the_rule() {
    let a = allow(&[NPM, "internal.example:8443"]);
    assert!(!a.allows(NPM, OTHER_PORT));
    assert!(!a.allows(NPM, 80));
    assert!(a.allows("internal.example", OTHER_PORT));
    assert!(!a.allows("internal.example", HTTPS_PORT));
}

#[test]
fn an_ip_literal_matches_only_when_listed_exactly() {
    let a = allow(&[NPM, "192.0.2.7", "[2001:db8::1]"]);
    assert!(a.allows("192.0.2.7", HTTPS_PORT));
    assert!(a.allows("2001:db8::1", HTTPS_PORT));
    assert!(!a.allows("192.0.2.8", HTTPS_PORT));
    assert!(
        !a.allows("10.192.0.2.7", HTTPS_PORT),
        "an address rule has no subdomains"
    );
    assert!(!a.allows("127.0.0.1", HTTPS_PORT));
    assert!(!a.allows("::1", HTTPS_PORT));
}

#[test]
fn an_empty_list_allows_nothing() {
    assert!(!AllowList::default().allows(NPM, HTTPS_PORT));
}

#[test]
fn parse_connect_reads_host_and_port_from_the_request_line() {
    assert_eq!(
        parse_connect(b"CONNECT registry.npmjs.org:443 HTTP/1.1\r\nHost: x\r\n\r\n"),
        Some((NPM.to_string(), HTTPS_PORT))
    );
    assert_eq!(
        parse_connect(b"connect Example.com:8443 HTTP/1.1\r\n\r\n"),
        Some(("Example.com".to_string(), OTHER_PORT))
    );
    assert_eq!(
        parse_connect(b"CONNECT [2001:db8::1]:443 HTTP/1.1\r\n\r\n"),
        Some(("2001:db8::1".to_string(), HTTPS_PORT))
    );
}

#[test]
fn parse_connect_refuses_everything_that_is_not_a_connect_to_a_host_and_port() {
    for bad in [
        &b"GET http://registry.npmjs.org/ HTTP/1.1\r\n\r\n"[..],
        b"POST / HTTP/1.1\r\n\r\n",
        b"CONNECT registry.npmjs.org HTTP/1.1\r\n\r\n",
        b"CONNECT registry.npmjs.org:https HTTP/1.1\r\n\r\n",
        b"CONNECT :443 HTTP/1.1\r\n\r\n",
        b"CONNECT registry.npmjs.org:443\r\n\r\n",
        b"CONNECT registry.npmjs.org:99999 HTTP/1.1\r\n\r\n",
        b"\r\n\r\n",
        b"\xff\xfe\r\n\r\n",
    ] {
        assert_eq!(
            parse_connect(bad),
            None,
            "{:?}",
            String::from_utf8_lossy(bad)
        );
    }
}

/// Send `request` to the proxy and return everything it answers until it closes or goes quiet.
fn ask(proxy_port: u16, request: &[u8]) -> String {
    let mut s = TcpStream::connect(("127.0.0.1", proxy_port)).unwrap();
    s.set_read_timeout(Some(IO_TIMEOUT)).unwrap();
    s.write_all(request).unwrap();
    let mut out = Vec::new();
    let _ = s.read_to_end(&mut out);
    String::from_utf8_lossy(&out).into_owned()
}

fn log_lines(path: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).expect("each log line is JSON"))
        .collect()
}

/// A server that answers each connection's bytes back in upper case, then closes.
fn shouting_server() -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", ANY_PORT)).unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut c) = conn else { break };
            let mut buf = [0u8; 64];
            if let Ok(n) = c.read(&mut buf) {
                let _ = c.write_all(buf[..n].to_ascii_uppercase().as_slice());
            }
            let _ = c.shutdown(Shutdown::Both);
        }
    });
    port
}

#[test]
fn a_connect_to_an_allowed_host_is_tunnelled_and_logged() {
    let t = TempDir::new();
    let log = t.path().join("proxy.jsonl");
    let upstream = shouting_server();
    let proxy = spawn(
        allow(&[&format!("localhost:{upstream}")]),
        Some(log.clone()),
        ANY_PORT,
    )
    .unwrap();
    let mut s = TcpStream::connect(("127.0.0.1", proxy.port)).unwrap();
    s.set_read_timeout(Some(IO_TIMEOUT)).unwrap();
    write!(
        s,
        "CONNECT localhost:{upstream} HTTP/1.1\r\nHost: localhost\r\n\r\n"
    )
    .unwrap();
    let mut head = [0u8; 39];
    s.read_exact(&mut head).unwrap();
    assert_eq!(&head[..], b"HTTP/1.1 200 Connection Established\r\n\r\n");
    s.write_all(b"hello").unwrap();
    let mut reply = String::new();
    s.read_to_string(&mut reply).unwrap();
    assert_eq!(reply, "HELLO");
    let lines = log_lines(&log);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["allowed"], true);
    assert_eq!(
        lines[0]["request"],
        format!("CONNECT localhost:{upstream} HTTP/1.1")
    );
    assert!(lines[0]["t"].as_f64().unwrap() > 0.0);
}

#[test]
fn a_connect_to_any_other_host_gets_403_and_is_logged_without_any_connection_being_made() {
    let t = TempDir::new();
    let log = t.path().join("proxy.jsonl");
    let proxy = spawn(allow(&[NPM]), Some(log.clone()), ANY_PORT).unwrap();
    for target in [
        "github.com:443",
        "registry.npmjs.org.attacker.com:443",
        "registry.npmjs.org:22",
        "127.0.0.1:443",
    ] {
        let answer = ask(
            proxy.port,
            format!("CONNECT {target} HTTP/1.1\r\n\r\n").as_bytes(),
        );
        assert!(answer.starts_with("HTTP/1.1 403 "), "{target}: {answer:?}");
    }
    let lines = log_lines(&log);
    assert_eq!(lines.len(), 4);
    assert!(lines.iter().all(|l| l["allowed"] == false));
    assert_eq!(lines[0]["request"], "CONNECT github.com:443 HTTP/1.1");
}

#[test]
fn a_request_that_is_not_connect_is_refused_even_for_an_allowed_host() {
    let t = TempDir::new();
    let log = t.path().join("proxy.jsonl");
    let proxy = spawn(allow(&[NPM]), Some(log.clone()), ANY_PORT).unwrap();
    let answer = ask(
        proxy.port,
        b"GET http://registry.npmjs.org/is-number HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\n",
    );
    assert!(answer.starts_with("HTTP/1.1 403 "), "{answer:?}");
    let lines = log_lines(&log);
    assert_eq!(lines[0]["allowed"], false);
    assert_eq!(
        lines[0]["request"],
        "GET http://registry.npmjs.org/is-number HTTP/1.1"
    );
}

#[test]
fn an_allowed_host_that_cannot_be_reached_gets_502() {
    let closed = {
        let l = TcpListener::bind(("127.0.0.1", ANY_PORT)).unwrap();
        l.local_addr().unwrap().port()
    };
    let proxy = spawn(allow(&[&format!("localhost:{closed}")]), None, ANY_PORT).unwrap();
    let answer = ask(
        proxy.port,
        format!("CONNECT localhost:{closed} HTTP/1.1\r\n\r\n").as_bytes(),
    );
    assert!(answer.starts_with("HTTP/1.1 502 "), "{answer:?}");
}

#[test]
fn a_request_head_that_never_ends_is_refused_and_a_silent_client_does_not_block_others() {
    let proxy = spawn(allow(&[NPM]), None, ANY_PORT).unwrap();
    let _silent = TcpStream::connect(("127.0.0.1", proxy.port)).unwrap();
    let endless = vec![b'A'; 64 * 1024];
    let answer = ask(proxy.port, &endless);
    assert!(
        answer.is_empty() || answer.starts_with("HTTP/1.1 4"),
        "{answer:?}"
    );
    let answer = ask(proxy.port, b"CONNECT github.com:443 HTTP/1.1\r\n\r\n");
    assert!(answer.starts_with("HTTP/1.1 403 "));
}

#[test]
fn a_long_request_line_is_cut_in_the_log() {
    let t = TempDir::new();
    let log = t.path().join("proxy.jsonl");
    let proxy = spawn(allow(&[NPM]), Some(log.clone()), ANY_PORT).unwrap();
    let long = format!("GET /{} HTTP/1.1\r\n\r\n", "x".repeat(2000));
    ask(proxy.port, long.as_bytes());
    let lines = log_lines(&log);
    assert!(lines[0]["request"].as_str().unwrap().len() <= 200);
}

#[test]
fn the_proxy_listens_on_loopback_only() {
    let proxy = spawn(allow(&[NPM]), None, ANY_PORT).unwrap();
    assert!(proxy.port > 0);
    assert!(TcpStream::connect(("127.0.0.1", proxy.port)).is_ok());
}

/// A child process that is killed and reaped when the test ends, however it ends.
struct Reaped(Child);

impl Drop for Reaped {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn the_proxy_subcommand_prints_its_port_then_serves_presets_and_listed_hosts() {
    let t = TempDir::new();
    let log = t.path().join("proxy.jsonl");
    let child = Command::new(BIN)
        .args([
            "proxy",
            "--preset",
            "npm",
            "--allow",
            "internal.example:8443",
            "--log",
        ])
        .arg(&log)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut proxy = Reaped(child);
    let mut first = String::new();
    BufReader::new(proxy.0.stdout.take().unwrap())
        .read_line(&mut first)
        .unwrap();
    let port: u16 = first
        .trim()
        .parse()
        .expect("the first line of stdout is the port");
    let answer = ask(port, b"CONNECT github.com:443 HTTP/1.1\r\n\r\n");
    assert!(answer.starts_with("HTTP/1.1 403 "), "{answer:?}");
    let lines = log_lines(&log);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["allowed"], false);
}

#[test]
fn the_proxy_subcommand_refuses_to_start_with_a_bad_host_or_an_unknown_preset() {
    for bad in [
        ["--allow", "https://example.com"],
        ["--preset", "everything"],
    ] {
        let out = Command::new(BIN).arg("proxy").args(bad).output().unwrap();
        assert!(!out.status.success());
        assert!(out.stdout.is_empty(), "no port is printed");
    }
}
