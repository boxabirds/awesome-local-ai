//! Carries chosen loopback ports of the host into a sandbox that has its own network namespace
//! (Linux, bwrap --unshare-net). In there 127.0.0.1 is a new, empty loopback: the model server
//! and the allow-listing proxy listen on the host's and are out of reach.
//!
//! A unix socket crosses the boundary, because it is a file and the sandbox can be shown one
//! directory of them:
//!
//!   in the sandbox:  127.0.0.1:PORT  ->  <sockets>/PORT.sock      (sandbox_side)
//!   on the host:     <sockets>/PORT.sock  ->  127.0.0.1:PORT      (host_side)
//!
//! Only ports that were asked for get a socket, so every other loopback service on the host
//! (other runs' dev servers, the harness's own) cannot be reached at all.

use anyhow::{Context, Result};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::Arc;

use crate::proxy::pipe;

/// Listen on `socket` and pass each connection to 127.0.0.1:`port` on this side.
pub fn host_side(socket: &Path, port: u16) -> Result<()> {
    let listener = UnixListener::bind(socket)
        .with_context(|| format!("bridge: binding {}", socket.display()))?;
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let Ok(tcp) = TcpStream::connect(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
                else {
                    let _ = conn.shutdown(Shutdown::Both);
                    return;
                };
                join(tcp, conn);
            });
        }
    });
    Ok(())
}

/// Listen on 127.0.0.1:`port` on this side and pass each connection to `socket`.
pub fn sandbox_side(port: u16, socket: &Path) -> Result<()> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
        .with_context(|| format!("bridge: binding 127.0.0.1:{port} inside the sandbox"))?;
    let socket = socket.to_path_buf();
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            let socket = socket.clone();
            std::thread::spawn(move || {
                let Ok(unix) = UnixStream::connect(&socket) else {
                    let _ = conn.shutdown(Shutdown::Both);
                    return;
                };
                join(conn, unix);
            });
        }
    });
    Ok(())
}

/// Copy both ways until either side ends, then close both.
fn join(tcp: TcpStream, unix: UnixStream) {
    let (Ok(t2), Ok(u2)) = (tcp.try_clone(), unix.try_clone()) else {
        return;
    };
    let (Ok(t3), Ok(u3)) = (tcp.try_clone(), unix.try_clone()) else {
        return;
    };
    let close = Arc::new(move || {
        let _ = t3.shutdown(Shutdown::Both);
        let _ = u3.shutdown(Shutdown::Both);
    });
    let close_too = close.clone();
    std::thread::spawn(move || pipe(t2, u2, move || close_too()));
    pipe(unix, tcp, move || close());
}
