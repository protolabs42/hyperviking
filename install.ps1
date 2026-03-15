# HyperViking installer for Windows
# iwr -useb https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$repo = "https://github.com/protolabs42/hyperviking.git"
$installDir = if ($env:HYPERVIKING_HOME) { $env:HYPERVIKING_HOME } else { "$env:USERPROFILE\.hyperviking" }
$repoDir = "$installDir\repo"

Write-Host "HyperViking - encrypted P2P knowledge brain for AI agents" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
    $nodeVersion = (node -e "console.log(process.versions.node.split('.')[0])") 2>$null
    if ([int]$nodeVersion -lt 18) {
        Write-Host "error: Node.js 18+ required (found v$nodeVersion)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "error: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Check git
try { git --version | Out-Null } catch {
    Write-Host "error: git not found." -ForegroundColor Red
    exit 1
}

# Install or update
if (Test-Path "$repoDir\.git") {
    Write-Host "updating..."
    Push-Location $repoDir
    git pull --ff-only
    Pop-Location
} else {
    Write-Host "installing to $installDir..."
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    git clone $repo $repoDir
}

# Build
Push-Location $repoDir
npm install --ignore-scripts 2>$null
npm run build
npm prune --production 2>$null
Pop-Location

# Create wrapper script
$binDir = "$env:USERPROFILE\.local\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$wrapper = @"
@echo off
node "$repoDir\dist\cli.js" %*
"@
Set-Content -Path "$binDir\hv.cmd" -Value $wrapper

# Add to PATH if needed
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$binDir;$userPath", "User")
    $env:Path = "$binDir;$env:Path"
    Write-Host "added $binDir to PATH"
}

Write-Host ""
Write-Host "installed: hv $(& node "$repoDir\dist\cli.js" --version 2>$null)" -ForegroundColor Green
Write-Host ""
Write-Host "  hv init              setup your keypair"
Write-Host "  hv init --server     setup a server"
Write-Host "  hv help              all commands"
