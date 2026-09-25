# Power collector

Records a machine's power every 2 seconds, so energy can be linked to benchmark activity (per story,
per model request). One collector per machine, as a background service that starts with the machine.

| Source | What it measures | Resolution |
|---|---|---|
| `tapo` | Wall power at a Tapo P110-class energy-monitoring plug. Plugs are found by MAC on the LAN, never by a stored IP, and followed when the router moves them. | about 2 s (the plug smooths over a few seconds) |
| `macos` | A Mac's own telemetry: system and adapter watts, battery charge and flow. A MacBook under heavy load draws from its battery even on AC, so the wall plug alone undercounts; this also covers a laptop away from its plug. | the Mac updates it about once a minute |
| `nvidia` | GPU board power from `nvidia-smi`. | 2 s |

## Set up a machine

1. Config, outside the repo (it names your devices), `~/.config/awesome-local-ai/power.json`:
   ```json
   {"tapo": [{"mac": "<plug MAC>", "label": "<machine>"}], "macos": true, "nvidia": false}
   ```
   A plug's MAC is on its sticker, or in the Tapo app (the plug, then the gear, then Device Info).
2. Tapo credentials (only if `tapo` is configured): `TPLINK_EMAIL` and `TPLINK_PASSWORD` in
   `~/.config/awesome-local-ai/tapo.env`, mode 600, or pass `--env-file` to the installer. In the
   Tapo app, Third-Party Compatibility must be on (Me, then Third-Party Services); for a plug added
   later, switch it off and on again.
3. `benchmarks/perf/power/install-collector.sh` takes one reading from every source, refuses to
   install if any fails, then installs a launchd agent (macOS) or a systemd user service (Linux).
   On Linux, `sudo loginctl enable-linger $USER` keeps it running without a login session. On a
   FileVault Mac, login happens at every boot, so the agent starts with the machine.

Data: `~/.local/share/awesome-local-ai/power/<source>-YYYY-MM-DD.csv` (UTC), log `collector.log`
(macOS) or `journalctl --user -u awesome-local-ai-power-collector` (Linux).

## Known limits

- **macOS blocks a background agent from reaching the LAN** (Local Network privacy: a denied
  connection reports "No route to host"), so a Mac's own agent can't read its plug. Read a Mac's plug
  from an always-on Linux machine on the same LAN instead, and let the Mac's agent record `macos`.
- Tapo sessions expire after about 30 seconds; the collector renews them in place.
