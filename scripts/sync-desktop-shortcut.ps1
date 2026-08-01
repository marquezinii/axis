$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectRoot 'src-tauri\target\release\axis.exe'
$icon = Join-Path $projectRoot 'src-tauri\icons\icon.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Axis.lnk'

if (-not (Test-Path -LiteralPath $executable)) {
    throw "Build Axis first: pnpm tauri build"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = Split-Path -Parent $executable
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = 'Axis — Local control center for AI coding agents'
$shortcut.Save()

Write-Output $shortcutPath
