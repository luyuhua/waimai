"""
CDP PoC: 找到淘宝闪购"上报出餐"按钮并用真实鼠标事件点击

⚠️ 重要约束(2026-06-19 阿里霸下风控调查结论):
- 霸下 hook 了 window.fetch / XHR,程序化 HTTP 请求一律触发风控
- 真实鼠标事件(Input.dispatchMouseEvent)走 Chromium 输入管道,
  事件 isTrusted=true,霸下识别为用户操作
- 本 PoC 不发任何 fetch,只在 iframe 里查 DOM + 发真实点击
- 每次只点 1 单,跑完手动关闭(不进入 120s 轮询,等 PoC 验收完再加)

依赖: pip3 install websocket-client
启动: Chrome 必须带 --remote-debugging-port=9222
"""

import json
import random
import sys
import time
import urllib.request
from typing import Optional

try:
    import websocket  # pip3 install websocket-client
except ImportError:
    print("❌ 缺少 websocket-client,先执行: pip3 install websocket-client", file=sys.stderr)
    sys.exit(1)


CDP_HTTP = "http://127.0.0.1:9222/json"
IFRAME_URL_KEYWORD = "napos-order-pc.faas.ele.me"  # 订单 iframe 域名片段
BUTTON_TEXT = "上报出餐"  # 按钮文案
COOLDOWN_SECONDS = 60  # 找到按钮后,强制等够 60 秒再点(避免出餐太快触发风控/异常)


# ---------- CDP 通信层 ----------

class CDP:
    def __init__(self, ws_url: str):
        self.ws = websocket.create_connection(ws_url, timeout=10)
        self._id = 0

    def send(self, method: str, params: Optional[dict] = None) -> dict:
        self._id += 1
        msg_id = self._id
        self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        # 可能需要消费事件消息(分页、console 等),所以循环读
        while True:
            raw = self.ws.recv()
            data = json.loads(raw)
            if data.get("id") == msg_id:
                if "error" in data:
                    raise RuntimeError(f"CDP {method} 错误: {data['error']}")
                return data.get("result", {})
            # 否则是事件,丢弃(本 PoC 不订阅事件)

    def close(self):
        self.ws.close()


# ---------- 工具函数 ----------

def find_target() -> dict:
    """从 /json 端点找到 melody.shop.ele.me 对应的 tab"""
    resp = urllib.request.urlopen(CDP_HTTP, timeout=5).read()
    targets = json.loads(resp)
    for t in targets:
        url = t.get("url", "")
        if "melody.shop.ele.me" in url and t.get("type") == "page":
            return t
    raise RuntimeError(
        f"找不到 melody.shop.ele.me 的 tab。\n"
        f"当前所有 tab:\n" + "\n".join(f"  - {t.get('url')} ({t.get('type')})" for t in targets)
    )


def find_iframe_frame(cdp: CDP) -> Optional[str]:
    """找到订单 iframe 的 frameId。

    Chrome 149 的 Page.getFrameTree 在 tab 刚加载时可能返空 url,
    所以重试 5 次,每次之间等 1 秒让 frame tree 刷新。
    """
    KEYWORD = "napos-order-pc"

    def walk(node, predicate):
        if predicate(node):
            return node.get("frame", {}).get("id")
        for child in node.get("childFrames", []):
            found = walk(child, predicate)
            if found:
                return found
        return None

    def get_url(node):
        return (node.get("frame", {}).get("url") or "")

    # 多轮重试,因为 frame tree 在 iframe 刚挂载时 url 可能是空
    for attempt in range(5):
        tree = cdp.send("Page.getFrameTree")["frameTree"]
        # 优先按 url 匹配
        fid = walk(tree, lambda n: KEYWORD in get_url(n))
        if fid:
            print(f"  ✅ frame tree 第 {attempt+1} 次拿到 url 匹配")
            return fid
        # 兜底:按 main page 上挂的 iframe 顺序,在 frame tree 子节点里按位置对应
        # (不可靠,只在极端情况用)
        time.sleep(1)
    return None


def query_button_in_iframe(cdp: CDP, frame_id: str) -> Optional[dict]:
    """在订单 iframe 里建隔离执行上下文,查按钮位置"""
    ctx_id = cdp.send("Page.createIsolatedWorld", {
        "frameId": frame_id,
        "worldName": "auto-cook-poc"
    })["executionContextId"]

    js = """
    (() => {
        // 淘宝按钮是 <div> 不是 <button>,所以两个都查
        const candidates = document.querySelectorAll('div, button, span');
        for (const el of candidates) {
            // 只看可见元素
            if (!el.offsetParent) continue;
            const text = (el.innerText || el.textContent || '').trim();
            if (!text.includes('上报出餐')) continue;
            // 必须有大小
            const r = el.getBoundingClientRect();
            if (r.width < 5 || r.height < 5) continue;
            return {
                found: true,
                text: text,
                x: r.x + r.width / 2,
                y: r.y + r.height / 2,
                w: r.width,
                h: r.height,
                tag: el.tagName,
                cls: (el.className || '').toString().slice(0, 80)
            };
        }
        return { found: false };
    })()
    """
    result = cdp.send("Runtime.evaluate", {
        "expression": js,
        "contextId": ctx_id,
        "returnByValue": True
    })
    return result.get("result", {}).get("value")


