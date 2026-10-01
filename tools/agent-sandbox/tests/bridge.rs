//! The loopback bridge that carries chosen host ports into a private network namespace:
//! TCP inside the sandbox -> a unix socket both sides can see -> TCP on the host.
//! The two halves are ordinary sockets, so they are exercised here without any sandbox.

mod common;

use agent_sandbox::bridge::{host_side, sandbox_side};
use agent_sandbox::bwrap::{
    command_file_bytes, command_from_file_bytes, port_of_socket, socket_name, COMMAND_FILE,
};
use common::TempDir;
use std::io::{Read, Write};
use std::ffi::OsString;
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::Command;
use std::time::{Duration, Instant};

const ANY_PORT: u16 = 0;
const DEADLINE: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(20);
const BIN: &str = env!("CARGO_BIN_EXE_agent-sandbox");
const COMMAND_EXIT: i32 = 7;

fn free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", ANY_PORT))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn connect_when_ready(port: u16) -> TcpStream {
    let end = Instant::now() + DEADLINE;
    loop {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(s) => return s,
            Err(e) if Instant::now() > end => panic!("port {port} never accepted: {e}"),
            Err(_) => std::thread::sleep(POLL),
        }
    }
}

#[test]
fn bytes_cross_both_halves_in_both_directions() {
    let t = TempDir::new();
    let socket = t.path().join("p.sock");
    let host = TcpListener::bind(("127.0.0.1", ANY_PORT)).unwrap();
    let host_port = host.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for conn in host.incoming() {
            let mut c = conn.unwrap();
            let mut buf = [0u8; 5];
            c.read_exact(&mut buf).unwrap();
            c.write_all(&buf.to_ascii_uppercase()).unwrap();
            let _ = c.shutdown(Shutdown::Both);
        }
    });
    host_side(&socket, host_port).unwrap();
    let inner_port = free_port();
    sandbox_side(inner_port, &socket).unwrap();
    for _ in 0..3 {
        let mut c = connect_when_ready(inner_port);
        c.set_read_timeout(Some(DEADLINE)).unwrap();
        c.write_all(b"hello").unwrap();
        let mut reply = String::new();
        c.read_to_string(&mut reply).unwrap();
        assert_eq!(reply, "HELLO");
    }
}

#[test]
fn a_dead_host_port_closes_the_connection_instead_of_hanging() {
    let t = TempDir::new();
    let socket = t.path().join("p.sock");
    host_side(&socket, free_port()).unwrap();
    let inner_port = free_port();
    sandbox_side(inner_port, &socket).unwrap();
    let mut c = connect_when_ready(inner_port);
    c.set_read_timeout(Some(DEADLINE)).unwrap();
    let mut buf = Vec::new();
    assert_eq!(c.read_to_end(&mut buf).unwrap_or(0), 0);
}

#[test]
fn the_host_side_refuses_a_socket_path_that_already_exists() {
    let t = TempDir::new();
    let socket = t.file("taken.sock", "");
    assert!(host_side(&socket, free_port()).is_err());
}

/// The sandbox's first process as bubblewrap starts it, here without a sandbox: it opens the
/// ports whose sockets it finds, runs the command written beside them, and exits with its status.
#[test]
fn the_inner_command_opens_its_ports_runs_the_command_and_passes_its_status_on() {
    let t = TempDir::new();
    let host = TcpListener::bind(("127.0.0.1", ANY_PORT)).unwrap();
    let host_port = host.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for conn in host.incoming() {
            let mut c = conn.unwrap();
            let mut buf = [0u8; 5];
            c.read_exact(&mut buf).unwrap();
            c.write_all(&buf.to_ascii_uppercase()).unwrap();
            c.write_all(b"\n").unwrap();
        }
    });
    // With no network namespace both ends are on one loopback, so the sandbox's side needs a port
    // of its own; in a real sandbox it is the same number as the host's.
    let inner_port = free_port();
    host_side(&t.path().join(socket_name(inner_port)), host_port).unwrap();
    let script = format!(
        "for i in 1 2 3 4 5 6 7 8 9 10; do exec 3<>/dev/tcp/127.0.0.1/{inner_port} && break; sleep 0.2; done; \
         printf hello >&3 && read -r answer <&3 && echo \"$answer\"; exit {COMMAND_EXIT}"
    );
    let job: Vec<OsString> = ["/bin/bash", "-c", &script].iter().map(OsString::from).collect();
    std::fs::write(t.path().join(COMMAND_FILE), command_file_bytes(&job)).unwrap();
    let out = Command::new(BIN)
        .args(["inner", "--sockets"])
        .arg(t.path())
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "HELLO\n",
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(out.status.code(), Some(COMMAND_EXIT));
}

#[test]
fn the_command_file_round_trips_arguments_with_spaces_and_newlines() {
    let job: Vec<OsString> = ["sh", "-c", "echo 'a b'\nexit 1", "--", "x y"]
        .iter()
        .map(OsString::from)
        .collect();
    assert_eq!(command_from_file_bytes(&command_file_bytes(&job)), job);
}

#[test]
fn only_files_named_for_a_port_are_ports() {
    assert_eq!(port_of_socket("18010.sock"), Some(18010));
    assert_eq!(port_of_socket("command"), None);
    assert_eq!(port_of_socket("x.sock"), None);
    assert_eq!(port_of_socket("70000.sock"), None);
}
