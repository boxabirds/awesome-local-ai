# /// script
# requires-python = ">=3.11"
# ///
"""A CONNECT proxy that forwards only to allowed hosts, for a sandboxed judge.

    egress_proxy.py --port 0 --allow api.openai.com --allow chatgpt.com --log FILE

The judge's sandbox denies every outbound connection except to localhost, so this proxy is its
only route out. It tunnels HTTPS (CONNECT host:443) to allowed hosts and their subdomains and
refuses everything else with 403, logging every request either way. Plain-HTTP requests are refused:
the judge's model API is HTTPS only. Prints the bound port on the first line of stdout.
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
import threading
import time
from pathlib import Path

HTTPS_PORT = 443
BUFFER_BYTES = 65536
HEADER_LIMIT_BYTES = 16384
CONNECT_TIMEOUT_S = 15


def allowed(host: str, allow: list[str]) -> bool:
    host = host.lower().rstrip(".")
    return any(host == a or host.endswith("." + a) for a in allow)


def parse_connect(head: bytes) -> tuple[str, int] | None:
    """(host, port) from a CONNECT request head, or None if it isn't one to port 443."""
    line = head.split(b"\r\n", 1)[0].decode("latin-1")
    parts = line.split()
    if len(parts) != 3 or parts[0].upper() != "CONNECT":
        return None
    host, _, port = parts[1].rpartition(":")
    if not host or not port.isdigit() or int(port) != HTTPS_PORT:
        return None
    return host.strip("[]"), int(port)


def pipe(src: socket.socket, dst: socket.socket) -> None:
    try:
        while data := src.recv(BUFFER_BYTES):
            dst.sendall(data)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def handle(client: socket.socket, allow: list[str], log: Path | None, lock: threading.Lock) -> None:
    head = b""
    while b"\r\n\r\n" not in head and len(head) < HEADER_LIMIT_BYTES:
        chunk = client.recv(BUFFER_BYTES)
        if not chunk:
            client.close()
            return
        head += chunk
    target = parse_connect(head)
    ok = target is not None and allowed(target[0], allow)
    if log:
        first = head.split(b"\r\n", 1)[0].decode("latin-1")[:200]
        with lock, log.open("a") as f:
            f.write(json.dumps({"t": round(time.time(), 3), "request": first, "allowed": ok}) + "\n")
    if not ok:
        client.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        client.close()
        return
    try:
        upstream = socket.create_connection(target, timeout=CONNECT_TIMEOUT_S)
        upstream.settimeout(None)
    except OSError:
        client.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        client.close()
        return
    client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    pipe(upstream, client)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--allow", action="append", required=True, help="host, and its subdomains; repeatable")
    ap.add_argument("--log", type=Path)
    a = ap.parse_args()
    server = socket.create_server(("127.0.0.1", a.port))
    print(server.getsockname()[1], flush=True)
    lock = threading.Lock()
    while True:
        client, _ = server.accept()
        threading.Thread(target=handle, args=(client, [h.lower() for h in a.allow], a.log, lock), daemon=True).start()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
