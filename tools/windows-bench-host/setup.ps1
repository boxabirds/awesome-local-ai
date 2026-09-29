<#
.SYNOPSIS
One-time setup that turns a Windows PC with an NVIDIA GPU (for example a gaming PC) into a
benchmark host another machine can drive over SSH through Tailscale.

.DESCRIPTION
Run once, at the keyboard, in PowerShell opened with "Run as administrator".
Safe to run again: every step checks before it changes anything.

  1. Installs Tailscale (winget) and joins your tailnet. A browser window asks you to sign in,
     unless -TailscaleAuthKey is given. Unattended mode keeps it connected at boot with nobody logged in.
  2. Installs and starts the Windows OpenSSH server, starting at boot, with PowerShell as its shell.
  3. Authorises the SSH public keys you pass (key login for those keys).
  4. Allows SSH and the model server port(s) from Tailscale addresses only.
  5. Stops the PC sleeping or hibernating on mains power.
  6. Shows the GPU and driver, then opens Windows Update so you can pause updates
     (an update restart would kill a long run).

It does not install an inference engine or model; the driving machine does that over SSH afterwards.
A log is written to the current folder.

.PARAMETER AuthorizedKeysUrl
A URL serving SSH public keys, one per line. For a GitHub account: https://github.com/<user>.keys

.PARAMETER AuthorizedKey
One or more SSH public key lines, e.g. 'ssh-ed25519 AAAA... me@laptop'.

.PARAMETER ModelServerPorts
Ports the inference server will listen on, opened to Tailscale addresses only. Default 8080.

.PARAMETER TailscaleAuthKey
Optional Tailscale auth key, to join without the browser sign-in.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -AuthorizedKeysUrl https://github.com/boxabirds.keys
#>
[CmdletBinding()]
param(
    [string]   $AuthorizedKeysUrl,
    [string[]] $AuthorizedKey = @(),
    [int[]]    $ModelServerPorts = @(8080),
    [string]   $TailscaleAuthKey
)

$ErrorActionPreference = 'Stop'

# ---- constants --------------------------------------------------------------
$TailnetRange  = '100.64.0.0/10'          # every Tailscale address is in this range
$SshPort       = 22
$SshRuleName   = 'OpenSSH-Server-In-TCP'  # the rule Windows creates with the OpenSSH server
$ModelRulePrefix = 'Bench-Model-Server-Tailscale'
$TailscaleExe  = 'C:\Program Files\Tailscale\tailscale.exe'
$SshCapability = 'OpenSSH.Server~~~~0.0.1.0'
$AdminKeysFile = 'C:\ProgramData\ssh\administrators_authorized_keys'
$NeverTimeout  = 0                        # powercfg: 0 means never
$KeyPattern    = '^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp\d+|sk-\S+) \S+'

