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
DEFAULT_BUTTON_TEXT = "上报出餐"  # 默认按钮文案
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


def query_button_in_iframe(cdp: CDP, frame_id: str, button_text: str = DEFAULT_BUTTON_TEXT) -> Optional[dict]:
    """在订单 iframe 里建隔离执行上下文,查按钮位置"""
    ctx_id = cdp.send("Page.createIsolatedWorld", {
        "frameId": frame_id,
        "worldName": "auto-cook-poc"
    })["executionContextId"]

    # 已知能用(2026-06-19 验证):只查 button,简化可见性
    # 关键:isolated world 里 arguments 是 undefined,BTN_TEXT 必须直接拼到 JS 里
    js_template = """
    (function() {
        const BTN_TEXT = "__BTN_TEXT__";
        const vw = window.innerWidth, vh = window.innerHeight;
        for (const el of document.querySelectorAll('button')) {
            const text = (el.innerText || '').trim();
            if (!text.includes(BTN_TEXT)) continue;
            const r = el.getBoundingClientRect();
            const x = Number(r.x) || 0;
            const y = Number(r.y) || 0;
            const w = Number(r.width) || 0;
            const h = Number(r.height) || 0;
            if (w < 5 || h < 5) continue;
            const right = Number(r.right) || 0;
            const bottom = Number(r.bottom) || 0;
            if (right < 0 || bottom < 0 || x > vw || y > vh) continue;
            return {
                found: true,
                text: text,
                x: x + w / 2,
                y: y + h / 2,
                w: w,
                h: h,
                tag: el.tagName,
                cls: (el.className || '').toString().slice(0, 80)
            };
        }
        return { found: false };
    })()
    """
    # 安全转义:BTN_TEXT 不含引号 / 反斜杠即可(button_text 来自 --text 参数,用户控制)
    safe_btn = button_text.replace("\\", "\\\\").replace('"', '\\"')
    js = js_template.replace("__BTN_TEXT__", safe_btn)

    result = cdp.send("Runtime.evaluate", {
        "expression": js,
        "contextId": ctx_id,
        "returnByValue": True
    })
    return result.get("result", {}).get("value")


def probe_all_clickables_in_iframe(cdp: CDP, frame_id: str, max_items: int = 200) -> list:
    """列出 iframe 里所有可见 div/button/span 的文字+坐标,用于调试选择器。"""
    ctx_id = cdp.send("Page.createIsolatedWorld", {
        "frameId": frame_id,
        "worldName": "auto-cook-poc"
    })["executionContextId"]

    # 只查 button,坐标用 Number() 显式包装避免 CDP 截断
    # arguments[0] 在 isolated world 是 undefined,MAX 拼到 JS 里
    js_template = """
    (function() {
        const MAX = __MAX__;
        const out = [];
        const vw = window.innerWidth, vh = window.innerHeight;
        for (const el of document.querySelectorAll('button')) {
            const text = (el.innerText || '').trim();
            if (!text) continue;
            const r = el.getBoundingClientRect();
            const x = Number(r.x) || 0;
            const y = Number(r.y) || 0;
            const w = Number(r.width) || 0;
            const h = Number(r.height) || 0;
            if (w < 5 || h < 5) continue;
            const right = Number(r.right) || 0;
            const bottom = Number(r.bottom) || 0;
            if (right < 0 || bottom < 0 || x > vw || y > vh) continue;
            const style = window.getComputedStyle(el);
            out.push({
                text: text,
                tag: el.tagName,
                x: Math.round(x + w / 2),
                y: Math.round(y + h / 2),
                bg: style.backgroundColor
            });
            if (out.length >= MAX) break;
        }
        return out;
    })()
    """
    js = js_template.replace("__MAX__", str(max_items))
    result = cdp.send("Runtime.evaluate", {
        "expression": js,
        "contextId": ctx_id,
        "returnByValue": True
    })
    return result.get("result", {}).get("value") or []


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


def get_iframe_offset(cdp: CDP, frame_id: str) -> Optional[dict]:
    """在主 page 查订单 iframe 的位置(跨域 iframe 内部 window.frameElement = null)

    通过主 page 找到 src 包含 napos-order-pc 的 <iframe> 元素,读它的 getBoundingClientRect。
    """
    result = cdp.send("Runtime.evaluate", {
        "expression": """
        (() => {
            const f = document.querySelector('iframe[src*="napos-order-pc"]');
            if (!f) return null;
            const r = f.getBoundingClientRect();
            return {
                x: Number(r.x) || 0,
                y: Number(r.y) || 0,
                w: Number(r.width) || 0,
                h: Number(r.height) || 0
            };
        })()
        """,
        "returnByValue": True
    })
    val = result.get("result", {}).get("value")
    return val if isinstance(val, dict) and val.get("w", 0) > 0 else None


