/**
 * @file DOM 结构化数据提取器 - 使用示例
 * @description 展示如何在浏览器中使用 domExtractor.js 获取页面结构化数据
 */

// ============================================
// 方式一：直接在浏览器控制台使用
// ============================================

/*
1. 将 domExtractor.js 的内容复制到浏览器控制台
2. 执行以下代码：

*/

// 获取页面结构化数据（不显示高亮）
const result = domExtractor({
    doHighlightElements: false,  // 不显示高亮
    viewportExpansion: -1,        // -1 表示获取整个页面
});

console.log('Root ID:', result.rootId);
console.log('DOM Map:', result.map);

// 遍历所有可交互元素
function getInteractiveElements(map) {
    const interactive = [];
    for (const [id, node] of Object.entries(map)) {
        if (node.isInteractive) {
            interactive.push({
                id,
                tagName: node.tagName,
                attributes: node.attributes,
                highlightIndex: node.highlightIndex,
                ref: node.ref,  // DOM 元素引用
            });
        }
    }
    return interactive;
}

const interactiveElements = getInteractiveElements(result.map);
console.log('可交互元素数量:', interactiveElements.length);
console.log('可交互元素:', interactiveElements);


// ============================================
// 方式二：在 Chrome 插件中使用
// ============================================

/*
// content-script.js
import domExtractor from './domExtractor.js';

// 获取页面结构
function getPageStructure() {
    return domExtractor({
        doHighlightElements: false,
        viewportExpansion: 0,  // 只获取视口内的元素
    });
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPageStructure') {
        const result = getPageStructure();
        // 注意：不能直接发送 DOM 引用，需要序列化
        const serializableResult = {
            rootId: result.rootId,
            map: Object.fromEntries(
                Object.entries(result.map).map(([id, node]) => [
                    id,
                    { ...node, ref: undefined }  // 移除 DOM 引用
                ])
            )
        };
        sendResponse(serializableResult);
    }
});
*/


// ============================================
// 方式三：在 Tampermonkey 脚本中使用
// ============================================

/*
// ==UserScript==
// @name         美团自动出餐助手
// @match        https://waimaie.meituan.com/*
// @grant        none
// ==/UserScript==

// 直接嵌入 domExtractor.js 的代码...

// 定时检测新订单
setInterval(() => {
    const result = domExtractor({
        doHighlightElements: false,
        viewportExpansion: 0,
    });

    // 查找出餐按钮
    for (const [id, node] of Object.entries(result.map)) {
        if (node.isInteractive && node.attributes) {
            // 根据按钮文本或属性识别出餐按钮
            const text = node.ref?.innerText || '';
            if (text.includes('出餐')) {
                console.log('找到出餐按钮:', node);
                // 执行点击操作
                // node.ref?.click();
            }
        }
    }
}, 5000);  // 每5秒检测一次
*/


// ============================================
// 数据结构说明
// ============================================

/*
返回的数据结构：

{
    rootId: "0",  // 根节点 ID
    map: {
        "0": {
            tagName: "body",
            attributes: {},
            children: ["1", "5", "10"],
            xpath: "/body"
        },
        "1": {
            tagName: "div",
            attributes: { class: "container", id: "main" },
            children: ["2", "3", "4"],
            isVisible: true,
            isTopElement: true,
            isInteractive: false,
            isInViewport: true
        },
        "2": {
            tagName: "button",
            attributes: { class: "btn-primary", type: "button" },
            children: ["3"],
            isVisible: true,
            isTopElement: true,
            isInteractive: true,
            isInViewport: true,
            highlightIndex: 0,  // 高亮索引，用于定位元素
            ref: HTMLButtonElement  // DOM 元素引用
        },
        "3": {
            type: "TEXT_NODE",
            text: "点击我",
            isVisible: true
        }
    }
}

关键字段说明：
- highlightIndex: 可交互元素的索引，用于定位和操作
- isInteractive: 是否为可交互元素
- ref: 直接的 DOM 元素引用，可用于执行操作（click、fill 等）
- attributes: 元素的所有属性
- extra: 额外数据（如滚动信息）
*/


// ============================================
// 查找特定元素的辅助函数
// ============================================

/**
 * 根据文本内容查找元素
 */
function findElementByText(map, text) {
    for (const [id, node] of Object.entries(map)) {
        if (node.type === 'TEXT_NODE' && node.text.includes(text)) {
            return { id, node };
        }
        if (node.ref?.innerText?.includes(text)) {
            return { id, node };
        }
    }
    return null;
}

/**
 * 根据 highlightIndex 查找元素
 */
function findElementByIndex(map, index) {
    for (const [id, node] of Object.entries(map)) {
        if (node.highlightIndex === index) {
            return { id, node };
        }
    }
    return null;
}

/**
 * 根据属性查找元素
 */
function findElementByAttribute(map, attrName, attrValue) {
    for (const [id, node] of Object.entries(map)) {
        if (node.attributes?.[attrName] === attrValue) {
            return { id, node };
        }
    }
    return null;
}

/**
 * 根据标签名和类名查找元素
 */
function findElementsByTagName(map, tagName, className = null) {
    const results = [];
    for (const [id, node] of Object.entries(map)) {
        if (node.tagName === tagName) {
            if (className) {
                if (node.attributes?.class?.includes(className)) {
                    results.push({ id, node });
                }
            } else {
                results.push({ id, node });
            }
        }
    }
    return results;
}


export { getInteractiveElements, findElementByText, findElementByIndex, findElementByAttribute, findElementsByTagName };