$LogFile = Join-Path (Get-Location) ("bench-host-setup-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))
Start-Transcript -Path $LogFile | Out-Null

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    ok: $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    WARNING: $text" -ForegroundColor Yellow }

try {
    # ---- 0. checks before changing anything ---------------------------------
    $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this from PowerShell opened with "Run as administrator".'
    }

    $keys = @($AuthorizedKey)
    if ($AuthorizedKeysUrl) {
        $keys += (Invoke-RestMethod -Uri $AuthorizedKeysUrl -UseBasicParsing) -split "`r?`n"
    }
    $keys = @($keys | ForEach-Object { $_.Trim() } | Where-Object { $_ -match $KeyPattern } | Select-Object -Unique)
    if ($keys.Count -eq 0) {
        throw 'No SSH public keys given. Pass -AuthorizedKeysUrl https://github.com/<user>.keys or -AuthorizedKey "ssh-ed25519 ...".'
    }

    # ---- 1. Tailscale -------------------------------------------------------
    Step 'Tailscale'
    if (-not (Test-Path $TailscaleExe)) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
            throw 'winget is not available. Install Tailscale from https://tailscale.com/download, then run this again.'
        }
        winget install --id Tailscale.Tailscale --exact --silent --accept-package-agreements --accept-source-agreements
        if (-not (Test-Path $TailscaleExe)) { throw "Tailscale was installed but $TailscaleExe is missing." }
        Ok 'installed'
    } else { Ok 'already installed' }

    $status = & $TailscaleExe status --json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($status.BackendState -ne 'Running') {
        $upArgs = @('up', '--unattended')
        if ($TailscaleAuthKey) { $upArgs += "--auth-key=$TailscaleAuthKey" }
        else { Write-Host '    A browser window will open: sign in with the same account as your other machines.' }
        & $TailscaleExe @upArgs
        if ($LASTEXITCODE -ne 0) { throw 'tailscale up failed.' }
    } else {
        Ok 'already signed in (if it was not started unattended, run: tailscale up --unattended)'
    }
    $self   = (& $TailscaleExe status --json | ConvertFrom-Json).Self
    $tsName = $self.DNSName.TrimEnd('.')
    $tsIp   = (& $TailscaleExe ip -4 | Select-Object -First 1).Trim()
    Ok "connected as $tsName ($tsIp)"

    # ---- 2. OpenSSH server --------------------------------------------------
    Step 'OpenSSH server'
    if ((Get-WindowsCapability -Online -Name $SshCapability).State -ne 'Installed') {
        Add-WindowsCapability -Online -Name $SshCapability | Out-Null
        Ok 'installed'
    } else { Ok 'already installed' }
    Set-Service -Name sshd -StartupType Automatic
    Start-Service sshd
    New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
    New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -PropertyType String -Force `
        -Value "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" | Out-Null
    Ok 'running, starts at boot, shell is PowerShell'

    # ---- 3. authorised keys -------------------------------------------------
    Step 'Authorised SSH keys'
    # Administrators log in with the shared file; the per-user file covers a non-admin login.
    $userKeysDir = Join-Path $env:USERPROFILE '.ssh'
    New-Item -ItemType Directory -Path $userKeysDir -Force | Out-Null
    foreach ($file in @($AdminKeysFile, (Join-Path $userKeysDir 'authorized_keys'))) {
        $existing = if (Test-Path $file) { @(Get-Content $file) } else { @() }
        foreach ($key in $keys) {
            if ($existing -notcontains $key) { Add-Content -Path $file -Value $key -Encoding ascii }
        }
    }
    # sshd ignores the administrators file unless only Administrators and SYSTEM can access it
    icacls.exe $AdminKeysFile /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
    Restart-Service sshd
    Ok "$($keys.Count) key(s) authorised for $env:USERNAME"

    # ---- 4. firewall: Tailscale only ----------------------------------------
    Step 'Firewall'
    if (Get-NetFirewallRule -Name $SshRuleName -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule -Name $SshRuleName -RemoteAddress $TailnetRange -Enabled True
    } else {
        New-NetFirewallRule -Name $SshRuleName -DisplayName 'OpenSSH Server (Tailscale only)' -Direction Inbound `
            -Protocol TCP -LocalPort $SshPort -RemoteAddress $TailnetRange -Action Allow | Out-Null
    }
    foreach ($port in $ModelServerPorts) {
        $name = "$ModelRulePrefix-$port"
        if (-not (Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -Name $name -DisplayName "Benchmark model server $port (Tailscale only)" -Direction Inbound `
                -Protocol TCP -LocalPort $port -RemoteAddress $TailnetRange -Action Allow | Out-Null
        }
    }
    Ok "ports $SshPort and $($ModelServerPorts -join ', ') open to $TailnetRange only"

    # ---- 5. never sleep on mains power --------------------------------------
    Step 'Power'
    powercfg /change standby-timeout-ac $NeverTimeout
    powercfg /change hibernate-timeout-ac $NeverTimeout
    Ok 'no sleep or hibernate on mains power (the screen may still turn off)'

    # ---- 6. GPU and Windows Update ------------------------------------------
    Step 'GPU'
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
        nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
    } else { Warn 'nvidia-smi not found: the NVIDIA driver may be missing.' }

    Step 'Windows Update'
    Write-Host '    Opening Windows Update settings: click "Pause updates" (longest option).'
    Start-Process 'ms-settings:windowsupdate'

    Write-Host "`nDONE. This machine's Tailscale name: $tsName ($tsIp)" -ForegroundColor Green
    Write-Host "Test from the other machine:  ssh $env:USERNAME@$tsName"
    Write-Host "Log: $LogFile"
}
catch {
    Write-Host "`nFAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Log: $LogFile"
    exit 1
}
finally {
    Stop-Transcript | Out-Null
}
