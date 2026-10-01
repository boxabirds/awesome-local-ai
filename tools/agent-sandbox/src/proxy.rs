//! A CONNECT proxy that tunnels only to allowed hosts: the sandboxed command's one route off the
//! machine. The sandbox denies every connection except to loopback, where this listens.
//!
//! It tunnels `CONNECT host:port` when the host is an allowed name or a subdomain of one, on the
//! port the rule names (443 unless it says otherwise). Everything else gets 403: other hosts, other
//! ports, and every plain-HTTP request, since a GET through a proxy needs no tunnel and could be
//! sent anywhere. Every request is logged either way, one JSON object per line, in the same shape
//! as the judge's proxy (benchmarks/spec-bench/harness/egress_proxy.py). The proxy resolves names
//! itself, so the sandboxed command needs no DNS.

use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const HTTPS_PORT: u16 = 443;
const BUFFER_BYTES: usize = 65_536;
/// A request head larger than this is refused: a CONNECT line and a few headers fit many times over.
const HEAD_LIMIT_BYTES: usize = 16_384;
const HEAD_END: &[u8] = b"\r\n\r\n";
/// How long a client may take to send its request head before the connection is dropped.
const HEAD_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// The request line as logged is cut to this many characters.
const LOG_REQUEST_CHARS: usize = 200;
const ESTABLISHED: &[u8] = b"HTTP/1.1 200 Connection Established\r\n\r\n";
const FORBIDDEN: &[u8] =
    b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const BAD_GATEWAY: &[u8] =
    b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const CONNECT: &str = "CONNECT";
const REQUEST_LINE_PARTS: usize = 3;

/// One allowed destination: a host (and its subdomains, unless it is an address) on one port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostRule {
    pub host: String,
    pub port: u16,
}

impl HostRule {
    /// `host`, `host:port` or `[v6-address]:port`. No wildcards, schemes or paths: a rule names
    /// exactly one host, and subdomains follow from it.
    pub fn parse(s: &str) -> Result<HostRule> {
        let (host, port) =
            split_host_port(s).with_context(|| format!("{s:?} is not host or host:port"))?;
        let port = match port {
            Some(p) => p
                .parse::<u16>()
                .ok()
                .filter(|p| *p != 0)
                .with_context(|| format!("{s:?}: bad port"))?,
            None => HTTPS_PORT,
        };
        let host = canonical_host(host);
        let is_name = !host.is_empty()
            && host.split('.').all(|label| {
                !label.is_empty()
                    && label
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            });
        if !is_name && host.parse::<IpAddr>().is_err() {
            bail!("{s:?} is not a host name or an address");
        }
        Ok(HostRule { host, port })
    }

    fn matches(&self, host: &str, port: u16) -> bool {
        if port != self.port {
            return false;
        }
        if host == self.host {
            return true;
        }
        // An address has no subdomains, and an address is never a subdomain of a name.
        self.host.parse::<IpAddr>().is_err()
            && host.parse::<IpAddr>().is_err()
            && host
                .strip_suffix(self.host.as_str())
                .is_some_and(|rest| rest.ends_with('.'))
    }
}

/// Lower case, without a trailing dot or the brackets of a v6 address.
fn canonical_host(host: &str) -> String {
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

/// ("host", Some("port")) from "host:port" or "[v6]:port"; a bare host or bare "[v6]" has no port.
fn split_host_port(s: &str) -> Option<(&str, Option<&str>)> {
    if let Some(rest) = s.strip_prefix('[') {
        let (addr, after) = rest.split_once(']')?;
        return match after.strip_prefix(':') {
            Some(port) => Some((addr, Some(port))),
            None if after.is_empty() => Some((addr, None)),
            None => None,
        };
    }
    match s.rsplit_once(':') {
        Some((host, port)) => Some((host, Some(port))),
        None => Some((s, None)),
    }
}

#[derive(Debug, Clone, Default)]
pub struct AllowList(pub Vec<HostRule>);

impl AllowList {
    pub fn parse(entries: &[String]) -> Result<AllowList> {
        Ok(AllowList(
            entries
                .iter()
                .map(|e| HostRule::parse(e))
                .collect::<Result<_>>()?,
        ))
    }

    pub fn allows(&self, host: &str, port: u16) -> bool {
        let host = canonical_host(host);
        !host.is_empty() && self.0.iter().any(|r| r.matches(&host, port))
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// (host, port) from a request head, if it is `CONNECT host:port HTTP/x`. The host is as the
/// client wrote it (brackets of a v6 address removed).
pub fn parse_connect(head: &[u8]) -> Option<(String, u16)> {
    let line = std::str::from_utf8(first_line(head)).ok()?;
    let parts: Vec<&str> = line.split_ascii_whitespace().collect();
    if parts.len() != REQUEST_LINE_PARTS || !parts[0].eq_ignore_ascii_case(CONNECT) {
        return None;
    }
    let (host, port) = split_host_port(parts[1])?;
    let port = port?.parse::<u16>().ok()?;
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), port))
}

