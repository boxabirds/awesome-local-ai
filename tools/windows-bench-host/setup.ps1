<#
.SYNOPSIS
One-time setup that turns a Windows PC with an NVIDIA GPU (for example a gaming PC) into a
benchmark host another machine can drive over SSH through Tailscale.

.DESCRIPTION
Run once, at the keyboard, in PowerShell opened with "Run as administrator".
Safe to run again: every step checks before it changes anything.

  1. Installs Tailscale (the official MSI, silently) and joins your tailnet. A browser window asks you to sign in,
     unless -TailscaleAuthKey is given. Unattended mode keeps it connected at boot with nobody logged in.
  2. Installs and starts the Windows OpenSSH server, starting at boot, with PowerShell as its shell.
  3. Authorises the SSH public keys you pass (key login for those keys).
  4. Allows SSH, the model server port(s) and dbench's port from Tailscale addresses only.
     Installs WSL2 with Ubuntu (mirrored networking, systemd on, a Linux user with no password)
     for the Linux benchmark harness. The first run may ask for a restart: then run it again.
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

.PARAMETER DbenchPort
Port dbench serve listens on (inside WSL), opened to Tailscale addresses only. Default 7717.

.PARAMETER TailscaleAuthKey
Optional Tailscale auth key, to join without the browser sign-in.

.PARAMETER WslDistro
WSL distribution to install. Default Ubuntu-24.04.

.PARAMETER WslUser
Linux user created inside WSL (no password). Default julian.

.PARAMETER WslMemoryPercent
Share of the PC's memory WSL may use. Default 75.

.PARAMETER SkipWsl
Do not install or configure WSL.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -AuthorizedKeysUrl https://github.com/boxabirds.keys
#>
[CmdletBinding()]
param(
    [string]   $AuthorizedKeysUrl,
    [string[]] $AuthorizedKey = @(),
    [int[]]    $ModelServerPorts = @(8080),
    [int]      $DbenchPort = 7717,
    [string]   $TailscaleAuthKey,
    [string]   $WslDistro = 'Ubuntu-24.04',
    [string]   $WslUser = 'julian',
    [int]      $WslMemoryPercent = 75,
    [switch]   $SkipWsl
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
$TailscaleMsiUrl = 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi'
$BytesPerGB    = 1GB
$PercentScale  = 100
$UserPattern   = '^[a-z_][a-z0-9_-]{0,31}$'   # a valid Linux user name
$RebootNeededExit = 3010                      # Windows "success, reboot required"

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
        # The official MSI, installed silently: works with or without winget.
        $msi = Join-Path $env:TEMP 'tailscale-setup.msi'
        Write-Host "    downloading $TailscaleMsiUrl"
        Invoke-WebRequest -Uri $TailscaleMsiUrl -OutFile $msi -UseBasicParsing
        $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') -Wait -PassThru
        if ($p.ExitCode -ne 0 -and $p.ExitCode -ne $RebootNeededExit) { throw "Tailscale installer failed (exit $($p.ExitCode))." }
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
    $benchPorts = @($ModelServerPorts) + @($DbenchPort)
    foreach ($port in $benchPorts) {
        $name = "$ModelRulePrefix-$port"
        if (-not (Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue)) {
            New-NetFirewallRule -Name $name -DisplayName "Benchmark port $port (Tailscale only)" -Direction Inbound `
                -Protocol TCP -LocalPort $port -RemoteAddress $TailnetRange -Action Allow | Out-Null
        }
    }
    Ok "ports $SshPort and $($benchPorts -join ', ') open to $TailnetRange only"

    # ---- 4b. WSL2 with Ubuntu, for the Linux benchmark harness --------------
    if (-not $SkipWsl) {
        Step "WSL2 ($WslDistro)"
        if ($WslUser -notmatch $UserPattern) { throw "-WslUser '$WslUser' is not a valid Linux user name." }

        # Windows-side WSL settings: mirrored networking (WSL shares the Tailscale address), memory cap.
        $totalGB = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / $BytesPerGB)
        $memGB   = [math]::Floor($totalGB * $WslMemoryPercent / $PercentScale)
        $wslConfig = @(
            '[wsl2]'
            "memory=${memGB}GB"
            'networkingMode=mirrored'
            'vmIdleTimeout=-1'
        ) -join "`r`n"
        Set-Content -Path (Join-Path $env:USERPROFILE '.wslconfig') -Value $wslConfig -Encoding ascii
        Ok "WSL settings: ${memGB} GB of ${totalGB} GB, mirrored networking"

        $installed = (wsl.exe --list --quiet 2>$null) -replace "`0", '' | Where-Object { $_.Trim() -eq $WslDistro }
        if (-not $installed) {
            wsl.exe --install --distribution $WslDistro --no-launch
            $installed = (wsl.exe --list --quiet 2>$null) -replace "`0", '' | Where-Object { $_.Trim() -eq $WslDistro }
            if (-not $installed) {
                Write-Host "`nWSL was just enabled and Windows needs a RESTART. Restart, then run this script again;" -ForegroundColor Yellow
                Write-Host 'the finished steps are skipped the second time.' -ForegroundColor Yellow
                exit 0
            }
        }

        # Inside Ubuntu, as root: the user (no password; root is reached from Windows with wsl -u root),
        # systemd on (the harness's process containment needs it), that user as the default.
        $linuxSetup = @"
set -e
id -u $WslUser >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo $WslUser
printf '[boot]\nsystemd=true\n\n[user]\ndefault=$WslUser\n' > /etc/wsl.conf
loginctl enable-linger $WslUser 2>/dev/null || true
"@ -replace "`r", ''
        wsl.exe -d $WslDistro -u root -- bash -c $linuxSetup
        if ($LASTEXITCODE -ne 0) { throw 'Setting up the Linux user inside WSL failed.' }
        wsl.exe --shutdown   # applies .wslconfig and wsl.conf on the next start
        Ok "Linux user '$WslUser', systemd on; reach it with: wsl -d $WslDistro"
    }

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
    if (-not $SkipWsl) { Write-Host "Linux inside it:              ssh $env:USERNAME@$tsName wsl -d $WslDistro -- uname -a" }
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
