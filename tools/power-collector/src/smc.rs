//! Die temperatures from the Apple SMC (macOS, Apple Silicon), read the way MacThrottle and exelban/stats
//! read them. Apple doesn't document the key names. We enumerate every temperature key the SMC offers
//! once at startup, and group them by the prefixes seen on M1–M4: `Tp` CPU cores, `Tg` GPU. On the
//! M5 Max, quintus exposes 321 plausible `T*` keys, including 23 `Tp` and 84 `Tg`.

use crate::sources::Values;

/// Readings outside this range are sensors that aren't populated, not temperatures (MacThrottle's bounds).
const PLAUSIBLE_C: std::ops::Range<f64> = 20.0..150.0;
const CPU_PREFIX: &str = "Tp";
const GPU_PREFIX: &str = "Tg";

/// The hottest reading overall, among CPU keys and among GPU keys, in °C.
pub fn summarise(readings: &[(String, f64)]) -> Values {
    let max_where = |pred: &dyn Fn(&str) -> bool| {
        readings
            .iter()
            .filter(|(k, v)| pred(k) && PLAUSIBLE_C.contains(v))
            .map(|(_, v)| *v)
            .fold(None, |m: Option<f64>, v| Some(m.map_or(v, |m| m.max(v))))
    };
    vec![
        ("temp_max_c".into(), max_where(&|_| true)),
        ("temp_cpu_c".into(), max_where(&|k| k.starts_with(CPU_PREFIX))),
        ("temp_gpu_c".into(), max_where(&|k| k.starts_with(GPU_PREFIX))),
    ]
}

/// A four-character SMC key as the SMC's big-endian u32.
pub fn fourcc(key: &str) -> u32 {
    key.bytes().fold(0, |acc, b| (acc << 8) | u32::from(b))
}

pub fn from_fourcc(v: u32) -> String {
    v.to_be_bytes().iter().map(|&b| b as char).collect()
}

