# 从本地 Electron 缓存解包二进制到 node_modules/electron/dist
#
# 为什么需要这个脚本：
#   electron 的 postinstall 会从 GitHub Releases 下载二进制，而本机网络对该域名
#   存在 TLS 证书校验失败（unable to verify the first certificate）。本地已有
#   完整缓存 zip，因此改为「跳过下载 + 手动解包」。
#
# 用法：pwsh -File tools/setup-electron.ps1 [-Version 38.8.6] [-Arch x64]

param(
  [string]$Version = '38.8.6',
  [string]$Arch = 'x64'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$zipName = "electron-v$Version-win32-$Arch.zip"

# 缓存可能位于 ELECTRON_CACHE，或默认的 %LOCALAPPDATA%\electron\Cache
$candidates = @()
if ($env:ELECTRON_CACHE) { $candidates += (Join-Path $env:ELECTRON_CACHE $zipName) }
$candidates += (Join-Path $env:LOCALAPPDATA "electron\Cache\$zipName")

$zip = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $zip) {
  throw "未找到本地 Electron 缓存：$($candidates -join ' | ')"
}

$moduleDir = Join-Path $root 'node_modules\electron'
if (-not (Test-Path $moduleDir)) {
  throw "未找到 $moduleDir，请先运行 pnpm install"
}

$dist = Join-Path $moduleDir 'dist'
Write-Host "缓存包：$zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"
Write-Host "解包到：$dist"

if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# 解包到临时目录再移动：bsdtar 拒绝「穿过符号链接」写入
$tmp = Join-Path $env:TEMP "electron-unpack-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  & tar.exe -xf $zip -C $tmp
  if ($LASTEXITCODE -ne 0) { throw "tar 解包失败，退出码 $LASTEXITCODE" }
  Get-ChildItem -Path $tmp -Force | Move-Item -Destination $dist -Force
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Set-Content -Path (Join-Path $moduleDir 'path.txt') -Value 'electron.exe' -NoNewline -Encoding ascii

$exe = Join-Path $dist 'electron.exe'
if (-not (Test-Path $exe)) { throw "解包后未找到 electron.exe" }

Write-Host "Electron 版本：$(& $exe --version)"
Write-Host '完成。'
