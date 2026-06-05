# 美团外卖自动出餐助手 - DOM 提取工具使用说明

## 📦 文件说明

| 文件 | 用途 | 使用方式 |
|------|------|----------|
| `domExtractor.js` | ES Module 版本 | Chrome 插件、Node.js 项目 |
| `domExtractor.console.js` | Console 版本 | 直接复制到浏览器控制台 |
| `domExtractor.bookmarklet.js` | Bookmarklet 版本 | 作为书签使用 |

## 🚀 快速开始

### 方式一：直接复制到控制台（推荐）

1. 打开目标网页（如美团商家版）
2. 按 `F12` 打开开发者工具
3. 在 Console 中输入 `allow pasting` 并按 Enter
4. 复制 `domExtractor.console.js` 的全部内容到控制台执行
5. 查看输出的结构化数据

### 方式二：使用书签（更方便）

1. 打开 `docs/index.html` 页面
2. 将「提取页面结构」按钮拖拽到浏览器书签栏
3. 在任意网页点击书签，自动打印结果到控制台

### 方式三：Chrome DevTools MCP（调试用）

我可以通过 MCP 直接在浏览器中注入脚本：

```javascript
// 执行提取
const result = domExtractor({ viewportExpansion: -1 });

// 查看可交互元素
console.table(getInteractiveElements(result.map));
```

## 📊 输出示例

```
📊 总节点: 503, 可交互: 20

| 索引 | 标签 | 文本       |
|------|------|------------|
| 0    | a    | 新闻       |
| 1    | a    | hao123     |
| 2    | a    | 地图       |
| ...  | ...  | ...        |
```

## 💡 使用示例

```javascript
// 获取结果
const result = window.__domResult;
const interactive = window.__interactiveElements;

// 点击第 0 个元素
interactive[0].ref.click();

// 查找包含"出餐"文本的元素
const btn = findElementByText(result.map, '出餐');
if (btn) btn.ref.click();

// 根据索引操作
findElementByIndex(result.map, 5).ref.click();

// 清除页面高亮
clearHighlights();
```

## 🔧 配置参数

```javascript
domExtractor({
    viewportExpansion: -1,    // -1=全页面，0=仅视口
    doHighlightElements: true, // 是否显示高亮
    debugMode: false,          // 调试模式
});
```

## 📁 项目结构

```
waimai/
├── docs/
│   ├── PLAN.md              # 技术方案
│   └── index.html           # 书签工具页面
├── src/
│   ├── domExtractor.js      # ES Module 版本
│   ├── domExtractor.console.js      # Console 版本
│   └ domExtractor.bookmarklet.js    # Bookmarklet 版本
│   └── example.js           # 使用示例
└── claude.txt               # 项目需求
```

## 🎯 下一步

1. **Step 2**: 访问美团商家版页面，测试 DOM 提取
2. **Step 3**: 识别「出餐」按钮的特征
3. **Step 4**: 实现新订单监听机制
5. **Step 5**: 实现自动点击出餐功能

---

**更新日期**: 2026/06/05