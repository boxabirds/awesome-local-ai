//! The machine's own meters: a Mac's power telemetry and NVIDIA GPU board power.

pub type Values = Vec<(String, Option<f64>)>;

const MICRO: f64 = 1_000_000.0; // mA x mV -> W
const CENTI: f64 = 100.0;

/// AppleSmartBattery registry entry -> watts and battery state. battery_w < 0: discharging.
/// The Mac updates these about once a minute.
pub fn parse_macos(reg: &plist::Dictionary) -> Values {
    let num = |d: &plist::Dictionary, k: &str| {
        d.get(k).and_then(|v| v.as_real().or_else(|| v.as_signed_integer().map(|i| i as f64)))
    };
    let data = reg.get("BatteryData").and_then(|v| v.as_dictionary());
    let battery_w = match (num(reg, "InstantAmperage"), num(reg, "Voltage")) {
        (Some(ma), Some(mv)) => Some((ma * mv / MICRO * CENTI).round() / CENTI),
        _ => None,
    };
    let on_ac = reg.get("ExternalConnected").and_then(|v| v.as_boolean()).map(|b| if b { 1.0 } else { 0.0 });
    vec![
        ("system_w".into(), data.and_then(|d| num(d, "SystemPower"))),
        ("adapter_w".into(), data.and_then(|d| num(d, "AdapterPower"))),
        ("battery_pct".into(), num(reg, "CurrentCapacity")),
        ("battery_w".into(), battery_w),
        ("on_ac".into(), on_ac),
    ]
}

pub async fn read_macos() -> anyhow::Result<Values> {
    let out = tokio::process::Command::new("ioreg").args(["-a", "-rn", "AppleSmartBattery"]).output().await?;
    let entries: Vec<plist::Dictionary> = plist::from_bytes(&out.stdout)?;
    let reg = entries.first().ok_or_else(|| anyhow::anyhow!("no AppleSmartBattery (not a laptop?)"))?;
    Ok(parse_macos(reg))
}

/// `nvidia-smi --query-gpu=power.draw --format=csv,noheader,nounits` -> gpuN_w.
pub fn parse_nvidia(out: &str) -> Values {
    out.lines()
        .filter(|l| !l.trim().is_empty())
        .enumerate()
        .map(|(i, l)| (format!("gpu{i}_w"), l.split(',').next().and_then(|v| v.trim().parse().ok())))
        .collect()
}

pub async fn read_nvidia() -> anyhow::Result<Values> {
    let out = tokio::process::Command::new("nvidia-smi")
        .args(["--query-gpu=power.draw", "--format=csv,noheader,nounits"])
        .output()
        .await?;
    anyhow::ensure!(out.status.success(), "nvidia-smi: {}", String::from_utf8_lossy(&out.stderr).trim());
    Ok(parse_nvidia(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_battery_telemetry_is_parsed() {
        let mut data = plist::Dictionary::new();
        data.insert("SystemPower".into(), 105.7.into());
        data.insert("AdapterPower".into(), 81.4.into());
        let mut reg = plist::Dictionary::new();
        reg.insert("ExternalConnected".into(), true.into());
        reg.insert("CurrentCapacity".into(), 97i64.into());
        reg.insert("InstantAmperage".into(), (-1500i64).into());
        reg.insert("Voltage".into(), 13000i64.into());
        reg.insert("BatteryData".into(), plist::Value::Dictionary(data));
        let got = parse_macos(&reg);
        assert_eq!(got, vec![
            ("system_w".into(), Some(105.7)),
            ("adapter_w".into(), Some(81.4)),
            ("battery_pct".into(), Some(97.0)),
            ("battery_w".into(), Some(-19.5)),
            ("on_ac".into(), Some(1.0)),
        ]);
    }

    #[test]
    fn nvidia_power_is_parsed() {
        assert_eq!(parse_nvidia("412.35, 450.00\n"), vec![("gpu0_w".into(), Some(412.35))]);
        assert_eq!(parse_nvidia("12.1\n13.4\n"), vec![("gpu0_w".into(), Some(12.1)), ("gpu1_w".into(), Some(13.4))]);
    }
}
