//! Wall plugs found by MAC, never by a stored IP: the router moves them. A plug keeps its
//! connection between reads; an expired session is renewed at the same address; a plug that
//! doesn't answer there (or a different device that does) is found again by one LAN broadcast,
//! at most once per `REDISCOVER_BACKOFF`.

use std::collections::HashMap;
use std::time::Duration;

use tokio::sync::Mutex;

pub const REDISCOVER_BACKOFF: Duration = Duration::from_secs(30);

pub fn normalize_mac(mac: &str) -> String {
    mac.to_uppercase().replace(':', "-")
}

/// A live connection to one plug.
pub trait PlugConn: Send {
    fn mac(&mut self) -> impl std::future::Future<Output = anyhow::Result<String>> + Send;
    fn watts(&mut self) -> impl std::future::Future<Output = anyhow::Result<f64>> + Send;
}

/// How plugs are reached: real Tapo devices, or fakes in tests.
pub trait Lan: Send + Sync {
    type Conn: PlugConn;
    fn connect(&self, ip: &str) -> impl std::future::Future<Output = anyhow::Result<Self::Conn>> + Send;
    /// MAC (normalized) -> IP of every plug that answered.
    fn discover(&self) -> impl std::future::Future<Output = anyhow::Result<HashMap<String, String>>> + Send;
}

#[derive(Clone, Debug, serde::Deserialize)]
pub struct Plug {
    pub mac: String,
    pub label: String,
}

struct State<C> {
    addresses: HashMap<String, String>,
    conns: HashMap<String, C>,
    last_discovery: Option<f64>,
    errors: HashMap<String, String>,
}

pub struct Plugs<L: Lan> {
    plugs: Vec<Plug>,
    lan: L,
    now: Box<dyn Fn() -> f64 + Send + Sync>,
    state: Mutex<State<L::Conn>>,
}

impl<L: Lan> Plugs<L> {
    pub fn new(plugs: Vec<Plug>, lan: L, now: Box<dyn Fn() -> f64 + Send + Sync>) -> Self {
        Self {
            plugs,
            lan,
            now,
            state: Mutex::new(State {
                addresses: HashMap::new(),
                conns: HashMap::new(),
                last_discovery: None,
                errors: HashMap::new(),
            }),
        }
    }

    /// Why each plug that gave no reading last time didn't (MAC -> reason).
    pub async fn errors(&self) -> HashMap<String, String> {
        self.state.lock().await.errors.clone()
    }

    #[cfg(test)]
    pub async fn set_address(&self, mac: &str, ip: &str) {
        self.state.lock().await.addresses.insert(normalize_mac(mac), ip.to_string());
    }

    async fn open(&self, mac: &str, ip: &str) -> Option<L::Conn> {
        let result = async {
            let mut conn = self.lan.connect(ip).await?;
            let got = normalize_mac(&conn.mac().await?);
            anyhow::ensure!(got == mac, "another device ({got}) has this address now");
            Ok(conn)
        }
        .await;
        match result {
            Ok(conn) => Some(conn),
            Err(e) => {
                self.state.lock().await.errors.insert(mac.to_string(), format!("{ip}: {e}"));
                None
            }
        }
    }

    async fn rediscover(&self) {
        let mut st = self.state.lock().await;
        let now = (self.now)();
        if st.last_discovery.is_some_and(|t| now - t < REDISCOVER_BACKOFF.as_secs_f64()) {
            return;
        }
        st.last_discovery = Some(now);
        match self.lan.discover().await {
            Ok(found) => st.addresses.extend(found),
            Err(e) => eprintln!("tapo: discovery failed: {e}"),
        }
    }

    async fn one(&self, plug: &Plug) -> Option<f64> {
        let mac = normalize_mac(&plug.mac);
        let existing = self.state.lock().await.conns.remove(&mac);
        if let Some(mut conn) = existing
            && let Ok(w) = conn.watts().await {
                self.state.lock().await.conns.insert(mac, conn);
                return Some(w);
            }
        let tried = self.state.lock().await.addresses.get(&mac).cloned();
        if let Some(ip) = &tried
            && let Some(mut conn) = self.open(&mac, ip).await
                && let Ok(w) = conn.watts().await {
                    self.state.lock().await.conns.insert(mac, conn);
                    return Some(w);
                }
        self.rediscover().await;
        let ip = self.state.lock().await.addresses.get(&mac).cloned();
        if let Some(ip) = ip.filter(|ip| Some(ip) != tried.as_ref())
            && let Some(mut conn) = self.open(&mac, &ip).await
                && let Ok(w) = conn.watts().await {
                    self.state.lock().await.conns.insert(mac, conn);
                    return Some(w);
                }
        self.state.lock().await.errors.entry(mac).or_insert_with(|| "not found on the LAN".into());
        None
    }

