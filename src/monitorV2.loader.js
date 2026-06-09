/**
 * @file 美团外卖自动出餐助手 V2 — Bookmarklet Loader
 * @description 此文件部署到 GitHub Pages，书签通过 javascript: 协议动态加载此脚本，
 *              此脚本再加载完整的 monitorV2.bookmarklet.js，并自动启动监控。
 * @usage 将下面的代码创建为浏览器书签：
 *        javascript:void((function(){var s=document.createElement('script');s.src='https://luyuhua.github.io/waimai/src/monitorV2.loader.js?t='+Date.now();document.body.appendChild(s);})())
 */

(function() {
    'use strict';

    // 构建脚本 URL（带缓存破坏参数）
    var scriptUrl = 'https://luyuhua.github.io/waimai/src/monitorV2.bookmarklet.js?t=' + Date.now();

    // 停止之前的实例
    if (window.__wmV2Instance) {
        console.log('[WM-V2] 停止之前的实例...');
        window.__wmV2Instance.stop();
        window.__wmV2Instance = null;
    }

    // 清除旧标志
    delete window.__WM_V2_LOADED;

    // 创建 script 标签加载完整代码
    var s = document.createElement('script');
    s.src = scriptUrl;
    s.type = 'text/javascript';
    s.setAttribute('crossorigin', 'anonymous');
    s.onload = function() {
        console.log('✅ V2 脚本加载完成！自动启动监控...');
        // 自动启动监控
        if (typeof window.__WM_START === 'function') {
            window.__WM_START();
        } else {
            console.error('[WM-V2] __WM_START 未定义，请手动执行');
        }
    };
    s.onerror = function() {
        console.error('❌ V2 脚本加载失败！');
        console.log('💡 备用方案：直接在控制台粘贴 monitorV2.bookmarklet.js 的代码');
    };
    document.body.appendChild(s);
})();
