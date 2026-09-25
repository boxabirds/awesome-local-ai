"""collector.py: wall plugs found by MAC and followed, sessions renewed, the Mac's and the GPU's own
readings parsed; one CSV per source per UTC day. Fakes only: no network, no credentials.

    uv run --with pytest pytest benchmarks/perf/power/test_collector.py
"""
import asyncio
from pathlib import Path

import collector as c

A = "8C-86-DD-00-00-0A"
B = "8C-86-DD-00-00-0B"
T0 = 1_790_000_000.0  # 2026-09-21T14:13:20Z


class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t


class FakeLan:
    """Plugs by address. A session can expire: the next read on that connection fails once."""

    def __init__(self, at: dict[str, str], watts: float = 80.0):
        self.at = dict(at)  # ip -> mac
        self.watts = watts
        self.discoveries = 0
        self.connects = 0
        self.expire_next = False

    async def connect(self, ip: str):
        self.connects += 1
        if ip not in self.at:
            raise OSError(f"No route to host {ip}")
        lan, mac = self, self.at[ip]

        class Plug:
            async def mac(self):
                return mac

            async def watts(self):
                if lan.expire_next:
                    lan.expire_next = False
                    raise PermissionError("SESSION_TIMEOUT")
                if lan.at.get(ip) != mac:
                    raise OSError("gone")
                return lan.watts
        return Plug()

    async def discover(self):
        self.discoveries += 1
        return {c.normalize_mac(m): ip for ip, m in self.at.items()}


def plugs(lan, clock, *entries):
    return c.TapoPlugs(list(entries), lan.connect, lan.discover, now=clock)


def read(source):
    return asyncio.run(source.read())


def test_plugs_are_found_by_mac():
    lan = FakeLan({"10.0.0.26": A, "10.0.0.27": B})
    got = read(plugs(lan, Clock(), {"mac": A, "label": "big"}, {"mac": B, "label": "small"}))
    assert got == {"big": 80.0, "small": 80.0}
    assert lan.discoveries == 1


def test_a_connection_is_reused_and_an_expired_session_renewed_in_place():
    lan = FakeLan({"10.0.0.26": A})
    src = plugs(lan, Clock(), {"mac": A, "label": "big"})
    read(src)
    read(src)
    assert (lan.discoveries, lan.connects) == (1, 1)
    lan.expire_next = True
    assert read(src) == {"big": 80.0}  # reconnected to the same address, no broadcast
    assert (lan.discoveries, lan.connects) == (1, 2)


def test_a_plug_that_moves_is_followed():
    lan = FakeLan({"10.0.0.26": A})
    clock = Clock()
    src = plugs(lan, clock, {"mac": A, "label": "big"})
    read(src)
    lan.at = {"10.0.0.99": A}
    clock.t += c.REDISCOVER_BACKOFF_S
    assert read(src) == {"big": 80.0}
    assert lan.discoveries == 2


def test_a_missing_plug_is_not_searched_for_on_every_read():
    lan = FakeLan({})
    clock = Clock()
    src = plugs(lan, clock, {"mac": A, "label": "big"})
    for _ in range(5):
        assert read(src) == {"big": None}
        clock.t += c.INTERVAL_S
    assert lan.discoveries == 1


def test_another_device_at_the_address_is_not_taken_for_the_plug():
    lan = FakeLan({"10.0.0.26": B})
    src = plugs(lan, Clock(), {"mac": A, "label": "big"})
    src.addresses[c.normalize_mac(A)] = "10.0.0.26"
    assert read(src) == {"big": None}


def test_macos_battery_telemetry_is_parsed():
    reg = {"ExternalConnected": True, "CurrentCapacity": 97, "InstantAmperage": -1500, "Voltage": 13000,
           "BatteryData": {"SystemPower": 105.7, "AdapterPower": 81.4}}
    assert c.parse_macos(reg) == {"system_w": 105.7, "adapter_w": 81.4, "battery_pct": 97,
                                  "battery_w": -19.5, "on_ac": 1}


def test_nvidia_power_is_parsed():
    assert c.parse_nvidia("412.35, 450.00\n") == {"gpu0_w": 412.35}
    assert c.parse_nvidia("12.1\n13.4\n") == {"gpu0_w": 12.1, "gpu1_w": 13.4}


def test_each_source_gets_one_csv_per_utc_day(tmp_path: Path):
    class Fixed:
        name = "mac"

        async def read(self):
            return {"system_w": 50.0, "on_ac": 1}
    clock = Clock()
    col = c.Collector([Fixed()], tmp_path, now=clock)
    asyncio.run(col.tick())
    clock.t += c.INTERVAL_S
    asyncio.run(col.tick())
    lines = (tmp_path / "mac-2026-09-21.csv").read_text().splitlines()
    assert lines == ["ts_utc,system_w,on_ac", "2026-09-21T14:13:20.000Z,50.0,1", "2026-09-21T14:13:22.000Z,50.0,1"]


def test_why_a_plug_gave_no_reading_is_kept_for_the_log():
    lan = FakeLan({})
    src = plugs(lan, Clock(), {"mac": A, "label": "big"})
    read(src)
    assert src.errors == {c.normalize_mac(A): "not found on the LAN"}
