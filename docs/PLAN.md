# 美团外卖自动点出餐助手 — 技术方案与实施计划

> 创建日期：2026/06/05
> 最近更新：2026/06/07
> 角色定位：用户是产品经理/需求方，我是开发者。Chrome DevTools MCP 是我的开发工具之一（类似 IDE/调试器），用于调研和原型验证，不是最终产品的技术方案。我会根据需要使用各种工具（网页搜索、浏览器控制、代码分析等），不限于 MCP。
> 目标：开发一个自动化美团外卖商家版出餐操作的产品，缓解商家出餐压力

---

## 一、项目概述

### 1.1 项目目标
开发一个自动化助手，在美团外卖商家版网页端：
- 自动监听新订单
- 提取订单关键信息
- 在规定时间内自动点击「出餐」按钮
- 全程自动化，仅在登录/验证时需要用户介入

### 1.2 产品形态（待讨论确认）

当前处于调研阶段，最终产品形态未定，候选方案：

| 方案 | 描述 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|----------|
| A. Chrome 插件 | 以浏览器扩展形式运行 | 安装简单，权限可控 | 依赖 Chrome，可能被检测 | 个人商家 |
| B. 桌面软件 | Electron 等独立应用 | 功能完整，独立运行 | 体积大，需安装 | 连锁商家 |
| C. 浏览器脚本 | Tampermonkey 用户脚本 | 轻量，易更新 | 功能受限，稳定性差 | 技术用户 |
| D. 服务端脚本 | Node.js/Python 独立运行 | 可后台运行，可集成通知 | 需额外环境 | 有服务器的用户 |

**当前阶段**：用 Chrome MCP 做技术调研和原型验证，收集美团商家版页面结构信息，为产品选型提供依据。

### 1.3 技术架构（开发阶段）

```
开发阶段（当前）：
┌─────────────────────────────────────────────────────────────┐
│                    开发者（我）                             │
├─────────────────────────────────────────────────────────────┤
│  Chrome DevTools MCP  ←  我的开发/调试工具                  │
│       ↓                                                     │
│  控制浏览器 → 分析美团页面 → 提取结构化数据 → 验证可行性     │
└─────────────────────────────────────────────────────────────┘
                              ↓
                    调研结果 & 原型代码
                              ↓
产品阶段（后续）：
┌─────────────────────────────────────────────────────────────┐
│  最终产品（插件/软件/脚本 — 待确定）                        │
│       ↓                                                     │
│  自动监听 → 订单解析 → 定时策略 → 自动出餐 → 状态反馈        │
└─────────────────────────────────────────────────────────────┘
```

### 1.4 核心技术栈

**开发阶段（当前）**：

| 层面 | 技术 | 说明 |
|------|------|------|
| 开发/调试工具 | Chrome DevTools MCP | 浏览器控制、页面分析 |
| 信息获取 | WebSearch / WebFetch | 搜索技术方案、参考项目 |
| 调研手段 | snapshot、evaluate_script | 获取页面结构化数据 |
| 脚本语言 | JavaScript / Node.js / Python | 根据场景灵活选择 |
| 代码分析 | Read / Edit / Write | 代码编写和修改 |

> **注意**：以上工具均为开发阶段的辅助手段，不限定最终产品的技术栈。我会根据调研结果和讨论确定最优方案。

**产品阶段（后续，待定）**：

| 层面 | 候选技术 | 说明 |
|------|----------|------|
| 产品形态 | Chrome Extension / Electron / Tampermonkey | 待评估确定 |
| 浏览器控制 | Chrome Extension API / Puppeteer / CDP | 根据产品形态选择 |
| 定时调度 | setTimeout / cron / 系统定时任务 | 根据产品形态选择 |

---

## 二、分步实施计划（TodoList）

> **说明**：以下步骤均为**开发调研阶段**的工作，目的是用各种工具摸清美团商家版的技术细节，为产品化积累信息。每一步完成后会更新到「调研成果」中，供后续产品选型参考。
>
> **工具使用原则**：我会根据任务需要灵活使用各种工具（Chrome MCP、网页搜索、代码分析等），不局限于单一工具。

### ✅ Step 0: 环境准备与验证
- [x] 确认 Chrome DevTools MCP 可用（作为开发工具）
- [x] 验证浏览器连接、页面导航、元素定位等基础能力

#### 验证方法与结果

**验证时间**：2026/06/05

**验证步骤**：
1. `list_pages` - 列出浏览器页面，验证浏览器连接
2. `navigate_page` - 导航到百度首页，验证页面导航能力
3. `take_snapshot` - 获取页面快照，验证结构化数据获取
4. `fill` - 在搜索框输入内容，验证表单填充
5. `click` - 点击搜索按钮，验证元素点击

**验证结果**：

