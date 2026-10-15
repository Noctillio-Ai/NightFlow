<#
.SYNOPSIS
    Download and install a NightFlow update on Windows from its GitHub release.

.DESCRIPTION
    Windows counterpart of scripts/nightflow-update.sh. Used both for manual
    updates and for the in-app "Update" flow: when the running app triggers an
    update it passes its own PID via -WaitPid, and this script waits for the app
    to exit before installing (Windows locks a running .exe), then relaunches.

    NightFlow is not signed with a trusted code-signing certificate, so the
    downloaded installer carries the "Mark of the Web" and SmartScreen warns
    before running it. Unblock-File removes that mark from the one installer we
    downloaded -- the standard step for a self-distributed app. Scoped to that
    file only; nothing else is touched.

.PARAMETER Version
    Install this exact version (e.g. 0.3.0). Default: latest GitHub release.

.PARAMETER WaitPid
    Wait for this process id to exit before installing (set by the app).

.PARAMETER Relaunch
    Launch NightFlow again after a successful install.

.PARAMETER Yes
    Don't prompt for confirmation (non-interactive).

.EXAMPLE
    .\nightflow-update.ps1 -WaitPid 12345 -Relaunch -Yes
#>
[CmdletBinding()]
param(
    [string]$Version,
    [int]$WaitPid = 0,
    [switch]$Relaunch,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---- Configuration ----------------------------------------------------------
$Repo = if ($env:NIGHTFLOW_REPO) { $env:NIGHTFLOW_REPO } else { 'Noctillio-Ai/NightFlow' }
$Api  = "https://api.github.com/repos/$Repo"
$Headers = @{ 'User-Agent' = 'NightFlow-Updater' }
if ($env:GITHUB_TOKEN) { $Headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }

function Write-Log  { param($m) Write-Host "[nightflow-update] $m" -ForegroundColor Cyan }
function Write-Fail { param($m) Write-Host "[nightflow-update] $m" -ForegroundColor Red; exit 1 }

# ---- Detect architecture ----------------------------------------------------
switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { $ArchSlug = 'x64' }
    'ARM64' { $ArchSlug = 'arm64' }
    'x86'   { $ArchSlug = 'x64' }
    default { Write-Fail "Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE)" }
}

# ---- Resolve version / tag --------------------------------------------------
try {
    if (-not $Version) {
        Write-Log "Resolving latest release of $Repo..."
        $rel = Invoke-RestMethod -Uri "$Api/releases/latest" -Headers $Headers
        $Tag = $rel.tag_name
        if (-not $Tag) { Write-Fail "No releases found for $Repo." }
        $Version = $Tag.TrimStart('v')
    } else {
        $Version = $Version.TrimStart('v')
        $Tag = "v$Version"
    }
} catch {
    Write-Fail "Could not reach the GitHub API: $($_.Exception.Message)"
}

$Asset       = "NightFlow_${Version}_${ArchSlug}-setup.exe"
$DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/$Asset"

Write-Log "Target version : $Version ($Tag)"
Write-Log "Architecture   : $ArchSlug"
Write-Log "Asset          : $Asset"

if (-not $Yes) {
    $reply = Read-Host "Install NightFlow $Version? [y/N]"
    if ($reply -notmatch '^[Yy]$') { Write-Fail "Cancelled." }
}

# ---- Workspace --------------------------------------------------------------
$Work = Join-Path $env:TEMP ("nightflow-update-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Work -Force | Out-Null
$Installer = Join-Path $Work $Asset

try {
    # ---- Download -----------------------------------------------------------
    Write-Log "Downloading $DownloadUrl"
    try {
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $Installer -Headers $Headers
    } catch {
        Write-Fail "Download failed. Does release $Tag contain $Asset?"
    }

    # ---- Optional checksum verification -------------------------------------
    $Sha = "$Installer.sha256"
    try {
        Invoke-WebRequest -Uri "$DownloadUrl.sha256" -OutFile $Sha -Headers $Headers
        $expected = ((Get-Content $Sha -Raw) -split '\s+')[0].Trim().ToLower()
        $actual   = (Get-FileHash $Installer -Algorithm SHA256).Hash.ToLower()
        if ($expected -ne $actual) {
            Write-Fail "Checksum mismatch!`n  expected: $expected`n  actual:   $actual"
        }
        Write-Log "Checksum OK ($actual)"
    } catch {
        Write-Log "No published checksum; skipping verification."
    }

    # ---- Wait for the running app to quit -----------------------------------
    # A running NightFlow.exe is locked and can't be overwritten by the installer.
    if ($WaitPid -gt 0) {
        Write-Log "Waiting for NightFlow (pid $WaitPid) to quit..."
        try {
            $p = Get-Process -Id $WaitPid -ErrorAction SilentlyContinue
            if ($p) {
                if (-not $p.WaitForExit(10000)) {   # up to 10s graceful
                    Write-Log "Still running; stopping it."
                    $p | Stop-Process -Force -ErrorAction SilentlyContinue
                }
            }
        } catch { }
    }
    # Belt and suspenders: make sure no NightFlow process holds files.
    Get-Process -Name 'NightFlow' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500

    # ---- Mark of the Web: unblock the installer we just downloaded ----------
    Write-Log "Unblocking installer (clearing Mark of the Web)..."
    Unblock-File -Path $Installer -ErrorAction SilentlyContinue

    # ---- Run the NSIS installer silently ------------------------------------
    # perMachine install needs elevation; -Verb RunAs triggers UAC. /S = silent.
    Write-Log "Running installer..."
    $proc = Start-Process -FilePath $Installer -ArgumentList '/S' -Verb RunAs -PassThru -Wait
    if ($proc.ExitCode -ne 0) {
        Write-Fail "Installer exited with code $($proc.ExitCode)."
    }

    Write-Log "Installed NightFlow $Version [OK]"

    # ---- Relaunch -----------------------------------------------------------
    if ($Relaunch) {
        $exe = @(
            "$env:ProgramFiles\NightFlow\NightFlow.exe",
            "${env:ProgramFiles(x86)}\NightFlow\NightFlow.exe",
            "$env:LOCALAPPDATA\NightFlow\NightFlow.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($exe) {
            Write-Log "Relaunching NightFlow..."
            Start-Process -FilePath $exe
        } else {
            Write-Log "Installed, but could not locate NightFlow.exe to relaunch."
        }
    }
}
finally {
    Remove-Item -Path $Work -Recurse -Force -ErrorAction SilentlyContinue
}
