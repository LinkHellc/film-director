# 新电脑一键部署：在仓库根目录的 PowerShell 里运行
#   powershell -NoProfile -ExecutionPolicy Bypass -File setup\install.ps1
# 做的事：检查/安装 Node、ffmpeg、Codex CLI；建 .venv 装 Pillow；把 Claude 记忆装到本机；检查网关 Key；跑测试。
# 不会读取、打印或写入任何密钥。

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Write-Host "仓库目录：$Root"

function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# 1. Node 24+
if (-not (Has node)) {
  Write-Host '没找到 Node，用 winget 安装 Node.js（LTS 24+）……'
  winget install --id OpenJS.NodeJS -e --accept-source-agreements --accept-package-agreements
  Write-Host '装完请关掉这个窗口、开新 PowerShell 再运行一次本脚本。'; exit 1
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { Write-Host "Node 版本太旧（$(node --version)），需要 24 或更高。"; exit 1 }
Write-Host "Node $(node --version) OK"

# 2. ffmpeg
if (-not (Has ffmpeg)) {
  Write-Host '没找到 ffmpeg，用 winget 安装 Gyan.FFmpeg……（脚本会自动找 winget 安装目录，不用重开窗口）'
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
} else { Write-Host 'ffmpeg OK' }

# 3. Codex CLI（画师）
if (-not (Has codex)) {
  Write-Host '安装 Codex CLI……'
  npm install -g @openai/codex@latest
}
Write-Host "Codex：$(codex --version)。第一次用要在终端运行 codex 按提示登录。"

# 4. Python 虚拟环境
if (-not (Test-Path '.venv\Scripts\python.exe')) {
  if (Has py) { py -3 -m venv .venv } elseif (Has python) { python -m venv .venv }
  else { Write-Host '没找到 Python 3，请先装（winget install Python.Python.3.13）再运行。'; exit 1 }
}
& .venv\Scripts\python -m pip install -q -r requirements.txt
Write-Host 'Python .venv + Pillow OK'

# 5. Claude 记忆：装到 ~/.claude/projects/<按仓库路径算出的目录>/memory
$slug = ($Root -replace '[^A-Za-z0-9]', '-')
$memDir = Join-Path $env:USERPROFILE ".claude\projects\$slug\memory"
New-Item -ItemType Directory -Force -Path $memDir | Out-Null
Get-ChildItem 'setup\claude-memory\*.md' | ForEach-Object {
  $dst = Join-Path $memDir $_.Name
  if (Test-Path $dst) { Write-Host "记忆已存在，不覆盖：$($_.Name)" }
  else { Copy-Item $_.FullName $dst; Write-Host "已装记忆：$($_.Name)" }
}
Write-Host "记忆目录：$memDir"

# 6. 视频网关 Key（只检查有没有，不打印）
if ([Environment]::GetEnvironmentVariable('SEEDANCE_API_KEY', 'User')) { Write-Host 'SEEDANCE_API_KEY：已设' }
else {
  Write-Host 'SEEDANCE_API_KEY：没设。请自己运行（把 <你的key> 换掉）：'
  Write-Host "  [Environment]::SetEnvironmentVariable('SEEDANCE_API_KEY','<你的key>','User')"
  Write-Host '  设完重启 Claude 桌面端。'
}

# 7. 测试
npm test
& .venv\Scripts\python -m unittest discover -s tests/py
Write-Host '部署完成。在 Claude 桌面端用 Code 打开本目录，说"开一支新片：……"即可。'