fn first_line(head: &[u8]) -> &[u8] {
    let end = head
        .windows(2)
        .position(|w| w == b"\r\n")
        .unwrap_or(head.len());
    &head[..end]
}

#[derive(Serialize)]
struct LogLine<'a> {
    t: f64,
    request: &'a str,
    allowed: bool,
}

type Log = Arc<Mutex<Option<PathBuf>>>;

fn log_request(log: &Log, head: &[u8], allowed: bool) {
    let guard = log.lock().unwrap_or_else(|e| e.into_inner());
    let Some(path) = guard.as_ref() else { return };
    let request: String = String::from_utf8_lossy(first_line(head))
        .chars()
        .take(LOG_REQUEST_CHARS)
        .collect();
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or_default();
    let Ok(mut line) = serde_json::to_string(&LogLine {
        t,
        request: &request,
        allowed,
    }) else {
        return;
    };
    line.push('\n');
    // One write per line, under the lock, so lines from different connections never interleave.
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Read up to the blank line that ends a request head. None if the client closed, stalled or sent
/// more than a head should hold.
fn read_head(client: &mut TcpStream) -> Option<Vec<u8>> {
    client.set_read_timeout(Some(HEAD_TIMEOUT)).ok()?;
    let mut head = Vec::new();
    let mut buf = [0u8; BUFFER_BYTES];
    while !head.windows(HEAD_END.len()).any(|w| w == HEAD_END) {
        if head.len() >= HEAD_LIMIT_BYTES {
            return None;
        }
        match client.read(&mut buf) {
            Ok(0) | Err(_) => return None,
            Ok(n) => head.extend_from_slice(&buf[..n]),
        }
    }
    client.set_read_timeout(None).ok()?;
    Some(head)
}

fn connect_upstream(host: &str, port: u16) -> Option<TcpStream> {
    (host, port)
        .to_socket_addrs()
        .ok()?
        .find_map(|addr| TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).ok())
}

/// Copy one direction until it ends, then close both sockets so the other direction ends too.
pub(crate) fn pipe(mut from: impl Read, mut to: impl Write, close: impl Fn()) {
    let mut buf = vec![0u8; BUFFER_BYTES];
    loop {
        match from.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if to.write_all(&buf[..n]).is_err() {
                    break;
                }
            }
        }
    }
    close();
}

fn tunnel(client: TcpStream, upstream: TcpStream) {
    let (Ok(c2), Ok(u2)) = (client.try_clone(), upstream.try_clone()) else {
        return;
    };
    let (Ok(c3), Ok(u3)) = (client.try_clone(), upstream.try_clone()) else {
        return;
    };
    let close = Arc::new(move || {
        let _ = c3.shutdown(Shutdown::Both);
        let _ = u3.shutdown(Shutdown::Both);
    });
    let close_too = close.clone();
    std::thread::spawn(move || pipe(c2, u2, move || close_too()));
    pipe(upstream, client, move || close());
}

fn handle(mut client: TcpStream, allow: &AllowList, log: &Log) {
    let Some(head) = read_head(&mut client) else {
        let _ = client.write_all(FORBIDDEN);
        return;
    };
    let target = parse_connect(&head).filter(|(host, port)| allow.allows(host, *port));
    log_request(log, &head, target.is_some());
    let Some((host, port)) = target else {
        let _ = client.write_all(FORBIDDEN);
        return;
    };
    let Some(upstream) = connect_upstream(&host, port) else {
        let _ = client.write_all(BAD_GATEWAY);
        return;
    };
    if client.write_all(ESTABLISHED).is_ok() {
        tunnel(client, upstream);
    }
}

/// A running proxy. It serves until the process exits.
pub struct Proxy {
    pub port: u16,
}

/// Listen on loopback (`port` 0 picks a free one) and serve each connection on its own thread.
pub fn spawn(allow: AllowList, log: Option<PathBuf>, port: u16) -> Result<Proxy> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
        .with_context(|| format!("proxy: binding 127.0.0.1:{port}"))?;
    let port = listener.local_addr()?.port();
    let allow = Arc::new(allow);
    let log: Log = Arc::new(Mutex::new(log));
    std::thread::spawn(move || {
        for client in listener.incoming().flatten() {
            let (allow, log) = (allow.clone(), log.clone());
            std::thread::spawn(move || handle(client, &allow, &log));
        }
    });
    Ok(Proxy { port })
}
