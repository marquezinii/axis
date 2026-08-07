# scripts/update-desktop-shortcut.ps1
# Regenerates the AgentOS desktop shortcut to point at the latest build.
# Runs automatically after every `npm run build` via the root postbuild script.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $repoRoot "apps\desktop\release"
$iconPath = Join-Path $repoRoot "assets\icon\icon.ico"

if (-not (Test-Path $releaseDir)) {
    Write-Host "No release build found at $releaseDir yet - skipping shortcut update."
    exit 0
}

$exePath = Join-Path $releaseDir "win-unpacked\AgentOS.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "No AgentOS executable found at $exePath yet - skipping shortcut update."
    exit 0
}

$exe = Get-Item $exePath

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "AgentOS.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exe.FullName
$shortcut.WorkingDirectory = $exe.DirectoryName
if (Test-Path $iconPath) {
    $shortcut.IconLocation = $iconPath
}
$shortcut.Save()

Write-Host "Updated desktop shortcut -> $($exe.FullName)"