| 能力 | 工具 | 状态 | 说明 |
|------|------|------|------|
| 浏览器连接 | `list_pages` | ✅ 成功 | 成功连接到 Chrome 浏览器 |
| 页面导航 | `navigate_page` | ✅ 成功 | 成功导航到百度首页 |
| 页面快照 | `take_snapshot` | ✅ 成功 | 成功获取页面结构化数据（基于 Accessibility Tree） |
| 元素定位 | snapshot uid | ✅ 成功 | 通过 uid 定位元素（如 uid=1_26 定位搜索框） |
| 表单填充 | `fill` | ✅ 成功 | 成功在搜索框输入"美团外卖商家版" |
| 按钮点击 | `click` | ✅ 成功 | 成功点击搜索按钮并跳转 |

**注意事项**：
- 搜索跳转后触发了百度的滑块验证码，这是百度的反爬机制
- 后续在美团商家版也可能遇到类似验证，需要人工介入处理

---

### ✅ Step 0.5: page-agent 代码集成
- [x] 从 page-agent 移植核心 DOM 提取代码到 `/src/domExtractor.js`

---

### ✅ Step 0.6: Bookmarklet 工具开发与调试

**目标**：开发浏览器书签工具（Bookmarklet），让用户可以在任意网页一键提取 DOM 结构化数据

**开发历程与关键决策**：

#### 问题 1：拖拽到书签栏后点击会打开页面而非执行脚本

**根因分析**：
- 原始实现将全部 JS 代码（2252字符）内联到 `href="javascript:..."` 中
- `onclick="alert(...)"` 在拖拽过程中会触发弹窗，干扰拖拽行为
- 参考 page-agent 项目，其 bookmarklet 用的是 `onclick="return false;"`

**修复**：`onclick` 从 `alert(...)` 改为 `return false;`

#### 问题 2：Loader 模式被 CSP 拦截

**尝试**：将书签改为 loader 模式（和 page-agent 一样），`href` 里只放一个短小的 loader 脚本动态加载外部 JS

**结果**：在部分网站（如 GitHub）因 Content Security Policy (CSP) 限制而被拦截：
```
Refused to load the script 'https://luyuhua.github.io/waimai/src/domExtractor.loader.js?t=...'
because it violates the following Content Security Policy directive: "script-src github.githubassets.com"
```

**CSP 限制对比**：

| 方式 | CSP 绕过 | 说明 |
|------|----------|------|
| `javascript:` 内联代码 | ✅ 不受 CSP 限制 | 书签的 `javascript:` URL 被浏览器当做"导航"，不触发 CSP |
| `<script src="外部URL">` | ❌ 受 CSP 限制 | 动态创建的 `<script>` 标签受页面 CSP 约束 |

**结论**：page-agent 用 loader 模式是因为其代码太长（完整框架），无法内联到 `javascript:` URL（浏览器 ~2000-4000 字符限制）。而我们的 DOM 提取工具精简版约 2500 字符，可以内联。

**最终方案**：保持内联模式（`javascript:` URL 包含完整代码），同时 `onclick="return false;"` 确保拖拽正常工作。

**状态**：✅ 基本功能可用（点击书签可执行），拖拽功能待用户确认

---

### ⏳ Step 1: 验证 Chrome MCP 基础能力（百度结构化数据获取）

**目标**：验证 MCP 工具链能否正常获取网页结构化数据（开发工具验证）

**验证内容**：
1. 打开百度首页
2. 获取页面 snapshot（结构化树）
3. 在搜索框输入内容并搜索
4. 提取搜索结果的结构化信息

**预期产出**：
- 确认 `take_snapshot`、`fill`、`click`、`evaluate_script` 等工具可用
- 理解 snapshot 的数据格式和元素定位方式
- **调研成果**：掌握通过 MCP 获取任意网页结构化数据的方法

