//! Small OS helpers over libc: signals, process checks, host facts, randomness.

use anyhow::{Context, Result};
use std::io::Read;

const HOSTNAME_BUF: usize = 256;
const TOKEN_BYTES: usize = 32;
#[cfg(not(target_os = "macos"))]
const KIB: u64 = 1024;

/// A process with this pid exists (possibly owned by someone else).
pub fn pid_alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    // SAFETY: signal 0 only checks for existence and permission.
    let r = unsafe { libc::kill(pid, 0) };
    r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// The pid exists and leads the given process group (what dbench's children do).
pub fn leads_group(pid: i32, pgid: i32) -> bool {
    // SAFETY: getpgid has no memory effects.
    pid_alive(pid) && unsafe { libc::getpgid(pid) } == pgid
}

/// Some process in the group still exists.
pub fn group_alive(pgid: i32) -> bool {
    if pgid <= 1 {
        return false;
    }
    // SAFETY: signal 0 to a negative pid checks the process group.
    let r = unsafe { libc::kill(-pgid, 0) };
    r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Send a signal to a whole process group. Refuses group ids 0 and 1, which
/// would mean "my own group" and "everything".
pub fn signal_group(pgid: i32, sig: i32) -> bool {
    if pgid <= 1 {
        return false;
    }
    // SAFETY: plain kill(2).
    unsafe { libc::kill(-pgid, sig) == 0 }
}

/// Send a signal to one process. Refuses pids 0 and 1.
pub fn signal_pid(pid: i32, sig: i32) -> bool {
    if pid <= 1 {
        return false;
    }
    // SAFETY: plain kill(2).
    unsafe { libc::kill(pid, sig) == 0 }
}

/// Words in `ps -o lstart` under LC_ALL=C: "Thu Sep 24 22:27:07 2026".
const LSTART_WORDS: usize = 5;

/// One row of the process table. `started` tells a process from a later one that reuses its pid.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proc {
    pub pid: i32,
    pub ppid: i32,
    pub pgid: i32,
    pub started: String,
    pub name: String,
}

/// The output of `ps -A -o pid= -o ppid= -o pgid= -o lstart= -o comm=` (LC_ALL=C), which
/// Linux and macOS print alike. Unparseable lines are skipped.
pub fn parse_ps(text: &str) -> Vec<Proc> {
    text.lines()
        .filter_map(|line| {
            let mut w = line.split_whitespace();
            let pid = w.next()?.parse().ok()?;
            let ppid = w.next()?.parse().ok()?;
            let pgid = w.next()?.parse().ok()?;
            let started: Vec<&str> = w.by_ref().take(LSTART_WORDS).collect();
            if started.len() != LSTART_WORDS {
                return None;
            }
            let name = w.collect::<Vec<_>>().join(" ");
            let name = name.rsplit('/').next().unwrap_or_default().to_string();
            Some(Proc {
                pid,
                ppid,
                pgid,
                started: started.join(" "),
                name,
            })
        })
        .collect()
}

/// Every process below `root` in the table (not `root` itself).
pub fn descendants(table: &[Proc], root: i32) -> Vec<Proc> {
    let mut out: Vec<Proc> = Vec::new();
    let mut parents = vec![root];
    while let Some(parent) = parents.pop() {
        for p in table.iter().filter(|p| p.ppid == parent && p.pid != root) {
            if !out.iter().any(|o| o.pid == p.pid) {
                parents.push(p.pid);
                out.push(p.clone());
            }
        }
    }
    out
}

pub fn hostname() -> String {
    let mut buf = [0u8; HOSTNAME_BUF];
    // SAFETY: buf is valid for HOSTNAME_BUF bytes.
    let r = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
    if r != 0 {
        return "unknown".into();
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).into_owned()
}

/// 32 random bytes from the OS, hex encoded.
pub fn random_token() -> Result<String> {
    let mut bytes = [0u8; TOKEN_BYTES];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .context("read /dev/urandom")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(target_os = "macos")]
