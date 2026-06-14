/**
 * @file 美团外卖自动出餐助手 V1 - Bookmarklet Loader
 * @description 按顺序链式加载两个相互独立的脚本:
 *              先加载页面分析器(pageAnalyzer.js),
 *              再加载主书签脚本(domExtractor.bookmarklet.js)。
 *
 *              加载链路:
 *                ① pageAnalyzer.js             — 页面分析工具(独立,自带首次执行)
 *                ② domExtractor.bookmarklet.js — 美团自动出餐业务(独立,不引用 pageAnalyzer)
 *
 *              两个脚本无相互依赖,loader 只保证 pageAnalyzer 先加载
 *              (这样 pageAnalyzer 的 console 输出会先出现)。
 *
 *              书签的 href 只放短小的 loader 代码,便于部署到 GitHub Pages。
 *
 * @usage 书签 javascript:
 *   javascript:(function(){var s=document.createElement('script');s.src='https://luyuhua.github.io/waimai/src/domExtractor.loader.js?t='+Date.now();document.body.appendChild(s);})()
 */

(function () {
    'use strict';

    var CDN_BASE = 'https://luyuhua.github.io/waimai/src/';
    var cacheBust = '?t=' + Date.now();

    // 停止之前的实例（如果主脚本有 stop 接口）
    // 这里只是占位 — 实际 stop 在主脚本里实现

    // 加载第二个脚本的辅助函数
    function loadScript(src, onload, onerror) {
        var s = document.createElement('script');
        s.src = src;
        s.type = 'text/javascript';
        s.setAttribute('crossorigin', 'anonymous');
        if (onload) s.onload = onload;
        if (onerror) s.onerror = onerror;
        document.body.appendChild(s);
    }

    // 链式加载：先 pageAnalyzer.js，再 domExtractor.bookmarklet.js
    loadScript(
        CDN_BASE + 'pageAnalyzer.js' + cacheBust,
        function () {
            console.log('✅ pageAnalyzer 加载完成');
            // pageAnalyzer 已经挂 window.domExtractor / window.printDomResults
            // 接下来加载主书签脚本
            loadScript(
                CDN_BASE + 'domExtractor.bookmarklet.js' + cacheBust,
                function () {
                    console.log('✅ domExtractor.bookmarklet 加载完成');
                },
                function () {
                    console.error('❌ domExtractor.bookmarklet.js 加载失败！');
                    console.log('💡 备用方案：直接在控制台粘贴 domExtractor.bookmarklet.js 的代码');
                }
            );
        },
        function () {
            console.error('❌ pageAnalyzer.js 加载失败！');
            console.log('💡 备用方案：直接在控制台粘贴 pageAnalyzer.js 的代码');
        }
    );
})();
