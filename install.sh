#!/bin/bash
# ST Manager 插件安装脚本
# 用于首次安装或更新插件时自动安装依赖

echo "========================================"
echo "  ST Manager - 插件安装"
echo "========================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js"
    exit 1
fi
echo "✓ Node.js 版本: $(node -v)"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 未检测到 npm"
    exit 1
fi
echo "✓ npm 版本: $(npm -v)"
echo ""

# 安装依赖
echo "正在安装插件依赖..."
npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "  ✅ ST Manager 安装完成！"
    echo "========================================"
    echo ""
    echo "下一步：重启 SillyTavern"
    echo ""
    echo "启动后访问："
    echo "  • Web UI: http://localhost:5000"
    echo "  • 酒馆扩展: Extensions 标签页"
    echo ""
else
    echo ""
    echo "❌ 安装失败，请检查错误信息"
    exit 1
fi
