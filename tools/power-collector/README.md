# power-collector

Records a machine's power every 2 seconds, so energy can be linked to benchmark activity (per story,
per model request). One collector per machine, as a background service that starts with the machine.

| Source | What it measures | Resolution |
|---|---|---|
| `tapo` | Wall power at a Tapo P110-class energy-monitoring plug (P110, P110M, P115; a P100 can't measure). Plugs are found by MAC on the LAN, never by a stored IP, and followed when the router moves them. Expired sessions (about every 30 s) are renewed in place. | about 2 s (the plug smooths over a few seconds) |
| `macos` | A Mac's own telemetry: system and adapter watts, battery charge and flow. A MacBook under heavy load draws from its battery even on AC, so the wall plug alone undercounts; this also covers a laptop away from its plug. | the Mac updates it about once a minute |
| `nvidia` | GPU board power from `nvidia-smi`. | 2 s |
| `temps` | macOS, Apple Silicon: die temperatures from the SMC, in °C. `temp_cpu_c` is the hottest `Tp*` key (CPU cores), `temp_gpu_c` the hottest `Tg*` key (GPU) and `temp_max_c` the hotter of the two. Other keys are not counted: on the M5 Max `Tf06`/`Tf16` sit at ~99 °C even at idle, and counting them pinned `temp_max_c` at 99.6 °C (28 Sep 17:04:58–17:36:52 UTC in `temps-2026-09-28.csv`). Apple doesn't document the keys, so every temperature key is found at startup (319 on an M5 Max); the CPU/GPU grouping follows the M1–M4 naming and is not verified on M5. Written to its own `temps-YYYY-MM-DD.csv`. | 2 s |

## Set up a machine

1. Config, outside the repo (it names your devices), `~/.config/awesome-local-ai/power.json`:
   ```json
   {"tapo": [{"mac": "<plug MAC>", "label": "<machine>"}], "macos": true, "temps": true, "nvidia": false}
   ```
   A plug's MAC is on its sticker, or in the Tapo app (the plug, then the gear, then Device Info).
   Give each plug one reader: two machines polling the same plug fight over its session.
2. Tapo credentials (only if `tapo` is configured): `TPLINK_EMAIL` and `TPLINK_PASSWORD` in
   `~/.config/awesome-local-ai/tapo.env`, mode 600, or pass `--env-file` to the installer. In the
   Tapo app, Third-Party Compatibility must be on (Me, then Third-Party Services); for a plug added
   later, switch it off and on again.
3. `tools/power-collector/install.sh` builds the binary, installs it to `~/.local/bin`, installs a
   launchd agent (macOS) or a systemd user service (Linux), restarts it and waits (up to 3 minutes,
   long enough to rediscover a plug) until the service has written a complete row for every source.
   It fails, naming the source, if any didn't. The check reads the service's own output, not a
   reading from the installer's shell: a firewall such as Little Snitch judges the process making the
   connection, and a terminal can be refused where the service is allowed. On macOS the binary is
   re-signed with a fixed identifier, so a rebuild doesn't look like a new program to the firewall. On Linux, `sudo loginctl enable-linger $USER` keeps it running
   without a login session. On a FileVault Mac, login happens at every boot, so the agent starts with
   the machine.

```bash
power-collector once        # one reading from every source; exit 1 if any gave none
power-collector verify      # wait until the running service records every source; exit 1 naming any that didn't
power-collector run         # what the service runs
```

Data: `~/.local/share/awesome-local-ai/power/<source>-YYYY-MM-DD.csv` (UTC), log `collector.log`
(macOS) or `journalctl --user -u awesome-local-ai-power-collector` (Linux).

## Firewalls

The binary is unsigned. A firewall such as Little Snitch holds its connections until you answer
("an existing rule for any process was not applied", because there is no developer identity); a held
connection looks like "not found on the LAN". Allow it for the **local network** (not one address:
plugs move, and discovery broadcasts), forever. The rule is tied to the binary, so the installer
replaces it only when it changed.
