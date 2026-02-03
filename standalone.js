/**
 * ST Manager - 独立 Web 服务器
 * 可以独立运行，不依赖 SillyTavern
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

// 导入服务端插件模块
const pluginIndex = require('./server/index');

const app = express();
const PORT = process.env.PORT || 5000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务 - 前端
const clientDistPath = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
    app.use('/assets', express.static(clientDistPath));
}

// 模拟 SillyTavern 环境
process.cwd = () => path.join(__dirname, '..');

// 创建 API 路由
const apiRouter = express.Router();

// 初始化插件
(async () => {
    try {
        await pluginIndex.init(apiRouter);
        
        // 挂载 API 路由
        app.use('/api/plugins/st-manager', apiRouter);
        
        // 首页 - 提供简单的 UI
        app.get('/', (req, res) => {
            res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ST Manager - 资源管理工具</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 800px;
            width: 100%;
            padding: 40px;
        }
        h1 {
            color: #667eea;
            margin-bottom: 10px;
            font-size: 2.5em;
        }
        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 1.1em;
        }
        .status {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 30px;
        }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .feature {
            padding: 20px;
            background: #f8f9fa;
            border-radius: 10px;
            text-align: center;
        }
        .feature-icon {
            font-size: 2em;
            margin-bottom: 10px;
        }
        .feature-title {
            font-weight: bold;
            margin-bottom: 5px;
            color: #333;
        }
        .feature-desc {
            font-size: 0.9em;
            color: #666;
        }
        .api-section {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        .api-title {
            font-weight: bold;
            margin-bottom: 15px;
            color: #333;
        }
        .api-endpoint {
            font-family: 'Courier New', monospace;
            background: white;
            padding: 10px;
            margin: 5px 0;
            border-radius: 5px;
            font-size: 0.9em;
            border-left: 3px solid #667eea;
        }
        .method {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-weight: bold;
            font-size: 0.8em;
            margin-right: 10px;
        }
        .get { background: #28a745; color: white; }
        .post { background: #007bff; color: white; }
        .delete { background: #dc3545; color: white; }
        .footer {
            text-align: center;
            color: #666;
            margin-top: 30px;
            font-size: 0.9em;
        }
        a {
            color: #667eea;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎯 ST Manager</h1>
        <p class="subtitle">SillyTavern 资源管理与自动化工具</p>
        
        <div class="status">
            ✅ 服务运行中 | 端口: ${PORT} | 版本: 2.0.0
        </div>
        
        <div class="features">
            <div class="feature">
                <div class="feature-icon">📊</div>
                <div class="feature-title">资源管理</div>
                <div class="feature-desc">角色卡、世界书、预设</div>
            </div>
            <div class="feature">
                <div class="feature-icon">🔧</div>
                <div class="feature-title">正则管理</div>
                <div class="feature-desc">全局 + 预设绑定</div>
            </div>
            <div class="feature">
                <div class="feature-icon">💾</div>
                <div class="feature-title">备份恢复</div>
                <div class="feature-desc">自动备份与恢复</div>
            </div>
            <div class="feature">
                <div class="feature-icon">⚙️</div>
                <div class="feature-title">自动化</div>
                <div class="feature-desc">规则引擎</div>
            </div>
        </div>
        
        <div class="api-section">
            <div class="api-title">📡 常用 API 端点</div>
            <div class="api-endpoint">
                <span class="method get">GET</span>
                <a href="/api/plugins/st-manager/health" target="_blank">/api/plugins/st-manager/health</a>
                - 健康检查
            </div>
            <div class="api-endpoint">
                <span class="method get">GET</span>
                <a href="/api/plugins/st-manager/stats" target="_blank">/api/plugins/st-manager/stats</a>
                - 资源统计
            </div>
            <div class="api-endpoint">
                <span class="method get">GET</span>
                <a href="/api/plugins/st-manager/regex/aggregate" target="_blank">/api/plugins/st-manager/regex/aggregate</a>
                - 正则汇总
            </div>
            <div class="api-endpoint">
                <span class="method get">GET</span>
                <a href="/api/plugins/st-manager/cards/list" target="_blank">/api/plugins/st-manager/cards/list</a>
                - 角色卡列表
            </div>
            <div class="api-endpoint">
                <span class="method get">GET</span>
                <a href="/api/plugins/st-manager/presets/list" target="_blank">/api/plugins/st-manager/presets/list</a>
                - 预设列表
            </div>
        </div>
        
        <div class="footer">
            <p>📖 <a href="https://github.com/Youzini-afk/ST-Manager-serverplugin" target="_blank">GitHub</a> | 
            💡 完整文档请查看 README.md</p>
        </div>
    </div>
</body>
</html>
            `);
        });
        
        // 启动服务器
        app.listen(PORT, () => {
            console.log('');
            console.log('═══════════════════════════════════════════════');
            console.log('  🎯 ST Manager - 独立服务器启动成功');
            console.log('═══════════════════════════════════════════════');
            console.log(`  ✅ 服务地址: http://localhost:${PORT}`);
            console.log(`  📡 API 基础路径: /api/plugins/st-manager`);
            console.log(`  📖 API 文档: http://localhost:${PORT}`);
            console.log('═══════════════════════════════════════════════');
            console.log('');
        });
        
    } catch (error) {
        console.error('❌ 服务器启动失败:', error);
        process.exit(1);
    }
})();

// 错误处理
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ 
        success: false, 
        error: err.message 
    });
});

// 404 处理
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        error: 'API 端点不存在',
        path: req.path
    });
});
