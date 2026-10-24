# Creates an "Articulation Coach" shortcut on your Desktop that opens the app
# in its own window (Chrome or Edge app mode).
$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot 'index.html'
$url = 'file:///' + (($app -replace '\\', '/') -replace ' ', '%20')

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) { Write-Host 'Chrome or Edge was not found. Please install Google Chrome or Microsoft Edge.'; exit 1 }

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Articulation Coach.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = $browser
$s.Arguments = "--app=`"$url`""
$s.WorkingDirectory = $PSScriptRoot
$s.IconLocation = "$browser,0"
$s.Description = 'Articulation Coach - daily 15-minute speaking practice'
$s.Save()
Write-Host "Done! 'Articulation Coach' is now on your Desktop: $lnk"
