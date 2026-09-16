# Installs the latest vibechat release for Windows into %LOCALAPPDATA%\vibechat\bin and adds it to your PATH.
#   irm https://raw.githubusercontent.com/Awakehsh/vibe-chat/main/install.ps1 | iex
$ErrorActionPreference = "Stop"
$repo = "Awakehsh/vibe-chat"
$dir = if ($env:VIBECHAT_INSTALL_DIR) { $env:VIBECHAT_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "vibechat\bin" }
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "x64" }
if ($arch -ne "x64") { throw "vibechat has no Windows $arch build yet; x64 only." }
$tag = if ($env:VIBECHAT_VERSION) { $env:VIBECHAT_VERSION } else { (Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest").tag_name }
$url = "https://github.com/$repo/releases/download/$tag/vibechat-windows-x64.exe"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir "vibechat.exe"
Write-Host "downloading $url"
Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $dir) {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
  $env:Path = "$env:Path;$dir"
  Write-Host "added $dir to your user PATH (open a new terminal to pick it up)"
}
Write-Host "installed vibechat $(& $exe --version) to $exe"
