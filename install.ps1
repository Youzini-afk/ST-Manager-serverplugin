# ST Manager 插件安装脚本
# 用于首次安装或更新插件时自动安装依赖

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ST Manager - 插件安装" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
$nodeVersion = & node -v 2>$null
if (-not $nodeVersion) {
    Write-Host "❌ 未检测到 Node.js，请先安装 Node.js" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Node.js 版本: $nodeVersion" -ForegroundColor Green

# 检查 npm
$npmVersion = & npm -v 2>$null
if (-not $npmVersion) {
    Write-Host "❌ 未检测到 npm" -ForegroundColor Red
    exit 1
}
Write-Host "✓ npm 版本: $npmVersion" -ForegroundColor Green
Write-Host ""

# 安装依赖
Write-Host "正在安装插件依赖..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  ✅ ST Manager 安装完成！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "下一步：重启 SillyTavern" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "启动后访问：" -ForegroundColor White
    Write-Host "  • Web UI: http://localhost:5000" -ForegroundColor White
    Write-Host "  • 酒馆扩展: Extensions 标签页" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ 安装失败，请检查错误信息" -ForegroundColor Red
    exit 1
}
