#!/bin/bash
# Chrome 启动器 —— 用默认 profile + 9222 调试端口启动
# 用法: bash chrome_launcher.sh
# 可以把这个脚本放到 Dock 或用 osacompile 打包成 .app

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DEBUG_PORT=9222
USER_DATA="/Users/luyuhua/Library/Application Support/Google/ChromeCDP"

# 如果 Chrome 已经在跑且带 9222 端口,直接退出
if lsof -i :$DEBUG_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✅ Chrome 已在运行且 9222 端口已监听,无需重启"
    open -a "Google Chrome"
    exit 0
fi

# 如果 Chrome 在跑但不带 9222 端口,先关掉
if pgrep -f "Google Chrome" >/dev/null 2>&1; then
    echo "⏳ Chrome 正在运行但未开启调试端口,正在关闭 ..."
    osascript -e 'quit app "Google Chrome"'
    sleep 2
fi

# 启动 Chrome (用 CDP 专用 profile,非默认目录以允许远程调试)
echo "🚀 启动 Chrome (CDP profile + 调试端口 $DEBUG_PORT) ..."
nohup "$CHROME" \
    --user-data-dir="$USER_DATA" \
    --remote-debugging-port=$DEBUG_PORT \
    --remote-allow-origins=* \
    >/dev/null 2>&1 &

sleep 1
if lsof -i :$DEBUG_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✅ Chrome 已启动,调试端口 $DEBUG_PORT 已就绪"
else
    echo "⚠️  Chrome 已启动但 9222 端口暂未响应,稍等即可"
fi
