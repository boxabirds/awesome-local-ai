# /// script
# requires-python = ">=3.11"
# dependencies = ["tapo>=0.8"]
# ///
"""collector.py -- record this machine's power every few seconds, to link energy to benchmark activity.

    uv run benchmarks/perf/power/collector.py once     # one reading from every configured source
    uv run benchmarks/perf/power/collector.py run      # keep sampling (install-collector.sh makes it a service)

Sources, as configured in ~/.config/awesome-local-ai/power.json (outside the repo: it names your
devices):

    {"tapo": [{"mac": "<plug MAC>", "label": "<machine>"}], "macos": true, "nvidia": false}

- tapo:   Tapo P110-class energy-monitoring plugs, at the wall. Found on the LAN by MAC, never by
          a stored IP; followed when the router moves them; sessions renewed when they expire.
          Credentials: TPLINK_EMAIL and TPLINK_PASSWORD, from the environment or the env file
          (default ~/.config/awesome-local-ai/tapo.env, mode 600).
- macos:  the Mac's own power telemetry (system and adapter watts, battery). A MacBook under heavy
          load draws from its battery even on AC, so the wall plug alone undercounts; and a laptop
          may be on another plug or none. This updates slowly (seconds to tens of seconds).
- nvidia: GPU board power from nvidia-smi.

Writes <out>/<source>-YYYY-MM-DD.csv (UTC days), default ~/.local/share/awesome-local-ai/power/.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import plistlib
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

INTERVAL_S = 2
REDISCOVER_BACKOFF_S = 30
# The limited broadcast reaches every plug on the local network, whatever its subnet.
DISCOVERY_TARGET = "255.255.255.255"
DISCOVERY_TIMEOUT_S = 3
ERROR_LOG_EVERY_S = 60
MILLIWATTS_PER_WATT = 1000
MICRO = 1_000_000  # mA x mV -> W
MS_PER_S = 1000

CONFIG = Path.home() / ".config" / "awesome-local-ai" / "power.json"
ENV_FILE = Path.home() / ".config" / "awesome-local-ai" / "tapo.env"
OUT = Path.home() / ".local" / "share" / "awesome-local-ai" / "power"


def normalize_mac(mac: str | None) -> str:
    return (mac or "").upper().replace(":", "-")


def iso_ms(t: float) -> str:
    d = datetime.fromtimestamp(t, timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(round((t % 1) * MS_PER_S)) % MS_PER_S:03d}Z"


# ---------- tapo ----------

class TapoPlugs:
    """Watts per plug label. connect(ip) -> object with async mac() and watts();
    discover() -> {mac: ip}. Both injected, so the logic is testable without a network."""

    name = "tapo"

    def __init__(self, plugs: list[dict], connect, discover, now=time.time):
        self.plugs = plugs
        self.connect, self.discover, self.now = connect, discover, now
        self.addresses: dict[str, str] = {}
        self.conns: dict[str, object] = {}
        self.last_discovery: float | None = None
        self.errors: dict[str, str] = {}  # label -> why its last read failed, for the log
        self._lock = asyncio.Lock()

    async def _open(self, mac: str, ip: str):
        try:
            conn = await self.connect(ip)
            if normalize_mac(await conn.mac()) != mac:
                return None  # another device has this address now
            self.conns[mac] = conn
            return conn
        except Exception as exc:  # noqa: BLE001 - unreachable, or not a plug we can talk to
            self.errors[mac] = f"{ip}: {exc}"
            return None

    async def _rediscover(self) -> None:
        async with self._lock:
            if self.last_discovery is not None and self.now() - self.last_discovery < REDISCOVER_BACKOFF_S:
                return
            self.last_discovery = self.now()
            try:
                self.addresses.update(await self.discover())
            except Exception as exc:  # noqa: BLE001
                print(f"tapo: discovery failed: {exc}", file=sys.stderr)

    async def _watts(self, conn) -> float | None:
        try:
            return await conn.watts()
        except Exception:  # noqa: BLE001 - expired session, moved plug, flaky WiFi
            return None

    async def _one(self, plug: dict) -> float | None:
        mac = normalize_mac(plug["mac"])
        conn = self.conns.pop(mac, None)
        if conn is not None:
            w = await self._watts(conn)
            if w is not None:
                self.conns[mac] = conn
                return w
        tried = self.addresses.get(mac)
        if tried and (conn := await self._open(mac, tried)):  # a new session at the same address
            w = await self._watts(conn)
            if w is not None:
                return w
        await self._rediscover()
        ip = self.addresses.get(mac)
        if ip and ip != tried and (conn := await self._open(mac, ip)):
            return await self._watts(conn)
        self.errors.setdefault(mac, "not found on the LAN")
        return None

    async def read(self) -> dict:
        self.errors = {}
        values = await asyncio.gather(*[self._one(p) for p in self.plugs])
        return {p["label"]: w for p, w in zip(self.plugs, values)}


def load_env(path: Path) -> dict:
    out = {}
    if path.exists():
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                out[k.strip()] = v.strip().strip("'\"")
    return out


def tapo_source(plugs: list[dict], env_file: Path) -> TapoPlugs:
    from tapo import ApiClient
    env = load_env(env_file)
    email = os.environ.get("TPLINK_EMAIL") or env.get("TPLINK_EMAIL")
    password = os.environ.get("TPLINK_PASSWORD") or env.get("TPLINK_PASSWORD")
    if not (email and password):
        raise SystemExit(f"tapo: TPLINK_EMAIL / TPLINK_PASSWORD not set (environment or {env_file})")
    client = ApiClient(email, password)

    class Conn:
        def __init__(self, handler):
            self.h = handler

        async def mac(self):
            return (await self.h.get_device_info()).to_dict().get("mac")

        async def watts(self):
            return (await self.h.get_energy_usage()).to_dict()["current_power"] / MILLIWATTS_PER_WATT

    async def connect(ip: str):
        return Conn(await client.p110(ip))

    async def discover() -> dict:
        found = {}
        async for result in await client.discover_devices(DISCOVERY_TARGET, DISCOVERY_TIMEOUT_S):
            try:
                device = result.get()
                found[normalize_mac(device.device_info.to_dict().get("mac"))] = device.ip
            except Exception:  # noqa: BLE001 - a device that won't talk to us isn't one of ours
                pass
        return found

    return TapoPlugs(plugs, connect, discover)


# ---------- macos ----------

def parse_macos(reg: dict) -> dict:
    """AppleSmartBattery registry entry -> watts and battery state. battery_w < 0: discharging."""
    data = reg.get("BatteryData") or {}
    amps_ma, volts_mv = reg.get("InstantAmperage"), reg.get("Voltage")
    battery_w = None if amps_ma is None or volts_mv is None else round(amps_ma * volts_mv / MICRO, 2)
    return {"system_w": data.get("SystemPower"), "adapter_w": data.get("AdapterPower"),
            "battery_pct": reg.get("CurrentCapacity"), "battery_w": battery_w,
            "on_ac": int(bool(reg.get("ExternalConnected")))}


class MacOS:
    name = "macos"

    async def read(self) -> dict:
        raw = await asyncio.to_thread(subprocess.run, ["ioreg", "-a", "-rn", "AppleSmartBattery"],
                                      capture_output=True)
        entries = plistlib.loads(raw.stdout) if raw.stdout else []
        return parse_macos(entries[0]) if entries else {}


# ---------- nvidia ----------

def parse_nvidia(out: str) -> dict:
    return {f"gpu{i}_w": float(line.split(",")[0]) for i, line in enumerate(l for l in out.splitlines() if l.strip())}


class Nvidia:
    name = "nvidia"

    async def read(self) -> dict:
        raw = await asyncio.to_thread(subprocess.run, ["nvidia-smi", "--query-gpu=power.draw",
                                                       "--format=csv,noheader,nounits"], capture_output=True, text=True)
        return parse_nvidia(raw.stdout)


# ---------- collector ----------

class Collector:
    def __init__(self, sources: list, out: Path, now=time.time):
        self.sources, self.out, self.now = sources, out, now
        self.headers: dict[str, list[str]] = {}
        self.last_error: dict[str, float] = {}

    def _write(self, name: str, t: float, values: dict) -> None:
        day = datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")
        path = self.out / f"{name}-{day}.csv"
        if path.exists() and path.stat().st_size:
            header = self.headers.get(str(path)) or path.read_text().splitlines()[0].split(",")[1:]
        else:
            header = list(values)
            path.write_text("ts_utc," + ",".join(header) + "\n")
        self.headers[str(path)] = header
        cells = ["" if values.get(k) is None else str(values[k]) for k in header]
        with path.open("a") as fh:
            fh.write(iso_ms(t) + "," + ",".join(cells) + "\n")

    async def tick(self) -> None:
        t = self.now()
        self.out.mkdir(parents=True, exist_ok=True)
        results = await asyncio.gather(*[s.read() for s in self.sources], return_exceptions=True)
        for source, values in zip(self.sources, results):
            if isinstance(values, Exception):
                if t - self.last_error.get(source.name, 0) >= ERROR_LOG_EVERY_S:
                    print(f"{source.name}: {values}", file=sys.stderr)
                    self.last_error[source.name] = t
                continue
            if values and any(v is not None for v in values.values()):
                self._write(source.name, t, values)
            why = getattr(source, "errors", None)
            if why and any(v is None for v in values.values()) and t - self.last_error.get(source.name, 0) >= ERROR_LOG_EVERY_S:
                print(f"{source.name}: no reading: {why}", file=sys.stderr, flush=True)
                self.last_error[source.name] = t

    async def run(self, interval: float) -> None:
        while True:
            started = time.monotonic()
            await self.tick()
            await asyncio.sleep(max(0.0, interval - (time.monotonic() - started)))


def sources_from(config: dict, env_file: Path) -> list:
    out = []
    if config.get("tapo"):
        out.append(tapo_source(config["tapo"], env_file))
    if config.get("macos") and sys.platform == "darwin":
        out.append(MacOS())
    if config.get("nvidia") and shutil.which("nvidia-smi"):
        out.append(Nvidia())
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["once", "run"])
    ap.add_argument("--config", type=Path, default=CONFIG)
    ap.add_argument("--env-file", type=Path, default=ENV_FILE)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--interval", type=float, default=INTERVAL_S)
    a = ap.parse_args()
    if not a.config.exists():
        raise SystemExit(f"no config at {a.config}; see the docstring for its shape")
    sources = sources_from(json.loads(a.config.read_text()), a.env_file)
    if not sources:
        raise SystemExit("no source configured is available on this machine")
    if a.mode == "once":
        async def once() -> int:
            failed = 0
            for s, v in zip(sources, await asyncio.gather(*[s.read() for s in sources], return_exceptions=True)):
                print(f"  {s.name}: {v}")
                failed += isinstance(v, Exception) or not v or any(x is None for x in v.values())
            return failed
        raise SystemExit(1 if asyncio.run(once()) else 0)
    else:
        asyncio.run(Collector(sources, a.out).run(a.interval))


if __name__ == "__main__":
    main()
