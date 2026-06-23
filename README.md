# 外卖智能助手

Monorepo 包含两个子项目，共享同一个 Supabase 数据库。

## takeout/ — 外卖自动出餐助手

美团 + 淘宝闪购自动点击"出餐完成"按钮。

- **美团**: Bookmarklet JS 注入，DOM 提取 + 直接 click + 语音播报 + 云端同步
- **淘宝闪购**: Chrome Extension + chrome.debugger (CDP)，`Input.dispatchMouseEvent` 真实鼠标事件

详见 [takeout/CLAUDE.md](takeout/CLAUDE.md)

## ops/ — 外卖运营助手

运营数据分析仪表盘，使用 Chart.js + Supabase。

- 营收仪表盘（瀑布图）
- 菜品管理 (CRUD)
- 成本追踪（运营成本 + 固定成本）
- 用户/订单/商品分析
- AI 运营报告

详见 [ops/需求.md](ops/需求.md)

