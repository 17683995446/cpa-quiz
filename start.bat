@echo off
chcp 65001 >nul
echo ========================================
echo    CPA智刷 - 注册会计师考试刷题平台
echo ========================================
echo.
echo 正在启动服务器...

:: 检查Python是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到Python，请先安装Python 3.x
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 获取当前目录
cd /d "%~dp0"

:: 启动HTTP服务器（在后台运行）
start /b python -m http.server 8080 >nul 2>&1

:: 等待服务器启动
timeout /t 2 /nobreak >nul

:: 打开浏览器
echo 正在打开浏览器...
start http://localhost:8080

echo.
echo ========================================
echo 网站已启动！
echo 访问地址: http://localhost:8080
echo.
echo 按任意键关闭服务器并退出...
echo ========================================
pause >nul

:: 关闭Python服务器
taskkill /f /im python.exe >nul 2>&1
echo 服务器已关闭