**参考项目**：
- [page-agent](https://github.com/alibaba/page-agent) — 阿里开源的网页结构化数据获取方案

**状态**：✅ 已完成（Step 0 中已验证）

---

### ⏳ Step 2: 美团商家版登录与页面访问

**目标**：成功进入美团外卖商家版后台，了解页面基本结构

**步骤**：
1. 导航到美团外卖商家版网页端（`https://waimaie.meituan.com/`）
2. 处理登录流程（需要用户介入扫码/验证码）
3. 进入「订单管理」页面
4. 获取页面 snapshot，了解页面结构

**预期产出**：
- 确认能稳定访问商家后台
- 获取页面 DOM 结构快照
- **调研成果**：美团商家版页面结构概览、关键模块分布

**用户介入点**：
- 登录扫码/验证码验证

**状态**：⏳ 待执行

---

### ⏳ Step 3: 美团订单页面结构化数据提取

**目标**：理解并提取订单相关的结构化数据

**步骤**：
1. 在有新订单的状态下获取 snapshot
2. 分析订单列表的 DOM 结构：
   - 订单号
   - 菜品信息
   - 金额
   - 订单状态
   - 下单时间
3. 定位「出餐」按钮的 selector
4. 硬编码关键元素的定位方式（xpath 或 css selector）

**预期产出**：
- 订单数据解析原型代码
- 出餐按钮定位器
- **调研成果**：美团订单数据结构文档、关键元素 selector 清单

**状态**：⏳ 待执行

---

### ⏳ Step 4: 新订单监听机制调研

**目标**：调研并验证自动检测新订单的可行方案

**方案对比**：

| 方案 | 原理 | 优点 | 缺点 | 产品化可行性 |
|------|------|------|------|-------------|
| A. 轮询 snapshot | 定时获取页面，对比订单变化 | 简单稳定 | 频率受限，实时性一般 | 高 |
| B. 监听网络请求 | 通过 CDP 监听 WebSocket/XHR | 实时性高 | 需要分析美团 API，可能加密 | 中 |
| C. 监听 DOM 变化 | 注入 JS 监听特定节点变化 | 实时性好 | 可能被检测 | 中 |
| D. WebSocket 直连 | 分析美团 WS 协议，直接连接 | 最实时 | 协议可能加密/变化 | 低 |

**推荐策略**：
- 第一阶段：实现方案 A（轮询），保证基础可用性
- 第二阶段：尝试方案 B 或 C，提升实时性

**预期产出**：
- 新订单检测原型代码
- **调研成果**：各方案可行性评估报告、推荐产品化方案

**状态**：⏳ 待执行

---

### ⏳ Step 5: 自动点击出餐原型验证

**目标**：验证自动点击出餐的可行性

**步骤**：
1. 根据 Step 3 的定位器找到出餐按钮
2. 实现点击逻辑（处理按钮可能不在视口、被覆盖等情况）
3. 验证点击后订单状态变化
4. 处理点击后的确认弹窗（如有）

**预期产出**：
- 出餐点击原型代码
- **调研成果**：点击出餐的完整流程文档、异常场景清单

**状态**：⏳ 待执行

---

### ⏳ Step 6: 定时出餐策略原型

**目标**：验证定时出餐策略的可行性

**策略设计**：
```
订单到达 → 记录时间戳 → 倒计时 → 时间到 → 点击出餐
              ↓
         可配置：立即出餐 / 延迟 N 秒出餐 / 按菜品类型设置不同时间
```

**配置项**：
- `delaySeconds`: 延迟出餐时间（默认 0，即立即出餐）
- `strategy`: 出餐策略类型（immediate / fixed / adaptive）

**预期产出**：
- 定时调度原型代码
- **调研成果**：定时策略实现方案、配置化设计建议

**状态**：⏳ 待执行

---

### ⏳ Step 7: 异常处理与稳定性调研

**目标**：评估并验证各种异常场景的处理方案

**调研场景**：
- [ ] 页面刷新/掉线 → 自动重连方案
- [ ] 登录过期 → 检测与提示方案
- [ ] 出餐按钮找不到 → 重试或报警方案
- [ ] 美团反爬检测 → 模拟人类行为方案

**预期产出**：
- 异常处理原型代码
- **调研成果**：异常场景清单及应对方案、产品化稳定性建议

**状态**：⏳ 待执行

---

### ⏳ Step 8: 产品选型与方案确定

**目标**：基于前面 7 步的调研成果，确定最终产品形态

**讨论内容**：
1. 产品形态选择（Chrome 插件 / 桌面软件 / 浏览器脚本 / 其他）
2. 技术方案确定
3. 开发计划制定
4. 部署方式确定

**预期产出**：
- 产品选型决策文档
- 技术架构设计文档
- 开发排期计划

**状态**：⏳ 待执行（需用户参与决策）

---

## 三、调研成果（每步完成后更新）

> 记录每一步调研的关键发现，为最终产品选型提供依据。

### 3.1 结构化数据获取方式对比

> **重要**：产品阶段需要独立的 JS 能力，不能依赖 Chrome DevTools MCP。因此我们已将 page-agent 的核心 DOM 提取代码集成到项目中。

#### 项目代码集成

**代码文件**：

| 文件 | 用途 | 说明 |
|------|------|------|
| `src/domExtractor.js` | 核心版 | 完整的 DOM 提取器（从 page-agent 移植），用于控制台/插件 |
| `src/domExtractor.bookmarklet.js` | 书签版 | 带高亮、结果打印的完整版，用于浏览器书签 |
| `src/domExtractor.console.js` | 控制台版 | 不带高亮的精简版，用于控制台直接粘贴 |
| `src/domExtractor.inline.js` | 内联版 | 极度精简版，用于嵌入 `javascript:` URL |
| `src/domExtractor.loader.js` | 加载器 | 短小的 loader 脚本，用于书签动态加载外部 JS（因 CSP 限制，实际未使用） |
| `src/example.js` | 使用示例 | API 使用示例和辅助函数 |

**来源**：
- [page-agent/packages/page-controller/src/dom/dom_tree/index.js](https://github.com/alibaba/page-agent/blob/main/packages/page-controller/src/dom/dom_tree/index.js)
- 原始来源：[browser-use](https://github.com/browser-use/browser-use)

**部署文件**：
- `docs/index.html` — 书签工具首页（GitHub Pages）

---

#### Chrome DevTools MCP 的 `take_snapshot` 方式（仅调研阶段使用）

**数据格式**：基于 **Accessibility Tree**（无障碍树）的文本表示

**示例输出**（百度首页部分）：
```
uid=1_0 RootWebArea "百度一下，你就知道" url="https://www.baidu.com/"
  uid=1_1 link "新闻" url="http://news.baidu.com/"
    uid=1_2 StaticText "新闻"
  uid=1_3 link "hao123" url="https://www.hao123.com/?src=from_pc"
    uid=1_4 StaticText "hao123"
  ...
  uid=1_26 textbox "女子躺公园水面上 路人报警" focusable focused multiline
  uid=1_27 button "百度一下"
  ...
```

**格式特点**：
- **树形结构**：缩进表示父子关系
- **唯一标识**：`uid=1_26` 格式的元素 ID，用于后续操作（fill、click）
- **元素类型**：RootWebArea、link、textbox、button、StaticText 等
- **属性信息**：包含 url、focusable、focused 等关键属性
- **文本内容**：直接展示元素的可见文本

**优点**：
- ✅ 数据精简，只包含可交互元素和语义化元素
- ✅ 自带唯一标识（uid），无需手动计算 selector
- ✅ 结构清晰，易于 LLM 理解和处理
- ✅ 自动过滤不可见、无语义的元素

**缺点**：
- ❌ 丢失部分 DOM 细节（如 class、style 等）
- ❌ 无法获取自定义 data-* 属性

---

#### 阿里 page-agent 的 DOM 提取方式

**数据格式**：**简化 HTML**（Simplified HTML），基于 DOM 分析"高强度脱水"

**核心 API**：
```typescript
interface BrowserState {
  url: string
  title: string
  header: string   // page info + scroll position
  content: string  // simplified HTML of interactive elements
  footer: string   // scroll hint
}
```

**示例输出**（简化 HTML）：
```html
<div [0]>
  <button [1]>登录</button>
  <input [2] type="text" placeholder="搜索" />
  <a [3] href="/products">产品列表</a>
</div>
```

**格式特点**：
- **索引标记**：`[0]`、`[1]` 格式的元素索引，用于操作定位
- **HTML 风格**：保留 HTML 标签结构，熟悉感强
- **属性保留**：可选择保留特定 HTML 属性（如 role、aria-label）
- **可配置**：`includeAttributes` 支持通配符（如 `data-*`）

**优点**：
- ✅ 保留更多 HTML 语义信息
- ✅ 支持自定义属性提取
- ✅ 可集成到页面内部（内嵌式 Agent）
- ✅ 支持 Puppeteer/Playwright 等自动化框架

**缺点**：
- ❌ 输出相对冗长
- ❌ 需要额外的库依赖

---

#### 对比总结

| 维度 | Chrome MCP (`take_snapshot`) | page-agent (`getBrowserState`) |
|------|------------------------------|--------------------------------|
| **数据格式** | Accessibility Tree 文本 | 简化 HTML |
| **元素定位** | `uid=1_26` | `[26]` 索引 |
| **数据量** | 更精简 | 相对完整 |
| **集成方式** | 外部控制（CDP） | 内嵌或外部 |
| **适用场景** | 浏览器自动化、调试 | 网站集成、自动化 |
| **依赖** | 无需额外依赖 | 需要 page-agent 库 |

**结论**：
- **调研阶段**：使用 Chrome MCP 的 `take_snapshot` 即可满足需求
- **产品阶段**：**已集成 page-agent 的 DOM 提取代码**，可直接使用

---

### 3.2 domExtractor.js 使用说明

> 核心代码已集成到 `/src/domExtractor.js`，可独立运行在浏览器环境中。

#### 基本用法

```javascript
// 在浏览器中执行（控制台、Chrome 插件、Tampermonkey 等）

// 1. 获取页面结构化数据
const result = domExtractor({
    doHighlightElements: false,  // 是否显示高亮
    viewportExpansion: -1,        // -1 = 全页面，0 = 仅视口
    debugMode: false,            // 是否输出调试信息
});

// 2. 遍历可交互元素
for (const [id, node] of Object.entries(result.map)) {
    if (node.isInteractive && node.highlightIndex !== undefined) {
        console.log(`[${node.highlightIndex}] ${node.tagName}`, node.attributes, node.ref);
    }
}

// 3. 执行操作（通过 ref 直接操作 DOM）
for (const [id, node] of Object.entries(result.map)) {
    if (node.ref?.innerText?.includes('出餐')) {
        node.ref.click();  // 点击出餐按钮
        break;
    }
}
```

#### 返回数据结构

```javascript
{
    rootId: "0",  // 根节点 ID
    map: {
        "2": {
            tagName: "button",
            attributes: { class: "btn-primary" },
            children: ["3"],
            isVisible: true,
            isTopElement: true,
            isInteractive: true,
            highlightIndex: 0,     // 用于定位
            ref: HTMLButtonElement, // DOM 引用，可直接操作
        },
        "3": {
            type: "TEXT_NODE",
            text: "出餐",
            isVisible: true
        }
    }
}
```

#### 核心特性

| 特性 | 说明 |
|------|------|
| **DOM 引用** | 每个节点包含 `ref` 字段，直接操作 DOM |
| **交互检测** | 自动识别可交互元素（按钮、链接、输入框等） |
| **滚动检测** | 自动识别可滚动元素 |
| **视口过滤** | 支持只获取视口内的元素 |
| **高亮显示** | 可选在页面上高亮显示可交互元素 |

#### 产品化集成方式

| 产品形态 | 集成方式 |
|----------|----------|
| Chrome 插件 | 在 content-script 中导入使用 |
| Tampermonkey | 直接嵌入脚本使用 |
| Electron | 注入到 webview 中使用 |

---

### 3.3 Bookmarklet 技术方案总结

#### 最终方案：内联模式

书签的 `href` 使用 `javascript:` 协议，代码全部内联，不受 CSP 限制。

**为什么不用 Loader 模式（像 page-agent）？**

page-agent 用 loader 模式（`javascript:` 里只放 `<script src="外部URL">`），是因为它的完整代码是一个大框架，无法塞进 `javascript:` URL（浏览器限制约 2000-4000 字符）。而我们的 DOM 提取工具精简版约 2500 字符，可以内联。

但 loader 模式有一个致命问题：**动态创建的 `<script>` 标签受页面 CSP 限制**，在有严格 CSP 的网站（如 GitHub）会被拦截。内联模式则不受 CSP 限制（`javascript:` URL 被浏览器当做导航而非脚本注入）。

**关键修复记录**：

| 问题 | 原因 | 修复 |
|------|------|------|
| 拖拽到书签栏后点击打开网页 | `onclick="alert(...)"` 干扰拖拽 | 改为 `onclick="return false;"` |
| Loader 模式在 GitHub 等网站被 CSP 拦截 | `<script src=外部URL>` 受 CSP 限制 | 改回内联模式 |
| 内联代码 URL 过长（2252字符） | 早期版本代码未精简 | 使用 inline.js 精简版（~2500字符） |
| `?.` 等新语法在书签上下文不兼容 | 部分浏览器书签不支持 ES2020 语法 | inline.js 使用兼容性语法 |

---

### 3.5 美团商家版订单页面调研成果（2026/06/07）

> 以下内容基于实际订单数据验证，所有 DOM 选择器均使用 `[class*="xxx"]` 模糊匹配以应对 CSS Modules hash 变化。

#### 3.5.1 页面结构

美团商家版订单页面通过 iframe (`#hashframe`) 加载实际内容，脚本需要先检测是否在 iframe 内：

```javascript
if (window.self === window.top) {
    const iframe = document.getElementById('hashframe');
    doc = iframe.contentDocument || iframe.contentWindow.document;
}
```

#### 3.5.2 订单数据提取

每个订单是一个 `[class*="order-card"]` 卡片，从中提取以下字段：

| 字段 | 来源 | 提取方式 | 示例 |
|------|------|----------|------|
| `orderNo` | 卡片全文 | 正则 `订单编号[：:]\s*(\d+)` | `2002157953314287489` |
| `orderIndex` | 卡片全文 | 正则 `#(\d+)` | `11` |
| `orderTime` | 卡片全文 | 正则 `(\d{2}-\d{2}\s+\d{2}:\d{2})\s*下单` | `06-07 13:58` |
| `deliverTime` | 卡片全文 | 正则 `(\d{2}-\d{2}\s+\d{2}:\d{2})\s*前送达` | `06-07 14:58` |
| `customerName` | 卡片全文 | 正则 `([^\s]{1,4}(?:先生\|女士))` | `刘女士` |
| `phoneTail` | 卡片全文 | 正则 `手机尾号(\d{4})` | `3966` |
| `remark` | 卡片全文 | 正则 `备注\s*([\s\S]*?)(?=\d种商品\|$)` | `顾客需要餐具；` |
| `estimatedIncome` | 卡片全文 | 正则 `预计收入\s*￥([\d.]+)` | `55.3` |
| `products` | 卡片全文 | 正则匹配商品行 | `[{name, unitPrice, quantity, totalPrice}]` |
| `deliveryType` | 卡片全文 | `includes('美团配送')` | `meituan` |
| `riderName` | 卡片全文 | 正则 `([一-龥]{2,4})\s*\n\s*美团配送` | `吴磊` |
| `status` | **出餐维度**（全文匹配） | 见下表 | `pending_cook` |
| `riderStatus` | **骑手维度**（DOM 元素） | `div[class*="baseInfoRight"]` | `骑手已到店` |
| `statusText` | 合并显示 | `出餐状态 \| 骑手状态` | `待出餐 \| 骑手已到店` |
| `cookTime` | 卡片全文 | 正则 `用时(\d{2}):(\d{2})` | `06:00` |
| `suggestedCookTime` | 卡片全文 | 正则 `建议出餐时长\s*[\n\s]*(\d+)分(\d+)秒` | `11分25秒` |
| `cookRemainingTime` | **DOM 元素** | `div[class*="time-title"]` 文本为"剩余"时的父元素时间 | `09:37` |
| `buttons` | DOM 元素 | `getCardButtons(card)` 合并 `<button>` + `div[class*="submit-button"]` | 见下 |

#### 3.5.3 出餐按钮关键发现

**出餐按钮不是 `<button>`，而是 `<div>`**：

```html
<div class="submit-button_5c3f5">出餐完成</div>
```

XPath: `/html/body/div/div/div[1]/div[2]/div[5]/div[4]/div/div/div[2]/div`

因此查找按钮时必须同时查找 `<button>` 和 `div[class*="submit-button"]`：

```javascript
function getCardButtons(card) {
    var btns = Array.from(card.querySelectorAll('button'));
    var divBtns = Array.from(card.querySelectorAll('div[class*="submit-button"]'));
    return btns.concat(divBtns);
}
```

#### 3.5.4 订单状态：两个独立维度

美团订单页面有**两个独立的状态维度**：

| 维度 | 字段 | 来源 | 可能值 |
|------|------|------|--------|
| **出餐状态** | `status` | 卡片全文（正则匹配） | `pending_accept` → `pending_cook` → `cooked` |
| **骑手状态** | `riderStatus` | `div[class*="baseInfoRight"]` 原始文字 | `待分配骑手` → `骑手已到店` → `骑手已取餐` → `用户已收餐` |

**为什么不用 `baseInfoRight` 推断出餐状态？**

因为骑手和商家出餐是并行的。比如"骑手已到店"时商家可能还"待出餐"。用 `baseInfoRight` 判断会出错（如新订单时 `baseInfoRight` 显示"待分配骑手"，不匹配任何出餐状态关键词 → 返回 `unknown`）。

**`status` 枚举映射**（基于全文匹配，最可靠）：

| status 值 | 中文 | 匹配关键词 |
|-----------|------|------------|
| `pending_accept` | 待接单 | `待接单` |
| `pending_cook` | 待出餐 | `待出餐` |
| `cooked` | 已出餐 | `已出餐`、`出餐完成` |
| `delivered` | 已送达 | `已送达`、`用户已收餐` |
| `cancelled` | 已取消 | `已取消` |

**`statusText` 合并展示**：`出餐状态 | 骑手状态`，如 `待出餐 | 骑手已到店`

#### 3.5.5 出餐倒计时提取

`div[class*="time-title"]` 在不同订单状态下显示不同内容：
- **待出餐**：显示 `剩余` → 时间是出餐倒计时 ✅
- **已出餐**：显示 `用时` → 时间是已用时间，不是倒计时 ❌

因此只提取文本为"剩余"的时间：

```javascript
const timeTitleEls = card.querySelectorAll('div[class*="time-title"]');
for (const tEl of timeTitleEls) {
    if (tEl.innerText.trim() === '剩余') {
        // 取父元素的时间数字
        data.cookRemainingTime = parentEl.innerText.match(/(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1];
        break;
    }
}
```

#### 3.5.6 订单监控机制

`window.monitorOrders(intervalMs, autoCook)` 在 iframe 内定时轮询订单卡片：

- 每 5 秒检查新订单和状态变化
- 新订单或状态变为"待出餐"时输出红色警报
- 心跳日志每 30 秒输出一次状态
- `autoCook = true` 时自动点击出餐按钮（1 秒延迟）

**状态变化追踪**：使用 `window.__orderStatusMap` 记录每个订单的上一次状态，检测变化。

#### 3.5.7 自动出餐

`window.autoCookAll()` 和 `window.clickOrderButton()` 函数：

- 遍历所有待出餐订单卡片
- 在卡片中查找文字为"出餐完成"/"出餐"/"确认出餐"的按钮元素
- 点击后输出确认日志

#### 3.5.8 选择器稳定性策略

美团商家版使用 CSS Modules（带 hash 后缀），所有 class 名如 `order-card_xxx`、`submit-button_5c3f5`、`baseInfoRight_c20b8` 中的 hash 部分会变化。

**应对策略**：统一使用 `[class*="xxx"]` 模糊匹配，只匹配 class 名的前缀部分：

| 选择器 | 匹配 | 说明 |
|--------|------|------|
| `[class*="order-card"]` | ✅ | 订单卡片容器 |
| `div[class*="submit-button"]` | ✅ | 出餐按钮（div，非 button） |
| `div[class*="time-title"]` | ✅ | 出餐倒计时标签 |
| `div[class*="baseInfoRight"]` | ✅ | 骑手状态文字 |
| `button` | ✅ | 其他操作按钮 |

#### 3.5.9 待实现：顾客实付金额提取

**需求**：「顾客商品实付」旁边有个问号图标 `<i>`，鼠标悬浮会显示 tooltip 包含顾客实付金额。

**DOM 结构**（从用户提供的 XPath 和截图 OCR 推断）：
```
顾客商品实付 <div>  ← 标签文字
             <i>    ← 问号图标，hover 触发 tooltip
                    ← tooltip (class="settlement-tooltip_xxx") 包含:
                       - charge-name_9576d: 费用名
                       - charge-value_16dad: 金额（如 ¥17.07）
                       - summary_58c70: 合计
```

**技术难点**：tooltip 是 hover 触发的，鼠标离开就消失，普通 DOM 查询无法直接获取。

**候选方案**：

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| A. 触发 hover 事件 | 对 `<i>` 元素触发 `mouseenter`/`mouseover`，等待 tooltip 渲染后提取 | 简单直观 | tooltip 是异步渲染的，需 setTimeout 等待；可能影响页面状态 |
| B. 全文正则提取 | 从卡片 `innerText` 匹配金额模式 | 无需 hover | 卡片中有多个金额（预计收入、商品价等），难以区分"顾客实付" |
| C. 留到产品化阶段 | 在 Chrome 插件中用 MutationObserver 监听 tooltip 出现 | 最稳定 | 当前阶段实现成本高 |

**当前决定**：暂不实现，等后续有更多实际数据再决定方案。记录在此备查。

---

### 3.4 调研进度表

| 步骤 | 调研主题 | 关键发现 | 对产品选型的影响 |
|------|----------|----------|------------------|
| 0 | MCP 基础能力验证 | Accessibility Tree 格式精简易用 | 适合调研 |
| 0.5 | page-agent 代码集成 | domExtractor.js 已集成，可直接使用 | 产品化基础能力已具备 |
| 0.6 | Bookmarklet 工具开发 | 内联模式不受 CSP 限制，拖拽需 `onclick="return false;"` | 书签工具可用，CSP 是关键约束 |
| 1 | 百度结构化数据验证 | - | - |
| 2 | 美团商家版登录 | 页面通过 iframe 加载订单内容，需 `#hashframe` 切换 | 产品需处理 iframe 跨域 |
| 3 | 订单数据提取 | 出餐按钮是 `<div>` 非 `<button>`；状态分出餐和骑手两个维度；CSS Modules hash 需模糊匹配 | 选择器用 `[class*="xxx"]` |
| 4 | 新订单监控 | 5 秒轮询 + 状态变化追踪，`baseInfoRight` 是骑手状态不是出餐状态 | 监控逻辑已验证 |
| 5 | 自动点击出餐 | `div[class*="submit-button"]` 包含"出餐完成"文字，需 `getCardButtons()` 同时查 button 和 div | 自动出餐已可用 |

---

## 四、产品选型决策（Step 8 完成时确定）

### 4.1 候选方案

| 方案 | 描述 | 适用场景 | 选型依据 |
|------|------|----------|----------|
| A. Chrome 插件 | 以浏览器扩展形式运行 | 个人商家 | 待调研后评估 |
| B. 桌面软件 | Electron 等独立应用 | 连锁商家 | 待调研后评估 |
| C. 浏览器脚本 | Tampermonkey 用户脚本 | 技术用户 | 待调研后评估 |
| D. 服务端脚本 | Node.js/Python 独立运行 | 有服务器的用户 | 待调研后评估 |

### 4.2 决策因素

- [ ] 美团商家版页面结构复杂度
- [ ] 反爬检测强度
- [ ] 用户技术门槛
- [ ] 部署便利性
- [ ] 维护成本
- [ ] 功能完整性需求

---

## 五、项目结构

### 5.1 当前项目结构

```
waimai/
├── docs/
│   ├── index.html              # 书签工具首页（GitHub Pages 部署入口）
│   ├── PLAN.md                 # 本文件：技术方案与实施计划
│   ├── README.md               # 项目说明
│   ├── demo-screenshot.png     # 效果截图
│   └── screenshot.png          # 截图
├── src/
│   ├── domExtractor.js              # 核心：DOM 结构化数据提取器（完整版）
│   ├── domExtractor.bookmarklet.js  # 书签版：带高亮、结果打印、订单监控、自动出餐
│   ├── domExtractor.console.js      # 控制台版：不带高亮
│   ├── domExtractor.inline.js        # 内联版：极度精简，用于 javascript: URL
│   ├── domExtractor.loader.js        # 加载器：短小 loader（因 CSP 限制，未采用）
│   ├── monitorOrders.js              # 独立订单监控脚本（控制台直接粘贴用）
│   ├── orderExtractor.js             # 订单数据提取脚本
│   ├── example.js                    # 使用示例和辅助函数
│   ├── domExtractor.bookmarklet.json # bookmarklet 版元数据
│   └── domExtractor.console.json     # console 版元数据
└── page-agent/                        # 参考项目（阿里 page-agent 源码）
```

### 5.2 产品阶段（后续，根据选型确定）

```
meituan-auto-order/
├── docs/
├── src/                     # 产品源代码
├── config/
├── dist/                    # 构建产物
└── package.json
```

---

## 六、风险与注意事项

### 6.1 合规风险
- 自动操作可能违反美团商家版用户协议
- **建议**：仅用于学习研究，或在内部测试环境使用
- 生产环境使用前请确认合规性

### 6.2 反爬检测
- 频繁操作可能触发美团的风控系统
- **应对**：
  - 控制操作频率（随机间隔 1-3 秒）
  - 模拟人类行为（鼠标移动、滚动等）
  - 避免固定时间模式

### 6.3 页面结构变化
- 美团页面 DOM 结构可能更新
- **应对**：
  - 使用相对稳定的 selector（如 data-testid、aria-label）
  - 定期维护更新 selector
  - 增加容错机制（找不到元素时告警而非报错）

### 6.4 登录状态维持
- Cookie/Session 可能过期
- **应对**：
  - 检测登录状态
  - 过期时通过通知系统提醒用户重新登录

### 6.5 CSP 安全策略
- 部分网站有严格的 Content Security Policy，会拦截外部脚本加载
- **应对**：Bookmarklet 使用 `javascript:` 内联模式（不受 CSP 限制），不使用动态 `<script>` 加载
- Chrome 插件的 content-script 不受 CSP 限制，产品化时优先考虑

---

## 七、进度跟踪

| Step | 任务 | 状态 | 完成日期 | 备注 |
|------|------|------|----------|------|
| 0 | 环境准备 | ✅ | 2026/06/05 | MCP 全部能力验证通过 |
| 0.5 | page-agent 代码集成 | ✅ | 2026/06/05 | domExtractor.js 已集成 |
| 0.6 | Bookmarklet 工具开发 | ✅ | 2026/06/06 | 内联模式，CSP 兼容，拖拽修复 |
| 1 | 百度结构化数据验证 | ✅ | 2026/06/05 | 成功提取503节点/20可交互元素 |
| 2 | 美团商家版登录 | ✅ | 2026/06/06 | 用户已手动登录 |
| 3 | 订单数据提取 | ✅ | 2026/06/07 | 详见 3.5 调研成果 |
| 4 | 新订单监控 | ✅ | 2026/06/07 | 详见 3.5 订单监控 |
| 5 | 自动点击出餐 | ✅ | 2026/06/07 | 详见 3.5 出餐按钮与自动出餐 |
| 6 | 定时出餐策略 | ⏳ | - | 有 cookRemainingTime 数据，策略待实现 |
| 7 | 异常处理 | ⏳ | - | 调研阶段 |
| 8 | 产品选型决策 | ⏳ | - | 需用户参与决策 |

---

## 八、下一步行动

**当前待执行**：Step 6 — 定时出餐策略

**已有数据基础**：
- `cookRemainingTime`：出餐倒计时（如 `09:37`）
- `suggestedCookTime`：建议出餐时长（如 `11分25秒`）
- `status` + `riderStatus`：双维度状态判断

**待实现**：
1. 根据 `cookRemainingTime` 倒计时自动出餐（如剩余 0 时自动点击）
2. 或根据 `suggestedCookTime` 设置延迟出餐
3. 出餐策略配置化（立即/延迟/按菜品类型）

**暂不实现**：
- 顾客实付金额（hover tooltip 提取，需触发 `<i>` 元素的 mouseenter 事件，待产品化时用 MutationObserver 方案）

---