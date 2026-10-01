//! Loopback ports: which ones the sandboxed command may connect to and which it may serve on.
//!
//! Linux needs none of this for the command's own servers: the sandbox has a loopback of its own
//! (bwrap --unshare-net) and only --host-port ports of the host are carried into it. macOS has one
//! loopback for the whole machine and Seatbelt can only name a port exactly ("localhost:8787"):
//! no ranges, no addresses, no "ports this sandbox bound". So there every port is listed.

use anyhow::{bail, Context, Result};
use std::str::FromStr;

/// The most ports --agent-ports may name in all. Seatbelt gets one filter per port and its
/// compile time grows with the square of their number (measured: 1000 ports 0.04 s, 4000 0.5 s,
/// 16384 over 10 s); a run's own servers need a handful.
pub const MAX_AGENT_PORTS: usize = 1024;
/// The IANA dynamic range, which is also macOS's default for ports the kernel picks (bind to 0).
pub const IANA_DYNAMIC_PORTS: PortRange = PortRange {
    first: 49152,
    last: 65535,
};
const RANGE_SEPARATOR: char = '-';
/// Port 0 means "the kernel picks"; it cannot be named in a rule.
const UNNAMEABLE_PORT: u16 = 0;

/// Ports `first` to `last`, both included.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct PortRange {
    pub first: u16,
    pub last: u16,
}

impl PortRange {
    pub fn single(port: u16) -> PortRange {
        PortRange {
            first: port,
            last: port,
        }
    }

    pub fn count(&self) -> usize {
        usize::from(self.last - self.first) + 1
    }

    pub fn contains(&self, port: u16) -> bool {
        (self.first..=self.last).contains(&port)
    }
}

fn port(text: &str) -> Result<u16> {
    let port: u16 = text
        .trim()
        .parse()
        .with_context(|| format!("{text:?} is not a port (1 to {})", u16::MAX))?;
    if port == UNNAMEABLE_PORT {
        bail!("port 0 cannot be named: it means \"any free port\"");
    }
    Ok(port)
}

/// `8787` or `18787-18790`.
impl FromStr for PortRange {
    type Err = anyhow::Error;

    fn from_str(text: &str) -> Result<PortRange> {
        let range = match text.split_once(RANGE_SEPARATOR) {
            None => PortRange::single(port(text)?),
            Some((first, last)) => PortRange {
                first: port(first)?,
                last: port(last)?,
            },
        };
        if range.first > range.last {
            bail!("{text:?}: the range ends before it starts");
        }
        Ok(range)
    }
}

/// The same ports as sorted ranges that neither overlap nor touch.
pub fn merged(ranges: &[PortRange]) -> Vec<PortRange> {
    let mut sorted = ranges.to_vec();
    sorted.sort();
    let mut out: Vec<PortRange> = Vec::new();
    for range in sorted {
        match out.last_mut() {
            Some(prev) if u32::from(range.first) <= u32::from(prev.last) + 1 => {
                prev.last = prev.last.max(range.last);
            }
            _ => out.push(range),
        }
    }
    out
}

/// What the command may do on loopback. Empty means no network at all.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Loopback {
    /// Connect only: servers outside the sandbox (--host-port: the model server) and the proxy.
    pub reach: Vec<PortRange>,
    /// Bind, listen and connect: the command's own servers (--agent-ports).
    pub own: Vec<PortRange>,
    /// --ephemeral-ports: the range the kernel picks from for a bind to port 0. The command may
    /// then bind any loopback port and connect to this whole range, its own or not.
    pub ephemeral: Option<PortRange>,
}

impl Loopback {
    pub fn new(reach: &[u16], own: &[PortRange], ephemeral: Option<PortRange>) -> Result<Loopback> {
        if reach.contains(&UNNAMEABLE_PORT) {
            bail!("--host-port 0 cannot be named: it means \"any free port\"");
        }
        let own = merged(own);
        let total: usize = own.iter().map(PortRange::count).sum();
        if total > MAX_AGENT_PORTS {
            bail!("--agent-ports names {total} ports; at most {MAX_AGENT_PORTS} (each is a rule of its own on macOS)");
        }
        let reach: Vec<PortRange> = reach.iter().copied().map(PortRange::single).collect();
        Ok(Loopback {
            reach: merged(&reach),
            own,
            ephemeral,
        })
    }
}
