# 美团外卖 / 淘宝闪购 - CDP 自动出餐 PoC

CDP 接管用户已登录 Chrome,真实鼠标点击 iframe 内的"上报出餐"按钮。
绕开阿里霸下风控(霸下识别程序化 click isTrusted=false,只放过真实输入事件)。

## 启动 Chrome(macOS)

```bash
# 关闭所有 Chrome 窗口,再启动带远程调试的实例
osascript -e 'quit app "Google Chrome"'
sleep 1
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-cdp-debug \
  --no-first-run --no-default-browser-check
```

注意:用 `-na`(新实例)+ `--user-data-dir` 隔离目录,**不会污染你正常 Chrome 的会话**。
登一次淘宝,把书签栏里 `melody.shop.ele.me` 打开一次让页面就位。

## 验证 CDP 通道

```bash
curl http://127.0.0.1:9222/json/version
# 应返回 webSocketDebuggerUrl
curl http://127.0.0.1:9222/json | python3 -c "import json,sys;[print(t['url'],t['id']) for t in json.load(sys.stdin)]"
# 应列出所有 tab,包括 melody.shop.ele.me
```

## 跑 PoC

```bash
cd takeout/cdp
pip3 install websocket-client
python3 cdp_poc.py
```
