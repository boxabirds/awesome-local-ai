//! What this build is, so that runs can say which sandbox they ran in and be compared: its
//! version, its platform, and a hash of the policy it enforces (the Seatbelt profile or the
//! bubblewrap command line for a fixed, empty run, and the preset hosts).

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

use crate::policy::Policy;

/// The stand-in run the policy text is made for: nothing of the host is read but the system's own
/// layout, so two machines with the same enforcer and system layout give the same hash.
const PROBE_OWN_DIR: &str = "/agent-sandbox-probe";

fn probe_policy() -> Policy {
    Policy {
        own_dir: PathBuf::from(PROBE_OWN_DIR),
        own_at: PathBuf::from(PROBE_OWN_DIR),
        own_ro: Vec::new(),
        workdir: None,
        read_only: Vec::new(),
        links: Vec::new(),
        missing: Vec::new(),
    }
}

#[cfg(target_os = "macos")]
fn enforcer_text() -> String {
    crate::seatbelt::profile(&probe_policy(), &crate::ports::Loopback::default())
}

#[cfg(target_os = "linux")]
fn enforcer_text() -> String {
    use crate::bwrap::{command, Net, RealFs};
    let net = Net::Isolated {
        bridge_dir: PathBuf::from("/probe-bridge"),
        self_exe: PathBuf::from("/probe-exe"),
        ports: Vec::new(),
    };
    command(&probe_policy(), &RealFs, &net, &["true".into()])
        .iter()
        .map(|a| a.to_string_lossy().into_owned() + "\n")
        .collect()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn enforcer_text() -> String {
    String::new()
}

/// The policy as one text: the enforcer's rules, then the preset hosts.
pub fn policy_text() -> String {
    format!("{}\n{}", enforcer_text(), crate::presets::source())
}

pub fn policy_hash() -> String {
    Sha256::digest(policy_text().as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn json() -> Value {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "platform": format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        "policy_hash": policy_hash(),
    })
}
