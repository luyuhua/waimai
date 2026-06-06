/**
 * @file DOM 提取工具 Loader - 书签动态加载脚本
 * @description 此文件部署到 GitHub Pages，书签通过 javascript: 协议动态加载此脚本
 * @usage 将此文件的 URL 嵌入书签的 javascript: URL 中
 */

(function() {
    'use strict';

    // 构建脚本 URL（带缓存破坏参数）
    var scriptUrl = 'https://luyuhua.github.io/waimai/docs/domExtractor.bookmarklet.js?t=' + Date.now();

    // 检查是否已加载
    if (window.__domExtractorLoaded) {
        console.log('🔄 domExtractor 已加载，重新执行提取...');
        var result = window.domExtractor({ viewportExpansion: -1 });
        if (window.printResults) {
            window.printResults(result);
        } else {
            var interactive = window.getInteractiveElements(result.map);
            console.log('🎯 可交互元素: ' + interactive.length);
            console.table(interactive);
        }
        return;
    }

    // 创建 script 标签加载完整代码
    var s = document.createElement('script');
    s.src = scriptUrl;
    s.type = 'text/javascript';
    s.setAttribute('crossorigin', 'anonymous');
    s.onload = function() {
        console.log('✅ DOM 提取脚本加载完成！');
    };
    s.onerror = function() {
        console.error('❌ DOM 提取脚本加载失败！请检查网络连接。');
        console.log('💡 备用方案：直接在控制台粘贴 domExtractor.console.js 的代码');
    };
    document.body.appendChild(s);
})();