    /// One reading per plug label, in config order.
    pub async fn read(&self) -> Vec<(String, Option<f64>)> {
        self.state.lock().await.errors.clear();
        let values = futures::future::join_all(self.plugs.iter().map(|p| self.one(p))).await;
        self.plugs.iter().map(|p| p.label.clone()).zip(values).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;

    const A: &str = "8C-86-DD-00-00-0A";
    const B: &str = "8C-86-DD-00-00-0B";
    const T0: f64 = 1_790_000_000.0;
    const WATTS: f64 = 80.0;
    const INTERVAL_S: f64 = 2.0;

    #[derive(Default)]
    struct World {
        at: HashMap<String, String>, // ip -> mac
        discoveries: usize,
        connects: usize,
        expire_next: bool,
    }

    #[derive(Clone)]
    struct FakeLan(Arc<StdMutex<World>>);

    struct FakeConn {
        world: Arc<StdMutex<World>>,
        ip: String,
        mac: String,
    }

    impl PlugConn for FakeConn {
        async fn mac(&mut self) -> anyhow::Result<String> {
            Ok(self.mac.clone())
        }
        async fn watts(&mut self) -> anyhow::Result<f64> {
            let mut w = self.world.lock().unwrap();
            if w.expire_next {
                w.expire_next = false;
                anyhow::bail!("SESSION_TIMEOUT");
            }
            anyhow::ensure!(w.at.get(&self.ip) == Some(&self.mac), "gone");
            Ok(WATTS)
        }
    }

    impl Lan for FakeLan {
        type Conn = FakeConn;
        async fn connect(&self, ip: &str) -> anyhow::Result<FakeConn> {
            let mut w = self.0.lock().unwrap();
            w.connects += 1;
            let mac = w.at.get(ip).cloned().ok_or_else(|| anyhow::anyhow!("No route to host {ip}"))?;
            Ok(FakeConn { world: self.0.clone(), ip: ip.to_string(), mac })
        }
        async fn discover(&self) -> anyhow::Result<HashMap<String, String>> {
            let mut w = self.0.lock().unwrap();
            w.discoveries += 1;
            Ok(w.at.iter().map(|(ip, mac)| (normalize_mac(mac), ip.clone())).collect())
        }
    }

    fn lan(at: &[(&str, &str)]) -> FakeLan {
        FakeLan(Arc::new(StdMutex::new(World {
            at: at.iter().map(|(ip, mac)| (ip.to_string(), mac.to_string())).collect(),
            ..Default::default()
        })))
    }

    fn clock() -> (Arc<StdMutex<f64>>, Box<dyn Fn() -> f64 + Send + Sync>) {
        let t = Arc::new(StdMutex::new(T0));
        let r = t.clone();
        (t, Box::new(move || *r.lock().unwrap()))
    }

    /// (discoveries, connects), read under one lock.
    fn counts(l: &FakeLan) -> (usize, usize) {
        let w = l.0.lock().unwrap();
        (w.discoveries, w.connects)
    }

    fn plug(mac: &str, label: &str) -> Plug {
        Plug { mac: mac.into(), label: label.into() }
    }

    #[tokio::test]
    async fn plugs_are_found_by_mac() {
        let l = lan(&[("10.0.0.26", A), ("10.0.0.27", B)]);
        let (_, now) = clock();
        let p = Plugs::new(vec![plug(A, "big"), plug(B, "small")], l.clone(), now);
        assert_eq!(p.read().await, vec![("big".into(), Some(WATTS)), ("small".into(), Some(WATTS))]);
        assert_eq!(l.0.lock().unwrap().discoveries, 1);
    }

    #[tokio::test]
    async fn a_connection_is_reused_and_an_expired_session_renewed_in_place() {
        let l = lan(&[("10.0.0.26", A)]);
        let (_, now) = clock();
        let p = Plugs::new(vec![plug(A, "big")], l.clone(), now);
        p.read().await;
        p.read().await;
        assert_eq!(counts(&l), (1, 1));
        l.0.lock().unwrap().expire_next = true;
        assert_eq!(p.read().await, vec![("big".into(), Some(WATTS))]);
        assert_eq!(counts(&l), (1, 2));
    }

    #[tokio::test]
    async fn a_plug_that_moves_is_followed() {
        let l = lan(&[("10.0.0.26", A)]);
        let (t, now) = clock();
        let p = Plugs::new(vec![plug(A, "big")], l.clone(), now);
        p.read().await;
        l.0.lock().unwrap().at = [("10.0.0.99".to_string(), A.to_string())].into();
        *t.lock().unwrap() += REDISCOVER_BACKOFF.as_secs_f64();
        assert_eq!(p.read().await, vec![("big".into(), Some(WATTS))]);
        assert_eq!(l.0.lock().unwrap().discoveries, 2);
    }

    #[tokio::test]
    async fn a_missing_plug_is_not_searched_for_on_every_read() {
        let l = lan(&[]);
        let (t, now) = clock();
        let p = Plugs::new(vec![plug(A, "big")], l.clone(), now);
        for _ in 0..5 {
            assert_eq!(p.read().await, vec![("big".into(), None)]);
            *t.lock().unwrap() += INTERVAL_S;
        }
        assert_eq!(l.0.lock().unwrap().discoveries, 1);
        assert_eq!(p.errors().await, [(normalize_mac(A), "not found on the LAN".to_string())].into());
    }

    #[tokio::test]
    async fn another_device_at_the_address_is_not_taken_for_the_plug() {
        let l = lan(&[("10.0.0.26", B)]);
        let (_, now) = clock();
        let p = Plugs::new(vec![plug(A, "big")], l.clone(), now);
        p.set_address(A, "10.0.0.26").await;
        assert_eq!(p.read().await, vec![("big".into(), None)]);
    }
}