def dispatch_mouse(cdp: CDP, x: float, y: float) -> None:
    """发真实鼠标事件:move → press → release。50-150ms 随机延迟模拟人手"""
    # 加 ±3 像素抖动,更像人手
    x += random.uniform(-3, 3)
    y += random.uniform(-3, 3)

    print(f"  🖱  鼠标移到 ({x:.1f}, {y:.1f})")
    cdp.send("Input.dispatchMouseEvent", {
        "type": "mouseMoved", "x": x, "y": y
    })
    time.sleep(random.uniform(0.05, 0.15))

    print(f"  ⬇  鼠标按下 ({x:.1f}, {y:.1f})")
    cdp.send("Input.dispatchMouseEvent", {
        "type": "mousePressed",
        "x": x, "y": y,
        "button": "left",
        "clickCount": 1
    })
    time.sleep(random.uniform(0.04, 0.10))

    print(f"  ⬆  鼠标抬起 ({x:.1f}, {y:.1f})")
    cdp.send("Input.dispatchMouseEvent", {
        "type": "mouseReleased",
        "x": x, "y": y,
        "button": "left",
        "clickCount": 1
    })


def check_captcha(cdp: CDP) -> bool:
    """查主页有没有风控弹窗(粗略检测,不一定准)"""
    # 主页面查
    result = cdp.send("Runtime.evaluate", {
        "expression": "document.body && document.body.innerText && /滑动|验证|风控|captcha/i.test(document.body.innerText)",
        "returnByValue": True
    })
    return bool(result.get("result", {}).get("value"))


# ---------- 主流程 ----------

def main():
    print("=" * 60)
    print("🛵  CDP PoC: 淘宝闪购 - 找按钮 + 真实点击")
    print("=" * 60)

    # Step 1: 找 tab
    print("\n[1/5] 查找淘宝闪购 tab ...")
    target = find_target()
    ws_url = target["webSocketDebuggerUrl"]
    print(f"  ✅ 找到 tab: {target.get('title', '')}")
    print(f"     URL: {target.get('url', '')}")
    print(f"     WS:  {ws_url}")

    cdp = CDP(ws_url)
    try:
        # 启用 CDP domain(否则 Page.getFrameTree 返空 url,Runtime.evaluate 不返值)
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")
        print("  ✅ CDP Page/Runtime enabled")

        # Step 2: 找订单 iframe
        print("\n[2/5] 查找订单 iframe ...")
        frame_id = find_iframe_frame(cdp)
        if not frame_id:
            print(f"  ❌ 找不到包含 {IFRAME_URL_KEYWORD} 的 iframe")
            print("  💡 确认淘宝页面已经进入「订单处理」tab,iframe 已加载")
            return 1
        print(f"  ✅ 找到 iframe frameId = {frame_id}")

        # Step 3: 查按钮
        print(f"\n[3/5] 查找按钮「{BUTTON_TEXT}」 ...")
        btn = query_button_in_iframe(cdp, frame_id)
        if not btn or not btn.get("found"):
            print(f"  ❌ 当前没有「待出餐」订单(按钮未出现)")
            print("  💡 等真实新订单进来后再跑一次")
            return 1

        print(f"  ✅ 找到按钮:")
        print(f"     文案: {btn['text']}")
        print(f"     标签: <{btn['tag']} class=\"{btn['cls']}\">")
        print(f"     中心坐标: ({btn['x']:.1f}, {btn['y']:.1f})")
        print(f"     尺寸: {btn['w']:.0f} × {btn['h']:.0f}")

        # Step 4: 冷却
        print(f"\n[4/5] 出餐前冷却 {COOLDOWN_SECONDS} 秒 ...")
        print("  (避免出餐速度异常触发风控/订单系统告警)")
        for remaining in range(COOLDOWN_SECONDS, 0, -5):
            print(f"  ⏳ 剩余 {remaining} 秒 ...", end="\r")
            time.sleep(5)
        print(f"  ✅ 冷却完毕{'':30s}")

        # 最后再查一次按钮(订单可能在冷却期间被骑手/系统处理掉)
        print("\n[最后检查] 重新确认按钮仍在 ...")
        btn2 = query_button_in_iframe(cdp, frame_id)
        if not btn2 or not btn2.get("found"):
            print("  ⚠️  按钮已消失(订单可能已出餐/取消),不再点击")
            return 1
        if abs(btn2["x"] - btn["x"]) > 50 or abs(btn2["y"] - btn["y"]) > 50:
            print(f"  ⚠️  按钮位置已变化(原 ({btn['x']:.0f},{btn['y']:.0f}) → 现 ({btn2['x']:.0f},{btn2['y']:.0f}))")
            print("  💡 为安全起见,使用新坐标")
            btn = btn2
        print(f"  ✅ 按钮仍在,坐标 ({btn['x']:.1f}, {btn['y']:.1f})")

        # Step 5: 真实点击
        print("\n[5/5] 发送真实鼠标事件 ...")
        dispatch_mouse(cdp, btn["x"], btn["y"])

        # 验证
        print("\n[验证] 等待 3 秒让 UI 更新 ...")
        time.sleep(3)

        if check_captcha(cdp):
            print("  🚨 检测到风控弹窗(滑动/验证/captcha)")
            print("  💡 CDP 方案可能也走不通,需要看霸下是否检测到自动化")
            return 2

        # 再查按钮是否消失
        btn3 = query_button_in_iframe(cdp, frame_id)
        if not btn3 or not btn3.get("found"):
            print("  ✅ 按钮已消失 → 订单已出餐,PoC 成功")
            return 0
        else:
            print("  ⚠️  按钮仍存在(可能需要二次确认/弹窗未关闭)")
            print("  💡 看浏览器窗口确认订单是否真出餐了")
            return 0

    finally:
        cdp.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\n⏹  用户中断")
        sys.exit(130)
    except Exception as e:
        print(f"\n❌ 异常: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
