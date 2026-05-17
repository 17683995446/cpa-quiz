#!/bin/bash

# CPA智刷 - 注册会计师考试刷题平台
# 一键启动脚本 (Linux/Mac)

echo "========================================"
echo "   CPA智刷 - 注册会计师考试刷题平台"
echo "========================================"
echo ""

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 检查Python是否安装
if ! command -v python3 &> /dev/null; then
    echo "[错误] 未检测到Python3，请先安装"
    echo "Ubuntu/Debian: sudo apt-get install python3"
    echo "Mac: brew install python3"
    exit 1
fi

echo "正在启动服务器..."

# 在后台启动HTTP服务器
python3 -m http.server 8080 &
SERVER_PID=$!

# 等待服务器启动
sleep 2

# 检查服务器是否成功启动
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "[错误] 服务器启动失败，请检查8080端口是否被占用"
    exit 1
fi

echo "正在打开浏览器..."

# 根据系统打开浏览器
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open "http://localhost:8080"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open "http://localhost:8080" 2>/dev/null || \
    sensible-browser "http://localhost:8080" 2>/dev/null || \
    echo "请手动打开浏览器访问: http://localhost:8080"
else
    echo "请手动打开浏览器访问: http://localhost:8080"
fi

echo ""
echo "========================================"
echo "网站已启动！"
echo "访问地址: http://localhost:8080"
echo ""
echo "按 Ctrl+C 关闭服务器"
echo "========================================"

# 等待用户中断
trap "echo ''; echo '正在关闭服务器...'; kill $SERVER_PID 2>/dev/null; echo '服务器已关闭'; exit 0" INT
wait $SERVER_PID