fn sysctl_raw(name: &str) -> Option<Vec<u8>> {
    let cname = std::ffi::CString::new(name).ok()?;
    let mut len: libc::size_t = 0;
    // SAFETY: first call asks for the size only.
    let r = unsafe {
        libc::sysctlbyname(
            cname.as_ptr(),
            std::ptr::null_mut(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if r != 0 || len == 0 {
        return None;
    }
    let mut buf = vec![0u8; len];
    // SAFETY: buf has len bytes.
    let r = unsafe {
        libc::sysctlbyname(
            cname.as_ptr(),
            buf.as_mut_ptr() as *mut libc::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    (r == 0).then(|| {
        buf.truncate(len);
        buf
    })
}

/// `sysctl -n <name>` for string values (macOS).
#[cfg(target_os = "macos")]
pub fn sysctl_string(name: &str) -> Option<String> {
    let raw = sysctl_raw(name)?;
    let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
    Some(String::from_utf8_lossy(&raw[..end]).trim().to_string())
}

#[cfg(target_os = "macos")]
fn sysctl_u64(name: &str) -> Option<u64> {
    let raw = sysctl_raw(name)?;
    let arr: [u8; 8] = raw.get(..8)?.try_into().ok()?;
    Some(u64::from_ne_bytes(arr))
}

#[cfg(target_os = "macos")]
pub fn total_ram_bytes() -> Option<u64> {
    sysctl_u64("hw.memsize")
}

#[cfg(not(target_os = "macos"))]
pub fn total_ram_bytes() -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * KIB)
}

/// Unix time the machine booted, used to tell a reboot from a server restart.
#[cfg(target_os = "macos")]
pub fn boot_time() -> Option<u64> {
    let raw = sysctl_raw("kern.boottime")?;
    if raw.len() < std::mem::size_of::<libc::timeval>() {
        return None;
    }
    // SAFETY: length checked; timeval is plain data.
    let tv: libc::timeval =
        unsafe { std::ptr::read_unaligned(raw.as_ptr() as *const libc::timeval) };
    Some(tv.tv_sec as u64)
}

#[cfg(not(target_os = "macos"))]
pub fn boot_time() -> Option<u64> {
    let text = std::fs::read_to_string("/proc/stat").ok()?;
    text.lines()
        .find_map(|l| l.strip_prefix("btime "))
        .and_then(|v| v.trim().parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_facts() {
        assert!(!hostname().is_empty());
        assert!(total_ram_bytes().unwrap() > 0);
        let bt = boot_time().unwrap();
        assert!(bt > 0 && bt <= crate::timefmt::now_secs());
        let t = random_token().unwrap();
        assert_eq!(t.len(), TOKEN_BYTES * 2);
        assert_ne!(t, random_token().unwrap());
    }

    #[test]
    fn process_checks() {
        let me = std::process::id() as i32;
        assert!(pid_alive(me));
        assert!(!pid_alive(0));
        assert!(!signal_group(0, 0));
        assert!(!signal_group(1, 0));
        assert!(!group_alive(1));
        assert!(!signal_pid(0, 0));
        assert!(!signal_pid(1, 0));
    }

    #[test]
    fn process_table_and_descendants() {
        let table = parse_ps(
            "  100     1   100 Thu Sep 24 22:27:07 2026 /usr/bin/bash\n\
             \x20 101   100   100 Thu Sep 24 22:27:08 2026 python3\n\
             \x20 102   100   102 Thu Sep 24 22:27:09 2026 /opt/llama.cpp/build/bin/llama-server\n\
             \x20 103   101   103 Thu Sep 24 22:27:10 2026 bwrap\n\
             \x20 104   103   103 Thu Sep 24 22:27:10 2026 pi\n\
             \x20 200     1   200 Thu Sep 24 20:00:00 2026 unrelated\n\
             garbage line\n",
        );
        assert_eq!(table.len(), 6);
        assert_eq!(table[2].name, "llama-server");
        assert_eq!(table[2].started, "Thu Sep 24 22:27:09 2026");
        let mut pids: Vec<i32> = descendants(&table, 100).iter().map(|p| p.pid).collect();
        pids.sort();
        assert_eq!(pids, vec![101, 102, 103, 104]);
        assert!(descendants(&table, 104).is_empty());
    }
}