# ---------- 主流程 ----------

def main():
    import argparse
    parser = argparse.ArgumentParser(description="CDP PoC: 找订单按钮 + 真实鼠标点击")
    parser.add_argument("--dry-run", action="store_true",
                        help="只查按钮不点击不冷却(用于调试选择器)")
    parser.add_argument("--probe", action="store_true",
                        help="列出 iframe 内所有可能按钮的元素(用于探查页面结构)")
    parser.add_argument("--text", default=DEFAULT_BUTTON_TEXT,
                        help=f"按钮文案(默认: {DEFAULT_BUTTON_TEXT})")
    parser.add_argument("--cooldown", type=int, default=0,
                        help="点击前冷却秒数(默认: 0,直接点)")
    parser.add_argument("--watch", type=int, default=0, metavar="N",
                        help="轮询模式:每 N 秒查一次按钮,找到就点(默认: 0=不轮询,跑一次就退)")
    args = parser.parse_args()

    print("=" * 60)
    if args.watch > 0:
        mode = f"WATCH({args.watch}s)轮询"
    elif args.dry_run:
        mode = "DRY-RUN"
    elif args.probe:
        mode = "PROBE"
    else:
        mode = "完整(会真实点击)"
    cd_text = f"{args.cooldown}s" if args.cooldown > 0 else "无"
    print(f"🛵  CDP PoC: 淘宝闪购 - 找按钮 + 真实点击 [{mode}]")
    print(f"     按钮文案: {args.text!r} | 冷却: {cd_text}")
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

        # Step 2.x: probe 模式 —— 列出所有可能按钮的元素
        if args.probe:
            print(f"\n[PROBE] 列出 iframe 内可见元素 ...")
            items = probe_all_clickables_in_iframe(cdp, frame_id, max_items=200)
            if not items:
                print("  ❌ 没找到任何带文字的可见元素(可能 iframe 内容为空)")
            else:
                print(f"  ✅ 找到 {len(items)} 个:")
                for i, it in enumerate(items):
                    print(f"  [{i:3d}] ({it['x']:4d},{it['y']:4d}) "
                          f"<{it['tag']:6s}> {it['text']!r} bg={it['bg']}")
            return 0

        # Step 3: 查按钮(轮询模式 --watch N 时每 N 秒查一次,找到就点)
        print(f"\n[3/6] 查找按钮「{args.text}」 ...")
        if args.watch > 0:
            print(f"  ⏰ 轮询模式: 每 {args.watch} 秒查一次,Ctrl+C 停止")
            attempt = 0
            btn = None
            while True:
                attempt += 1
                btn = query_button_in_iframe(cdp, frame_id, args.text)
                if btn and btn.get("found"):
                    print(f"  ✅ 第 {attempt} 次查到了!")
                    break
                print(f"  ⏳ 第 {attempt} 次未找到,等 {args.watch} 秒 ...", end="\r")
                time.sleep(args.watch)
                # 重新查 frame_id(订单切换/页面刷新时 frame_id 会变)
                if attempt % 5 == 0:
                    new_fid = find_iframe_frame(cdp)
                    if new_fid and new_fid != frame_id:
                        print(f"\n  🔄 frameId 变化: {frame_id} → {new_fid}")
                        frame_id = new_fid
        else:
            btn = query_button_in_iframe(cdp, frame_id, args.text)

        if not btn or not btn.get("found"):
            if btn and btn.get("matches"):
                print(f"  ❌ 找到 {len(btn['matches'])} 个匹配「{args.text}」的元素,但选择器逻辑没有唯一命中")
                for i, m in enumerate(btn["matches"][:5]):
                    print(f"     [{i}] {m['tag']}.{m['cls']} 文案={m['text']!r} 坐标=({m['x']:.0f},{m['y']:.0f})")
            else:
                print(f"  ❌ 当前没有「{args.text}」按钮(可能是已出餐/还没新订单)")
            print("  💡 用法: python3 cdp_poc.py --text \"出餐\" 查其他文案")
            print("  💡 用法: python3 cdp_poc.py --text \"出餐\" --dry-run 只查不点")
            print("  💡 用法: python3 cdp_poc.py --watch 3  轮询模式,找到就点")
            return 1

        print(f"  ✅ 找到按钮:")
        print(f"     文案: {btn['text']}")
        print(f"     标签: <{btn['tag']} class=\"{btn['cls']}\">")
        print(f"     中心坐标: ({btn['x']:.1f}, {btn['y']:.1f})")
        print(f"     尺寸: {btn['w']:.0f} × {btn['h']:.0f}")

        # DRY-RUN: 到此为止,只验证查询逻辑,不进入冷却/点击
        if args.dry_run:
            print("\n🏁 DRY-RUN 完成:按钮已找到,未点击(无副作用)")
            return 0

        # Step 4: 冷却(可选)
        if args.cooldown > 0:
            print(f"\n[4/6] 出餐前冷却 {args.cooldown} 秒 ...")
            print("  (避免出餐速度异常触发风控/订单系统告警)")
            for remaining in range(args.cooldown, 0, -5):
                print(f"  ⏳ 剩余 {remaining} 秒 ...", end="\r")
                time.sleep(5)
            print(f"  ✅ 冷却完毕{'':30s}")
        else:
            print(f"\n[4/6] 跳过冷却(直接点)")

        # 最后再查一次按钮(订单可能在冷却期间被骑手/系统处理掉)
        if args.cooldown > 0:
            print("\n[最后检查] 重新确认按钮仍在 ...")
            btn2 = query_button_in_iframe(cdp, frame_id, args.text)
            if not btn2 or not btn2.get("found"):
                print("  ⚠️  按钮已消失(订单可能已出餐/取消),不再点击")
                return 1
            if abs(btn2["x"] - btn["x"]) > 50 or abs(btn2["y"] - btn["y"]) > 50:
                print(f"  ⚠️  按钮位置已变化(原 ({btn['x']:.0f},{btn['y']:.0f}) → 现 ({btn2['x']:.0f},{btn2['y']:.0f}))")
                print("  💡 为安全起见,使用新坐标")
                btn = btn2
            print(f"  ✅ 按钮仍在,坐标 ({btn['x']:.1f}, {btn['y']:.1f})")

        # Step 5: 真实点击「上报出餐」
        # 关键:按钮坐标是 iframe viewport 内坐标,Input.dispatchMouseEvent 用 page 坐标
        # 要加 iframe 在主 page 里的 offset
        print("\n[5/6] 点击「上报出餐」...")
        iframe_offset = get_iframe_offset(cdp, frame_id)
        if iframe_offset:
            page_x = btn["x"] + iframe_offset["x"]
            page_y = btn["y"] + iframe_offset["y"]
            print(f"  📐 iframe 偏移: ({iframe_offset['x']}, {iframe_offset['y']})")
            print(f"  🎯 真实点击坐标: ({btn['x']:.0f}, {btn['y']:.0f}) → page ({page_x:.0f}, {page_y:.0f})")
        else:
            page_x, page_y = btn["x"], btn["y"]
            print(f"  ⚠️  无法获取 iframe 偏移,使用 iframe 坐标 ({page_x:.0f}, {page_y:.0f})")
        dispatch_mouse(cdp, page_x, page_y)

        # Step 6: 等二次确认弹窗,点「真实上报」
        print("\n[6/6] 等待二次确认弹窗 ...")
        confirm_btn = None
        for i in range(10):  # 最多等 3 秒(10×0.3s)
            time.sleep(0.3)
            # 「真实上报」是确认按钮,「稍后上报」是取消
            confirm_btn = query_button_in_iframe(cdp, frame_id, "真实上报")
            if confirm_btn and confirm_btn.get("found"):
                print(f"  ✅ 第 {i+1} 次查到「真实上报」按钮 ({confirm_btn['x']:.0f}, {confirm_btn['y']:.0f})")
                break
            print(f"  ⏳ 等待弹窗 ... ({i+1}/10)", end="\r")

        if confirm_btn and confirm_btn.get("found"):
            if iframe_offset:
                page_x2 = confirm_btn["x"] + iframe_offset["x"]
                page_y2 = confirm_btn["y"] + iframe_offset["y"]
            else:
                page_x2, page_y2 = confirm_btn["x"], confirm_btn["y"]
            print(f"  🎯 点击「真实上报」page ({page_x2:.0f}, {page_y2:.0f})")
            time.sleep(random.uniform(0.3, 0.6))  # 稍微等一下让人看到弹窗
            dispatch_mouse(cdp, page_x2, page_y2)
            print("  ✅ 已点击「真实上报」")
        else:
            print("  ⚠️  未检测到二次确认弹窗(可能无需确认或弹窗已关闭)")

        # 验证
        print("\n[验证] 等待 3 秒让 UI 更新 ...")
        time.sleep(3)

        if check_captcha(cdp):
            print("  🚨 检测到风控弹窗(滑动/验证/captcha)")
            print("  💡 CDP 方案可能也走不通,需要看霸下是否检测到自动化")
            return 2

        # 再查按钮是否消失
        btn3 = query_button_in_iframe(cdp, frame_id, args.text)
        if not btn3 or not btn3.get("found"):
            print("  ✅ 按钮已消失 → 订单已出餐,PoC 成功")
            return 0
        else:
            print("  ⚠️  按钮仍存在(可能出餐未成功)")
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
