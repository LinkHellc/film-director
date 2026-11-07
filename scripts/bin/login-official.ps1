# 在独立配置目录 ~/.claude-film 里打开官方 Claude Code，用来 /login。不改 ~/.claude 的任何配置。
foreach ($name in 'ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_MODEL','ANTHROPIC_SMALL_FAST_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL') {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}
$env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE '.claude-film'
# git bash：已有 CLAUDE_CODE_GIT_BASH_PATH 就保留；否则用 FILM_GIT_BASH；否则由 PATH 里的 git.exe 推出 ..\bin\bash.exe（存在才设置）。与 claude-official.js 相同。
if (-not $env:CLAUDE_CODE_GIT_BASH_PATH) {
    if ($env:FILM_GIT_BASH) {
        $env:CLAUDE_CODE_GIT_BASH_PATH = $env:FILM_GIT_BASH
    } else {
        $git = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($git) {
            $bash = Join-Path (Split-Path (Split-Path $git.Source -Parent) -Parent) 'bin\bash.exe'
            if (Test-Path -LiteralPath $bash -PathType Leaf) { $env:CLAUDE_CODE_GIT_BASH_PATH = $bash }
        }
    }
}
Write-Host "配置目录：$env:CLAUDE_CONFIG_DIR"
Write-Host '打开后输入 /login 用官方账号登录，登录完输入 /exit 退出。'
claude
