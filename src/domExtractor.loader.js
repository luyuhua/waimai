/**
 * @file DOM 提取工具 Loader - 用于书签动态加载
 * @description 此文件部署到 CDN，书签通过 javascript: 协议动态加载此脚本
 */

(function() {
    'use strict';

    console.log('%c🛵 美团外卖自动出餐助手 - DOM 提取工具', 'color: #667eea; font-size: 20px; font-weight: bold;');
    console.log('%c基于 page-agent 开源项目', 'color: #888; font-size: 12px;');

    // 防止重复执行
    if (window.__domExtractorLoaded) {
        console.log('🔄 重新执行提取...');
        const result = window.domExtractor({ viewportExpansion: -1 });
        window.printResults(result);
        return;
    }
    window.__domExtractorLoaded = true;

    // ==================== 核心 DOM 提取 ====================

    window.domExtractor = function(args = {}) {
        const viewportExpansion = args.viewportExpansion ?? -1;
        const doHighlight = args.doHighlightElements ?? true;

        let highlightIndex = 0;
        const DOM_HASH_MAP = {};
        const ID = { current: 0 };
        const HIGHLIGHT_ID = 'dom-extractor-highlight';

        // 清除旧高亮
        document.getElementById(HIGHLIGHT_ID)?.remove();

        function highlightElement(el, index) {
            if (!el || !doHighlight) return;

            let container = document.getElementById(HIGHLIGHT_ID);
            if (!container) {
                container = document.createElement('div');
                container.id = HIGHLIGHT_ID;
                container.style.cssText = 'position:fixed;pointerEvents:none;top:0;left:0;width:100%;height:100%;zIndex:2147483640';
                document.body.appendChild(container);
            }

            const rects = el.getClientRects();
            if (!rects.length) return;

            const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFA500', '#800080', '#008080', '#FF69B4', '#4B0082', '#FF4500', '#2E8B57'];
            const color = colors[index % colors.length];

            for (const rect of rects) {
                if (rect.width === 0 || rect.height === 0) continue;
                const div = document.createElement('div');
                div.style.cssText = `position:fixed;border:2px solid ${color};background:${color}1a;pointerEvents:none;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px`;
                container.appendChild(div);
            }

            const label = document.createElement('div');
            label.style.cssText = `position:fixed;background:${color};color:white;padding:2px 6px;borderRadius:4px;fontSize:12px;top:${rects[0].top + 2}px;left:${rects[0].left + rects[0].width - 30}px`;
            label.textContent = index;
            container.appendChild(label);
        }

        function isInteractive(el) {
            const tag = el.tagName.toLowerCase();
            const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'details', 'summary', 'label'];
            if (interactiveTags.includes(tag) && !el.disabled && !el.readOnly) return true;

            const style = getComputedStyle(el);
            if (['pointer', 'move', 'grab'].includes(style.cursor)) return true;

            if (el.hasAttribute('onclick') || el.isContentEditable) return true;

            // 滚动检测
            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return true;

            return false;
        }

        function isVisible(el) {
            const style = getComputedStyle(el);
            return el.offsetWidth > 0 && el.offsetHeight > 0 &&
                   style.display !== 'none' && style.visibility !== 'hidden';
        }

        function isTop(el) {
            const rects = el.getClientRects();
            const rect = Array.from(rects).find(r => r.width > 0 && r.height > 0);
            if (!rect) return false;

            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const top = document.elementFromPoint(x, y);

            let cur = top;
            while (cur) {
                if (cur === el) return true;
                cur = cur.parentElement;
            }
            return false;
        }

        function buildTree(node, parentHighlighted = false) {
            if (!node || node.id === HIGHLIGHT_ID) return null;

            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent?.trim();
                if (!text || text.length < 2) return null;
                const id = String(ID.current++);
                DOM_HASH_MAP[id] = { type: 'TEXT_NODE', text };
                return id;
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return null;

            const tag = node.tagName.toLowerCase();
            const deny = ['svg', 'script', 'style', 'link', 'meta', 'noscript', 'template'];
            if (deny.includes(tag)) return null;

            const nodeData = {
                tagName: tag,
                attributes: {},
                children: [],
                ref: node
            };

            // 收集属性
            const attrNames = node.getAttributeNames?.() || [];
            for (const name of attrNames.slice(0, 5)) {
                nodeData.attributes[name] = node.getAttribute(name);
            }

            // 检查交互性
            const visible = isVisible(node);
            const topEl = viewportExpansion === -1 || top(node);

            if (visible && topEl) {
                nodeData.isVisible = true;
                nodeData.isInteractive = isInteractive(node);

                // 判断是否应该高亮（避免嵌套的交互元素）
                const shouldHighlight = nodeData.isInteractive && (!parentHighlighted ||
                    ['a', 'button', 'input', 'select', 'textarea'].includes(tag));

                if (shouldHighlight) {
                    nodeData.highlightIndex = highlightIndex;
                    highlightElement(node, highlightIndex);
                    highlightIndex++;
                }
            }

            // 处理子节点
            const isHighlighted = nodeData.highlightIndex !== undefined;
            for (const child of node.childNodes) {
                const cid = buildTree(child, parentHighlighted || isHighlighted);
                if (cid) nodeData.children.push(cid);
            }

            const id = String(ID.current++);
            DOM_HASH_MAP[id] = nodeData;
            return id;
        }

        buildTree(document.body);
        return { map: DOM_HASH_MAP };
    };

    // ==================== 辅助函数 ====================

    window.getInteractiveElements = function(map) {
        const items = [];
        for (const [id, node] of Object.entries(map)) {
            if (node.isInteractive && node.highlightIndex !== undefined) {
                items.push({
                    index: node.highlightIndex,
                    tagName: node.tagName,
                    text: (node.ref?.innerText?.trim() || '').slice(0, 50),
                    className: node.attributes?.class || '-',
                    id: node.attributes?.id || '-',
                    ref: node.ref
                });
            }
        }
        return items.sort((a, b) => a.index - b.index);
    };

    window.findElementByText = function(map, text) {
        for (const [, node] of Object.entries(map)) {
            if (node.ref?.innerText?.includes(text)) return node;
        }
        return null;
    };

    window.findElementByIndex = function(map, index) {
        for (const [, node] of Object.entries(map)) {
            if (node.highlightIndex === index) return node;
        }
        return null;
    };

    window.clearHighlights = function() {
        document.getElementById('dom-extractor-highlight')?.remove();
    };

    // ==================== 结果打印 ====================

    window.printResults = function(result) {
        const interactive = getInteractiveElements(result.map);

        console.log('');
        console.log('%c📊 提取结果', 'color: #667eea; font-size: 16px; font-weight: bold;');
        console.log('%c────────────────────────────────────', 'color: #ddd;');
        console.log(`  📄 总节点数: ${Object.keys(result.map).length}`);
        console.log(`  🎯 可交互元素: ${interactive.length}`);
        console.log('');

        if (interactive.length > 0) {
            console.log('%c🎯 可交互元素列表:', 'color: #667eea; font-weight: bold;');
            console.table(interactive.map(i => ({
                '索引': i.index,
                '标签': i.tagName,
                '文本': i.text || '(无)',
                'class': i.className,
                'id': i.id
            })));

            console.log('');
            console.log('%c💡 使用示例:', 'color: #667eea; font-weight: bold;');
            console.log('%c// 点击元素', 'color: #888;');
            console.log(`findElementByText(__domResult.map, '出餐')?.ref?.click();`);
            console.log(`findElementByIndex(__domResult.map, 0)?.ref?.click();`);
            console.log('%c// 清除高亮', 'color: #888;');
            console.log(`clearHighlights();`);
        }

        window.__domResult = result;
        window.__interactiveElements = interactive;

        console.log('');
        console.log('%c💾 数据已保存:', 'color: #667eea;');
        console.log('  window.__domResult');
        console.log('  window.__interactiveElements');
    };

    // ==================== 自动执行 ====================

    const result = domExtractor({ viewportExpansion: -1 });
    printResults(result);

})();