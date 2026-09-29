# Windows benchmark host

Turns a Windows PC with an NVIDIA GPU (a gaming PC is fine) into a machine the benchmark can drive remotely: some inference engines only run on Windows, while the harness runs on Linux or macOS and talks to the model server over the network.

`setup.ps1` is run once, at the keyboard. After that everything happens over SSH through Tailscale.

## Run it

Open **PowerShell as administrator** (Start menu, type "PowerShell", right-click, "Run as administrator") and paste:

```powershell
iwr https://raw.githubusercontent.com/boxabirds/awesome-local-ai/main/tools/windows-bench-host/setup.ps1 -OutFile setup.ps1
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -AuthorizedKeysUrl https://github.com/<your-github-user>.keys
```

`-AuthorizedKeysUrl` authorises the SSH keys on your GitHub account; use `-AuthorizedKey 'ssh-ed25519 AAAA...'` instead to authorise one specific key.

A browser window opens for the Tailscale sign-in (the only credential needed). If WSL had to be switched on, the script asks for a restart: restart and run the same two lines again; finished steps are skipped. When the script finishes it prints the machine's Tailscale name and an `ssh` command to test from the other machine. If it fails it prints `FAILED:` with the reason, and a log is left in the current folder.

## What it changes

| Step | Change | Why |
|---|---|---|
| Tailscale | official MSI installed silently, signed in, unattended mode | reachable from the other machine at boot, with nobody logged in |
| OpenSSH server | installed, starts at boot, PowerShell as shell | the driving machine runs commands remotely |
| SSH keys | added to `C:\ProgramData\ssh\administrators_authorized_keys` and `~\.ssh\authorized_keys` | key login, no passwords |
| Firewall | SSH (22), the model server ports (default 8080) and dbench (7717) allowed from Tailscale addresses (`100.64.0.0/10`) only | nothing opened to the local network or internet |
| WSL2 | Ubuntu 24.04, mirrored networking, systemd on, 75% of memory, Linux user with no password | the benchmark harness and `dbench serve` are Linux programs; mirrored networking puts them on the Tailscale address |
| Power | no sleep or hibernate on mains power | a sleeping PC ends a run |
| Windows Update | settings page opened; you click "Pause updates" | an update restart ends a run |

Every step checks before changing anything, so the script can be run again safely.

It does not install an inference engine, a model, the harness or dbench: those are installed over SSH afterwards. Linux commands run through Windows: `ssh <user>@<host> wsl -d Ubuntu-24.04 -- <command>`.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `-AuthorizedKeysUrl` | none | URL serving SSH public keys, one per line (e.g. `https://github.com/<user>.keys`) |
| `-AuthorizedKey` | none | one or more public key lines |
| `-ModelServerPorts` | `8080` | ports opened (Tailscale only) for the inference server |
| `-DbenchPort` | `7717` | port for `dbench serve`, Tailscale only |
| `-TailscaleAuthKey` | none | join Tailscale without the browser sign-in |
| `-WslDistro` | `Ubuntu-24.04` | WSL distribution |
| `-WslUser` | `julian` | Linux user created inside WSL (no password; root via `wsl -u root`) |
| `-WslMemoryPercent` | `75` | share of memory WSL may use |
| `-SkipWsl` | off | skip WSL entirely |

At least one key must be given.

## Undo

- SSH: `Stop-Service sshd; Set-Service sshd -StartupType Disabled`
- Firewall: `Remove-NetFirewallRule -Name 'Bench-Model-Server-Tailscale-*'`
- Tailscale: uninstall from Settings, Apps
- Power: Settings, System, Power, set sleep times again
- WSL: `wsl --unregister Ubuntu-24.04` (deletes the Linux side), and delete `%USERPROFILE%\.wslconfig`
