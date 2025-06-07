# PowerShell script to stage a Codex CLI release
# This calls the Node.js script which works cross-platform

param(
    [string]$TmpDir = "",
    [switch]$Native = $false,
    [switch]$Help = $false
)

if ($Help) {
    Write-Host @"
Usage: .\stage_release.ps1 [-TmpDir DIR] [-Native] [-Help]

Options:
  -TmpDir DIR   Use DIR to stage the release (defaults to a fresh temp dir)
  -Native       Bundle Rust binaries for Linux (fat package)
  -Help         Show this help
"@
    exit 0
}

Write-Host "Staging Codex CLI release for Windows..." -ForegroundColor Green

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $scriptDir "stage_release.js"

$args = @()
if ($TmpDir) {
    $args += "--tmp", $TmpDir
}
if ($Native) {
    $args += "--native"
}

try {
    & node $nodeScript @args
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nRelease staging completed successfully!" -ForegroundColor Green
        Write-Host "Check the output above for instructions on how to test and distribute the package." -ForegroundColor Yellow
    } else {
        Write-Host "Failed to stage release. Check the error messages above." -ForegroundColor Red
        exit $LASTEXITCODE
    }
} catch {
    Write-Host "Error executing stage_release.js: $_" -ForegroundColor Red
    exit 1
} 