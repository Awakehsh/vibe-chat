# Installs the latest vibechat release for Windows into %LOCALAPPDATA%\vibechat\bin, adds it to
# your PATH, and joins a room when $env:VIBECHAT_JOIN is set.
#   irm https://raw.githubusercontent.com/Awakehsh/vibe-chat/main/install.ps1 | iex
#   $env:VIBECHAT_JOIN='<server>/TOKEN'; irm <server>/install.ps1 | iex
$ErrorActionPreference = "Stop"
$repo = "Awakehsh/vibe-chat"
$dir = if ($env:VIBECHAT_INSTALL_DIR) { $env:VIBECHAT_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "vibechat\bin" }
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "x64" }
if ($arch -ne "x64") { throw "vibechat has no Windows $arch build yet; x64 only." }
$tag = if ($env:VIBECHAT_VERSION) { $env:VIBECHAT_VERSION } else { (Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest").tag_name }
$url = "https://github.com/$repo/releases/download/$tag/vibechat-windows-x64.exe"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir "vibechat.exe"
$old = Join-Path $dir "vibechat.exe.old"
# A running .exe cannot be overwritten, but it can be renamed out of the way, so
# reinstalling does not require closing the chat first.
Remove-Item $old -Force -ErrorAction SilentlyContinue
if (Test-Path $exe) { Rename-Item $exe $old -Force }
Write-Host "downloading $url (about 93 MB, this takes a minute)"
# Windows PowerShell 5.1 redraws the progress bar per chunk, which makes a download
# of this size many times slower; it is restored below.
$prevProgress = $ProgressPreference
$ProgressPreference = "SilentlyContinue"
try { Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing } finally { $ProgressPreference = $prevProgress }
# Gone unless the previous copy is still open; then it goes at the next install.
Remove-Item $old -Force -ErrorAction SilentlyContinue
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $dir) {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
  $env:Path = "$env:Path;$dir"
  Write-Host "added $dir to your user PATH (open a new terminal to pick it up)"
}
Write-Host "installed vibechat $(& $exe --version) to $exe"

if ($env:VIBECHAT_JOIN) {
  Write-Host ""
  & $exe join $env:VIBECHAT_JOIN
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "vibechat is installed, but joining did not go through." -ForegroundColor Yellow
    Write-Host "open a new terminal, run  vibechat  and type:"
    Write-Host "  /join $env:VIBECHAT_JOIN"
    exit 1
  }
  Write-Host "run  vibechat  to open the chat"
}
