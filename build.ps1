# 外刊阅读器构建脚本
# 用法: .\build.ps1 <命令>
# 命令: build | verify | test | summaries | extract | concat | sync | all | clean | help

param(
    [Parameter(Position=0)]
    [string]$Command = "help",
    [string]$Data = "_articles.json",
    [string]$OutDir = "articles",
    [string]$Input = "",
    [string]$Lang = "en"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptsDir = Join-Path $ProjectRoot "scripts"
$ArticlesDir = Join-Path $ProjectRoot "articles"

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Err($msg) { Write-Host "  ERR: $msg" -ForegroundColor Red }

function Invoke-Python($script, $args) {
    $full = Join-Path $ScriptsDir $script
    Push-Location $ScriptsDir
    try {
        python $full @args
        if ($LASTEXITCODE -ne 0) { throw "$script exited with code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

switch ($Command) {
    "extract" {
        if (-not $Input) { Write-Err "请指定 --input <文件路径>"; exit 1 }
        Write-Step "提取段落 ($Lang)"
        Invoke-Python "extract_paragraphs.py" @("--input", $Input, "--lang", $Lang, "--format", "html")
        Write-Ok "段落已提取到 stdout，请保存为 en_body.html / cn_body.html"
    }

    "verify" {
        Write-Step "校验 EN/CN 段对齐"
        Invoke-Python "verify_alignment.py" @("--data", (Join-Path $ProjectRoot $Data))
        Write-Ok "对齐校验通过"
    }

    "summaries" {
        Write-Step "生成段摘要 + thesis"
        Invoke-Python "gen_summaries.py" @("--data", (Join-Path $ProjectRoot $Data))
        Write-Ok "摘要已生成（thesis 需手写替换【待填】）"
    }

    "concat" {
        Write-Step "合并 reader.js 模块"
        Invoke-Python "concat_reader.py" @()
        Write-Ok "reader.js 已合并"
    }

    "build" {
        Write-Step "合并模块 + 构建 HTML"
        Invoke-Python "concat_reader.py" @()
        Write-Ok "reader.js 合并"
        Invoke-Python "build_html.py" @("--data", (Join-Path $ProjectRoot $Data), "--out-dir", (Join-Path $ProjectRoot $OutDir))
        Write-Ok "HTML 已构建到 $OutDir/"
    }

    "test" {
        Write-Step "运行 UI 测试 (25 项)"
        Invoke-Python "test_html.py" @("--dir", (Join-Path $ProjectRoot $OutDir))
        Write-Ok "测试通过"
    }

    "sync" {
        Write-Step "合并并同步 src/ -> articles/"
        Invoke-Python "concat_reader.py" @()
        Copy-Item (Join-Path $ProjectRoot "src\reader.css") (Join-Path $ArticlesDir "reader.css") -Force
        Copy-Item (Join-Path $ProjectRoot "src\reader.js") (Join-Path $ArticlesDir "reader.js") -Force
        Write-Ok "reader.css + reader.js 已同步"
    }

    "all" {
        if (-not (Test-Path (Join-Path $ProjectRoot $Data))) {
            Write-Err "数据文件不存在: $Data"
            Write-Host "  请先准备 _articles.json，或运行: .\build.ps1 extract --input article.md"
            exit 1
        }
        Write-Step "完整构建流程: verify -> summaries -> concat -> build -> sync"
        Invoke-Python "verify_alignment.py" @("--data", (Join-Path $ProjectRoot $Data))
        Write-Ok "对齐校验"
        Invoke-Python "gen_summaries.py" @("--data", (Join-Path $ProjectRoot $Data))
        Write-Ok "摘要生成"
        Invoke-Python "concat_reader.py" @()
        Write-Ok "reader.js 合并"
        Invoke-Python "build_html.py" @("--data", (Join-Path $ProjectRoot $Data), "--out-dir", (Join-Path $ProjectRoot $OutDir))
        Write-Ok "HTML 构建"
        Copy-Item (Join-Path $ProjectRoot "src\reader.css") (Join-Path $ArticlesDir "reader.css") -Force
        Copy-Item (Join-Path $ProjectRoot "src\reader.js") (Join-Path $ArticlesDir "reader.js") -Force
        Write-Ok "资源同步"
        Write-Host "`n全部完成！" -ForegroundColor Green
    }

    "clean" {
        Write-Step "清理产物"
        $pycache = Join-Path $ScriptsDir "__pycache__"
        if (Test-Path $pycache) { Remove-Item $pycache -Recurse -Force; Write-Ok "删除 __pycache__" }
        Write-Host "  注意: articles/*.html 是最终产物，不会自动删除"
    }

    "help" {
        Write-Host @"
外刊阅读器构建脚本

用法: .\build.ps1 <命令> [选项]

命令:
  extract    从 MD 提取段落  --input <文件> --lang en|cn
  verify     校验 EN/CN 段对齐  --data <json>
  summaries  生成段摘要 + thesis  --data <json>
  concat     合并 src/js/*.js -> src/reader.js
  build      合并模块 + 构建 HTML  --data <json> --out-dir <目录>
  test       运行 UI 测试 (25 项)  --dir <目录>
  sync       合并并同步 src/reader.css|js -> articles/
  all        完整流程: verify -> summaries -> concat -> build -> sync
  clean      清理 __pycache__
  help       显示此帮助

示例:
  .\build.ps1 all
  .\build.ps1 build --data _articles.json
  .\build.ps1 extract --input article_en.md --lang en
  .\build.ps1 sync
  .\build.ps1 test
"@
    }

    default {
        Write-Err "未知命令: $Command"
        Write-Host "运行 .\build.ps1 help 查看可用命令"
        exit 1
    }
}