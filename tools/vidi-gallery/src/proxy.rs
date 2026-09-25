//! A per-build reverse proxy: every request goes to the build's own `wrangler dev`, WebSocket
//! upgrades are tunnelled through untouched (live sync), and HTML pages get a banner naming the
//! setup and run, plus a title prefix. The build's own files are never modified.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderValue, ACCEPT_ENCODING, CONNECTION, CONTENT_LENGTH, CONTENT_TYPE, TRANSFER_ENCODING, UPGRADE};
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::{TcpListener, TcpStream};

type Body = BoxBody<Bytes, hyper::Error>;

const BANNER_ID: &str = "vidi-gallery-banner";
/// On top of anything the app draws.
const BANNER_Z_INDEX: u64 = 2_147_483_647;
const BANNER_OPACITY: f64 = 0.92;
const TITLE_SEPARATOR: &str = " · ";

#[derive(Debug, Clone)]
pub struct Banner {
    /// e.g. "qwen/3.8/flash-next/… · canvas-pi-02 · held-out 60/75"
    pub text: String,
    /// CSS colour for the setup.
    pub colour: String,
    /// Prefix for the window title, e.g. "flash-next canvas-pi-02".
    pub title: String,
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The HTML snippet: a fixed bar that never takes clicks, and a script keeping the title prefixed.
pub fn snippet(b: &Banner) -> String {
    let prefix = serde_json::to_string(&format!("{}{}", b.title, TITLE_SEPARATOR)).unwrap_or_else(|_| "\"\"".into());
    format!(
        r#"<div id="{BANNER_ID}" style="position:fixed;top:0;left:0;right:0;z-index:{BANNER_Z_INDEX};pointer-events:none;background:{colour};color:#fff;font:600 12px/1.6 system-ui,sans-serif;padding:1px 10px;opacity:{BANNER_OPACITY};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{text}</div><script>(function(){{var p={prefix};function f(){{if(document.title.indexOf(p)!==0)document.title=p+document.title;}}f();new MutationObserver(f).observe(document.head||document.documentElement,{{childList:true,subtree:true,characterData:true}});}})();</script>"#,
        colour = escape_html(&b.colour),
        text = escape_html(&b.text),
    )
}

/// Insert the banner before the last `</body>` (any case), or append it if there is none.
pub fn inject(html: &str, b: &Banner) -> String {
    let lower = html.to_ascii_lowercase();
    match lower.rfind("</body>") {
        Some(at) => format!("{}{}{}", &html[..at], snippet(b), &html[at..]),
        None => format!("{html}{}", snippet(b)),
    }
}

fn full(b: Bytes) -> Body {
    Full::new(b).map_err(|never| match never {}).boxed()
}

fn empty() -> Body {
    Empty::<Bytes>::new().map_err(|never| match never {}).boxed()
}

fn error(status: StatusCode, msg: String) -> Response<Body> {
    let mut r = Response::new(full(Bytes::from(msg)));
    *r.status_mut() = status;
    r
}

fn is_upgrade(req: &Request<Incoming>) -> bool {
    req.headers().get(UPGRADE).is_some()
        && req
            .headers()
            .get(CONNECTION)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.to_ascii_lowercase().contains("upgrade"))
}

/// One HTTP/1 connection to the upstream for this request (local and cheap; keeps upgrades simple).
async fn send(upstream: SocketAddr, req: Request<Body>) -> anyhow::Result<Response<Incoming>> {
    let stream = TcpStream::connect(upstream).await?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
    tokio::spawn(async move {
        let _ = conn.with_upgrades().await;
    });
    Ok(sender.send_request(req).await?)
}

async fn handle(mut req: Request<Incoming>, upstream: SocketAddr, banner: Arc<Banner>) -> Result<Response<Body>, Infallible> {
    let upgrade = is_upgrade(&req);
    let client_upgrade = upgrade.then(|| hyper::upgrade::on(&mut req));
    let (mut parts, body) = req.into_parts();
    // Uncompressed, so HTML can be edited; the build is on this machine, so size doesn't matter.
    parts.headers.remove(ACCEPT_ENCODING);
    let out = if upgrade { Request::from_parts(parts, empty()) } else { Request::from_parts(parts, body.boxed()) };
    let mut resp = match send(upstream, out).await {
        Ok(r) => r,
        Err(e) => return Ok(error(StatusCode::BAD_GATEWAY, format!("vidi-gallery: the build's server didn't answer: {e}"))),
    };

    if resp.status() == StatusCode::SWITCHING_PROTOCOLS {
        if let Some(client_upgrade) = client_upgrade {
            let server_upgrade = hyper::upgrade::on(&mut resp);
            tokio::spawn(async move {
                if let (Ok(c), Ok(s)) = (client_upgrade.await, server_upgrade.await) {
                    let _ = tokio::io::copy_bidirectional(&mut TokioIo::new(c), &mut TokioIo::new(s)).await;
                }
            });
        }
        let (parts, _) = resp.into_parts();
        return Ok(Response::from_parts(parts, empty()));
    }

    let is_html = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.to_ascii_lowercase().starts_with("text/html"));
    let (mut parts, body) = resp.into_parts();
    if !is_html {
        return Ok(Response::from_parts(parts, body.boxed()));
    }
    let bytes = match body.collect().await {
        Ok(b) => b.to_bytes(),
        Err(e) => return Ok(error(StatusCode::BAD_GATEWAY, format!("vidi-gallery: reading the page failed: {e}"))),
    };
    let html = inject(&String::from_utf8_lossy(&bytes), &banner);
    // The body is replaced whole: its old framing (a length, or chunked encoding) no longer applies.
    parts.headers.remove(CONTENT_LENGTH);
    parts.headers.remove(TRANSFER_ENCODING);
    if let Ok(len) = HeaderValue::from_str(&html.len().to_string()) {
        parts.headers.insert(CONTENT_LENGTH, len);
    }
    Ok(Response::from_parts(parts, full(Bytes::from(html))))
}

