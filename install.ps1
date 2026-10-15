<#
.SYNOPSIS
    Install NightFlow on Windows from its GitHub release.

.DESCRIPTION
    Windows counterpart of install.sh. Downloads the NightFlow NSIS installer
    for the host architecture from the GitHub release and runs it silently.

    NightFlow is not signed with an EV / trusted code-signing certificate, so
    Windows marks the downloaded installer with the "Mark of the Web" and
    SmartScreen warns before running it. This script calls Unblock-File on the
    installer it just downloaded -- the normal, documented way to clear that
    mark on a self-distributed app. It is scoped to the one file it downloaded.

.PARAMETER Version
    Install this version (e.g. 0.3.0). Default: latest GitHub release.

.PARAMETER Relaunch
    Launch NightFlow after installing.

.PARAMETER Yes
    Don't prompt for confirmation.

.EXAMPLE
    irm https://raw.githubusercontent.com/Noctillio-Ai/NightFlow/main/install.ps1 | iex

.EXAMPLE
    .\install.ps1 -Version 0.3.0 -Relaunch
#>
[CmdletBinding()]
param(
    [string]$Version,
    [switch]$Relaunch,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---- Configuration ----------------------------------------------------------
$Repo = if ($env:NIGHTFLOW_REPO) { $env:NIGHTFLOW_REPO } else { 'Noctillio-Ai/NightFlow' }
$Api  = "https://api.github.com/repos/$Repo"
$Headers = @{ 'User-Agent' = 'NightFlow-Installer' }
if ($env:GITHUB_TOKEN) { $Headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }

function Write-Log  { param($m) Write-Host "[nightflow] $m" -ForegroundColor Cyan }
function Write-Fail { param($m) Write-Host "[nightflow] $m" -ForegroundColor Red; exit 1 }

# ---- Detect architecture ----------------------------------------------------
switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { $ArchSlug = 'x64' }
    'ARM64' { $ArchSlug = 'arm64' }
    'x86'   { $ArchSlug = 'x64' }   # 32-bit shell on 64-bit Windows
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

Write-Log "Version      : $Version ($Tag)"
Write-Log "Architecture : $ArchSlug"
Write-Log "Asset        : $Asset"

if (-not $Yes) {
    $reply = Read-Host "Install NightFlow $Version? [y/N]"
    if ($reply -notmatch '^[Yy]$') { Write-Fail "Cancelled." }
}

# ---- Workspace --------------------------------------------------------------
$Work = Join-Path $env:TEMP ("nightflow-install-" + [guid]::NewGuid().ToString('N'))
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

    # ---- Mark of the Web: unblock the installer we just downloaded ----------
    # SmartScreen warns on un-trusted downloads; Unblock-File removes the
    # Zone.Identifier stream (the "downloaded from the internet" mark) from this
    # one installer so it runs without the extra prompt. Scoped to this file.
    Write-Log "Unblocking installer (clearing Mark of the Web)..."
    Unblock-File -Path $Installer -ErrorAction SilentlyContinue

    # ---- Run the NSIS installer silently ------------------------------------
    # perMachine install needs elevation; Start-Process -Verb RunAs triggers UAC.
    # NSIS silent switch is /S. Quit any running copy first so files aren't locked.
    Get-Process -Name 'NightFlow' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500

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
            Write-Log "Launching NightFlow..."
            Start-Process -FilePath $exe
        } else {
            Write-Log "Installed, but could not locate NightFlow.exe to relaunch."
        }
    }
}
finally {
    Remove-Item -Path $Work -Recurse -Force -ErrorAction SilentlyContinue
}
