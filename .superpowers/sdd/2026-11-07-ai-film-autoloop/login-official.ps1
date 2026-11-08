# 在独立配置目录 ~/.claude-film 里打开官方 Claude Code，用来 /login。不改 ~/.claude 的任何配置。
foreach ($name in 'ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_MODEL','ANTHROPIC_SMALL_FAST_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL') {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}
$env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE '.claude-film'
if (-not $env:CLAUDE_CODE_GIT_BASH_PATH) { $env:CLAUDE_CODE_GIT_BASH_PATH = 'E:\AI\tools\Git\bin\bash.exe' }
Write-Host "配置目录：$env:CLAUDE_CONFIG_DIR"
Write-Host '打开后输入 /login 用官方账号登录，登录完输入 /exit 退出。'
claude