/// Serve until the task is aborted.
pub async fn serve(listener: TcpListener, upstream: SocketAddr, banner: Banner) {
    let banner = Arc::new(banner);
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let banner = banner.clone();
        tokio::spawn(async move {
            let svc = hyper::service::service_fn(move |req| handle(req, upstream, banner.clone()));
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(stream), svc)
                .with_upgrades()
                .await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn banner() -> Banner {
        Banner { text: "qwen <x> · run-1 · held-out 60/75".into(), colour: "hsl(200 60% 40%)".into(), title: "x run-1".into() }
    }

    #[test]
    fn the_banner_goes_before_the_last_body_close_and_is_escaped() {
        let out = inject("<html><body><p>app</p></BODY></html>", &banner());
        let at = out.find(BANNER_ID).unwrap();
        assert!(at > out.find("<p>app</p>").unwrap() && at < out.find("</BODY>").unwrap());
        assert!(out.contains("qwen &lt;x&gt;") && out.contains("pointer-events:none"));
        assert!(out.contains(r#"var p="x run-1 · ""#));
    }

    #[test]
    fn a_page_without_a_body_close_gets_the_banner_appended() {
        assert!(inject("<div>fragment</div>", &banner()).ends_with("</script>"));
    }

    /// A dummy upstream: HTML at /, JSON at /data, and a raw echo after a WebSocket-style upgrade.
    async fn upstream() -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let svc = hyper::service::service_fn(|mut req: Request<Incoming>| async move {
                        if req.headers().get(UPGRADE).is_some() {
                            let on = hyper::upgrade::on(&mut req);
                            tokio::spawn(async move {
                                let mut io = TokioIo::new(on.await.unwrap());
                                let mut buf = [0u8; 64];
                                let n = io.read(&mut buf).await.unwrap();
                                io.write_all(&buf[..n]).await.unwrap();
                            });
                            let mut r = Response::new(empty());
                            *r.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
                            r.headers_mut().insert(UPGRADE, HeaderValue::from_static("websocket"));
                            r.headers_mut().insert(CONNECTION, HeaderValue::from_static("Upgrade"));
                            return Ok::<_, Infallible>(r);
                        }
                        let (ctype, text) = if req.uri().path() == "/" {
                            ("text/html; charset=utf-8", "<html><body>board</body></html>")
                        } else {
                            ("application/json", r#"{"ok":true}"#)
                        };
                        let mut r = Response::new(full(Bytes::from(text)));
                        r.headers_mut().insert(CONTENT_TYPE, HeaderValue::from_static(ctype));
                        Ok(r)
                    });
                    let _ = hyper::server::conn::http1::Builder::new()
                        .serve_connection(TokioIo::new(stream), svc)
                        .with_upgrades()
                        .await;
                });
            }
        });
        addr
    }

    async fn proxy_to(up: SocketAddr) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(serve(listener, up, banner()));
        addr
    }

    async fn raw(addr: SocketAddr, request: &str) -> String {
        let mut s = TcpStream::connect(addr).await.unwrap();
        s.write_all(request.as_bytes()).await.unwrap();
        let mut out = Vec::new();
        s.read_to_end(&mut out).await.unwrap();
        String::from_utf8_lossy(&out).to_string()
    }

    #[tokio::test]
    async fn html_gets_the_banner_and_other_responses_pass_unchanged() {
        let proxy = proxy_to(upstream().await).await;
        let page = raw(proxy, "GET / HTTP/1.1\r\nHost: x\r\nAccept-Encoding: gzip\r\nConnection: close\r\n\r\n").await;
        assert!(page.contains("board") && page.contains(BANNER_ID), "{page}");
        let data = raw(proxy, "GET /data HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").await;
        assert!(data.ends_with(r#"{"ok":true}"#) && !data.contains(BANNER_ID), "{data}");
    }

    /// wrangler dev answers pages with `Transfer-Encoding: chunked`; rewriting one must not keep that
    /// header next to the new Content-Length (hyper then refuses to send the response at all).
    #[tokio::test]
    async fn a_chunked_html_page_is_rewritten_and_delivered() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let up = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = s.read(&mut buf).await.unwrap();
            let body = "<html><body>chunked board</body></html>";
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n",
                body.len()
            );
            s.write_all(resp.as_bytes()).await.unwrap();
        });
        let proxy = proxy_to(up).await;
        let page = raw(proxy, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").await;
        assert!(page.starts_with("HTTP/1.1 200"), "{page}");
        assert!(page.contains("chunked board") && page.contains(BANNER_ID), "{page}");
    }

    #[tokio::test]
    async fn a_websocket_upgrade_is_tunnelled_both_ways() {
        let proxy = proxy_to(upstream().await).await;
        let mut s = TcpStream::connect(proxy).await.unwrap();
        s.write_all(b"GET /api/rooms/x HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n")
            .await
            .unwrap();
        let mut head = vec![0u8; 1024];
        let n = s.read(&mut head).await.unwrap();
        assert!(String::from_utf8_lossy(&head[..n]).starts_with("HTTP/1.1 101"), "{}", String::from_utf8_lossy(&head[..n]));
        s.write_all(b"hello through the tunnel").await.unwrap();
        let mut echo = vec![0u8; 64];
        let n = s.read(&mut echo).await.unwrap();
        assert_eq!(&echo[..n], b"hello through the tunnel");
    }
}