#[cfg(target_os = "macos")]
pub use mac::Smc;

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_void};

    use super::{fourcc, from_fourcc, PLAUSIBLE_C};

    /// The SMC's key-data exchange struct (SMCParamStruct): 80 bytes, C layout.
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub(super) struct KeyData {
        pub key: u32,
        pub vers: [u8; 6],
        pub p_limit: [u32; 4],
        pub data_size: u32,
        pub data_type: u32,
        pub data_attributes: u8,
        /// The C key-info struct is padded to 12 bytes: `result` sits at offset 40.
        pub _pad: [u8; 3],
        pub result: u8,
        pub status: u8,
        pub data8: u8,
        pub data32: u32,
        pub bytes: [u8; 32],
    }

    const KERNEL_INDEX_SMC: u32 = 2;
    const CMD_READ_BYTES: u8 = 5;
    const CMD_READ_INDEX: u8 = 8;
    const CMD_READ_KEYINFO: u8 = 9;
    const TYPE_FLT: &str = "flt ";
    const FLT_SIZE: u32 = 4;
    const KEY_COUNT: &str = "#KEY";
    const TEMPERATURE_PREFIX: char = 'T';
    const MAIN_PORT_DEFAULT: u32 = 0;
    const KERN_SUCCESS: i32 = 0;

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOServiceMatching(name: *const c_char) -> *mut c_void;
        fn IOServiceGetMatchingService(main_port: u32, matching: *mut c_void) -> u32;
        fn IOServiceOpen(service: u32, owning_task: u32, kind: u32, connect: *mut u32) -> i32;
        fn IOServiceClose(connect: u32) -> i32;
        fn IOObjectRelease(object: u32) -> i32;
        fn IOConnectCallStructMethod(
            connect: u32,
            selector: u32,
            input: *const c_void,
            input_size: usize,
            output: *mut c_void,
            output_size: *mut usize,
        ) -> i32;
    }

    unsafe extern "C" {
        static mach_task_self_: u32;
    }

    /// An open SMC connection and the temperature keys found on this machine.
    pub struct Smc {
        conn: u32,
        keys: Vec<(String, u32)>,
    }

    impl Smc {
        pub fn open() -> anyhow::Result<Self> {
            // SAFETY: plain IOKit calls; the matching dictionary is consumed by IOServiceGetMatchingService.
            let conn = unsafe {
                let service = IOServiceGetMatchingService(MAIN_PORT_DEFAULT, IOServiceMatching(c"AppleSMC".as_ptr()));
                anyhow::ensure!(service != 0, "no AppleSMC service");
                let mut conn = 0;
                let rc = IOServiceOpen(service, mach_task_self_, 0, &mut conn);
                IOObjectRelease(service);
                anyhow::ensure!(rc == KERN_SUCCESS, "IOServiceOpen(AppleSMC) failed: {rc}");
                conn
            };
            let mut smc = Smc { conn, keys: Vec::new() };
            smc.keys = smc.temperature_keys();
            anyhow::ensure!(!smc.keys.is_empty(), "the SMC offers no temperature keys");
            Ok(smc)
        }

        pub fn key_count(&self) -> usize {
            self.keys.len()
        }

        fn call(&self, input: &KeyData) -> Option<KeyData> {
            let mut output = KeyData::default();
            let mut size = size_of::<KeyData>();
            // SAFETY: both structs are KeyData-sized and live for the call.
            let rc = unsafe {
                IOConnectCallStructMethod(
                    self.conn,
                    KERNEL_INDEX_SMC,
                    (input as *const KeyData).cast(),
                    size_of::<KeyData>(),
                    (&mut output as *mut KeyData).cast(),
                    &mut size,
                )
            };
            (rc == KERN_SUCCESS && output.result == 0).then_some(output)
        }

        fn key_info(&self, key: u32) -> Option<(u32, String)> {
            let out = self.call(&KeyData { key, data8: CMD_READ_KEYINFO, ..Default::default() })?;
            Some((out.data_size, from_fourcc(out.data_type)))
        }

        fn read_flt(&self, key: u32) -> Option<f64> {
            let out = self.call(&KeyData { key, data_size: FLT_SIZE, data8: CMD_READ_BYTES, ..Default::default() })?;
            let b = out.bytes;
            Some(f64::from(f32::from_le_bytes([b[0], b[1], b[2], b[3]])))
        }

        /// Every `T*` key of type `flt ` whose reading right now is plausible.
        fn temperature_keys(&self) -> Vec<(String, u32)> {
            let count = self
                .call(&KeyData { key: fourcc(KEY_COUNT), data_size: FLT_SIZE, data8: CMD_READ_BYTES, ..Default::default() })
                .map(|o| u32::from_be_bytes([o.bytes[0], o.bytes[1], o.bytes[2], o.bytes[3]]))
                .unwrap_or(0);
            (0..count)
                .filter_map(|i| self.call(&KeyData { data8: CMD_READ_INDEX, data32: i, ..Default::default() }))
                .map(|o| o.key)
                .filter(|&k| from_fourcc(k).starts_with(TEMPERATURE_PREFIX))
                .filter(|&k| self.key_info(k).is_some_and(|(size, ty)| size == FLT_SIZE && ty == TYPE_FLT))
                .filter(|&k| self.read_flt(k).is_some_and(|v| PLAUSIBLE_C.contains(&v)))
                .map(|k| (from_fourcc(k), k))
                .collect()
        }

        pub fn read_all(&self) -> Vec<(String, f64)> {
            self.keys.iter().filter_map(|(name, k)| self.read_flt(*k).map(|v| (name.clone(), v))).collect()
        }
    }

    impl Drop for Smc {
        fn drop(&mut self) {
            // SAFETY: closes the connection opened in `open`.
            unsafe { IOServiceClose(self.conn) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_round_trip_as_big_endian_fourcc() {
        assert_eq!(fourcc("#KEY"), 0x234B_4559);
        assert_eq!(from_fourcc(fourcc("Tp0C")), "Tp0C");
    }

    #[test]
    fn summary_is_the_hottest_sensor_overall_cpu_and_gpu() {
        let r: Vec<(String, f64)> = vec![
            ("Tp00".into(), 77.2),
            ("Tp04".into(), 74.5),
            ("Tg08".into(), 73.8),
            ("Tf16".into(), 99.6),
            ("TV05".into(), 12.0), // unpopulated: below the plausible range
        ];
        assert_eq!(summarise(&r), vec![
            ("temp_max_c".into(), Some(99.6)),
            ("temp_cpu_c".into(), Some(77.2)),
            ("temp_gpu_c".into(), Some(73.8)),
        ]);
    }

    #[test]
    fn a_missing_group_is_empty_not_zero() {
        assert_eq!(summarise(&[("TB0T".into(), 35.4)]), vec![
            ("temp_max_c".into(), Some(35.4)),
            ("temp_cpu_c".into(), None),
            ("temp_gpu_c".into(), None),
        ]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_smc_struct_is_80_bytes_like_the_kernel_expects() {
        assert_eq!(size_of::<mac::KeyData>(), 80);
    }

    /// Real hardware: this Mac's SMC gives CPU and GPU temperatures.
    #[cfg(target_os = "macos")]
    #[test]
    fn this_mac_reports_cpu_and_gpu_temperatures() {
        let smc = Smc::open().expect("SMC opens");
        let got = summarise(&smc.read_all());
        assert!(smc.key_count() > 0);
        assert!(got.iter().all(|(_, v)| v.is_some_and(|c| PLAUSIBLE_C.contains(&c))), "{got:?}");
    }
}
