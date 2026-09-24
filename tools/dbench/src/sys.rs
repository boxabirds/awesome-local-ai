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
    }
}
