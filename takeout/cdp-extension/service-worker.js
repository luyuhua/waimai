// 自动出餐助手 — Service Worker
// 通过 chrome.debugger (内置 CDP) 在饿了么商家版执行真实鼠标点击出餐

// ========== 状态 ==========
const STORAGE_KEY = 'cookState';
const ALARM_NAME = 'cook-watch';
const IFRAME_KEYWORD = 'napos-order-pc.faas.ele.me';
const BTN_TEXT = '上报出餐';
const CONFIRM_BTN_TEXT = '真实上报';
const MAX_POLL_ATTEMPTS = 100; // watch 模式下每 5 次重查 frame_id

let currentState = {
  status: 'idle',        // 'idle' | 'watching'
  interval: 30,          // 轮询间隔(秒)
  lastAction: null,      // { time, text, success }
  tabId: null,
  orderCount: 0,
  error: null
};

async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: currentState });
}

async function loadState() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (stored[STORAGE_KEY]) {
    currentState = { ...currentState, ...stored[STORAGE_KEY] };
  }
}

function setStatus(status, extra = {}) {
  currentState = { ...currentState, ...extra, status };
  saveState();
}

// ========== CDP 命令封装 ==========

function cdpSend(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

function debuggerAttach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function debuggerDetach(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      // 忽略错误(可能已经被 detach)
      resolve();
    });
  });
}

// ========== CDP 操作 ==========

async function findOrderTab() {
  const tabs = await chrome.tabs.query({ url: 'https://melody.shop.ele.me/*' });
  if (!tabs.length) {
    throw new Error('未找到 melody.shop.ele.me 标签页，请先登录商家后台');
  }
  return tabs[0];
}

function walkFrameTree(node, predicate) {
  if (predicate(node)) {
    return node.frame?.id;
  }
  for (const child of node.childFrames || []) {
    const found = walkFrameTree(child, predicate);
    if (found) return found;
  }
  return null;
}

async function findOrderIframe(tabId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const tree = await cdpSend(tabId, 'Page.getFrameTree');
    const fid = walkFrameTree(
      tree.frameTree,
      (node) => (node.frame?.url || '').includes(IFRAME_KEYWORD)
    );
    if (fid) return fid;
    await sleep(1000);
  }
  return null;
}

async function createIsolatedContext(tabId, frameId) {
  const result = await cdpSend(tabId, 'Page.createIsolatedWorld', {
    frameId,
    worldName: 'auto-cook'
  });
  return result.executionContextId;
}

async function queryButton(tabId, contextId, buttonText) {
  const js = `
    (function() {
      const BTN = ${JSON.stringify(buttonText)};
      const vw = window.innerWidth, vh = window.innerHeight;
      for (const el of document.querySelectorAll('button, div[class*="submit"]')) {
        const text = (el.innerText || '').trim();
        if (!text.includes(BTN)) continue;
        const r = el.getBoundingClientRect();
        const x = Number(r.x) || 0, y = Number(r.y) || 0;
        const w = Number(r.width) || 0, h = Number(r.height) || 0;
        if (w < 5 || h < 5) continue;
        const right = Number(r.right) || 0, bottom = Number(r.bottom) || 0;
        if (right < 0 || bottom < 0 || x > vw || y > vh) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        return { found: true, text, x: x + w/2, y: y + h/2, w, h, tag: el.tagName };
      }
      return { found: false };
    })()
  `;
  const result = await cdpSend(tabId, 'Runtime.evaluate', {
    expression: js,
    contextId,
    returnByValue: true
  });
  return result.result?.value;
}

async function getIframeOffset(tabId) {
  const result = await cdpSend(tabId, 'Runtime.evaluate', {
    expression: `
      (() => {
        const f = document.querySelector('iframe[src*="napos-order-pc"]');
        if (!f) return null;
        const r = f.getBoundingClientRect();
        return { x: Number(r.x)||0, y: Number(r.y)||0, w: Number(r.width)||0, h: Number(r.height)||0 };
      })()
    `,
    returnByValue: true
  });
  return result.result?.value;
}

async function dispatchClick(tabId, x, y) {
  // 加随机抖动(±2px)，模拟人手
  x += (Math.random() - 0.5) * 4;
  y += (Math.random() - 0.5) * 4;

  await cdpSend(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y
  });
  await sleep(50 + Math.random() * 80);

  await cdpSend(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1
  });
  await sleep(40 + Math.random() * 60);

  await cdpSend(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ========== 主流程：执行一轮出餐检查 ==========

async function runOneCycle(tabId) {
  const startTime = Date.now();
  const log = (text, ok = true) => {
    console.log(`[auto-cook] ${text}`);
    currentState.lastAction = { time: Date.now(), text, success: ok };
    saveState();
  };

  // 1. Attach
  log('attach debugger...');
  await debuggerAttach(tabId);

  try {
    // 2. Enable domains
    await cdpSend(tabId, 'Page.enable');
    await cdpSend(tabId, 'Runtime.enable');

    // 3. 找 iframe
    const frameId = await findOrderIframe(tabId);
    if (!frameId) {
      log('未找到订单 iframe（页面可能未加载完）', false);
      return { success: false, reason: 'no_iframe' };
    }

    // 4. 创建隔离执行上下文
    const contextId = await createIsolatedContext(tabId, frameId);

    // 5. 查按钮
    const btn = await queryButton(tabId, contextId, BTN_TEXT);
    if (!btn || !btn.found) {
      log('未找到「上报出餐」按钮', true);
      return { success: true, reason: 'no_button' };
    }

    log(`找到按钮: <${btn.tag}> "${btn.text}" (${btn.x.toFixed(0)},${btn.y.toFixed(0)})`);

    // 6. 获取 iframe 偏移，计算 page 坐标
    const iframeOffset = await getIframeOffset(tabId);
    let pageX = btn.x, pageY = btn.y;
    if (iframeOffset) {
      pageX = btn.x + iframeOffset.x;
      pageY = btn.y + iframeOffset.y;
    }

    // 7. 点击「上报出餐」
    log(`点击上报出餐 (page ${pageX.toFixed(0)},${pageY.toFixed(0)})`);
    await dispatchClick(tabId, pageX, pageY);

    // 8. 等二次确认弹窗
    let confirmed = false;
    for (let i = 0; i < 10; i++) {
      await sleep(300);
      const confirmBtn = await queryButton(tabId, contextId, CONFIRM_BTN_TEXT);
      if (confirmBtn && confirmBtn.found) {
        let cx = confirmBtn.x, cy = confirmBtn.y;
        if (iframeOffset) {
          cx += iframeOffset.x;
          cy += iframeOffset.y;
        }
        await sleep(300 + Math.random() * 300);
        log(`点击「真实上报」确认 (${cx.toFixed(0)},${cy.toFixed(0)})`);
        await dispatchClick(tabId, cx, cy);
        confirmed = true;
        break;
      }
    }

    if (!confirmed) {
      log('未出现二次确认弹窗（可能无需确认）', true);
    }

    // 9. 验证：等 UI 更新，查按钮是否消失
    await sleep(3000);
    const btnAfter = await queryButton(tabId, contextId, BTN_TEXT);
    if (!btnAfter || !btnAfter.found) {
      log('出餐成功！按钮已消失', true);
      return { success: true, clicked: true };
    } else {
      log('按钮仍在（可能出餐未完成或还有其他订单）', true);
      return { success: true, clicked: true, buttonRemains: true };
    }

  } finally {
    // 10. 总是 detach
    await debuggerDetach(tabId);
  }
}

// ========== Watch 模式 ==========

async function startWatch(interval) {
  const tab = await findOrderTab();
  currentState.tabId = tab.id;
  currentState.interval = interval;
  setStatus('watching');

  // 立即跑一轮
  console.log('[auto-cook] 启动 watch 模式，立即运行首轮...');
  try {
    await runOneCycle(tab.id);
  } catch (err) {
    console.error('[auto-cook] 首轮出错:', err.message);
    currentState.error = err.message;
    saveState();
  }

  // 创建定时 alarm
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval / 60 });
  console.log(`[auto-cook] alarm 已创建, 每 ${interval}s 一次`);
}

async function stopWatch() {
  await chrome.alarms.clear(ALARM_NAME);
  // 如果还 attached，detach
  if (currentState.tabId) {
    try { await debuggerDetach(currentState.tabId); } catch (_) {}
  }
  setStatus('idle', { tabId: null, error: null });
  console.log('[auto-cook] watch 已停止');
}

// ========== Alarm 回调 ==========

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  console.log('[auto-cook] alarm 触发，开始一轮检查...');
  const tab = await findOrderTab().catch(() => null);
  if (!tab) {
    console.warn('[auto-cook] 未找到标签页，跳过本轮');
    currentState.lastAction = { time: Date.now(), text: '未找到商家标签页', success: false };
    saveState();
    return;
  }

  currentState.tabId = tab.id;
  saveState();

  try {
    await runOneCycle(tab.id);
    currentState.error = null;
  } catch (err) {
    console.error('[auto-cook] 本轮出错:', err.message);
    currentState.error = err.message;
  }
  saveState();
});

// ========== Debugger detach 监听 ==========

chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`[auto-cook] debugger detached from tab ${source.tabId}, reason: ${reason}`);
  if (currentState.tabId === source.tabId && reason === 'target_closed') {
    setStatus('idle', { tabId: null, error: '标签页已关闭' });
  }
});

// ========== 消息处理 ==========

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse);
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'GET_STATUS':
      return currentState;

    case 'START_WATCH': {
      try {
        await startWatch(msg.interval || currentState.interval || 30);
        return { ok: true, status: currentState };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'STOP_WATCH': {
      await stopWatch();
      return { ok: true, status: currentState };
    }

    case 'RUN_ONCE': {
      try {
        const tab = await findOrderTab();
        currentState.tabId = tab.id;
        saveState();
        const result = await runOneCycle(tab.id);
        return { ok: true, result, status: currentState };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'SET_INTERVAL': {
      currentState.interval = msg.interval;
      saveState();
      // 如果正在 watch，重建 alarm
      if (currentState.status === 'watching') {
        await chrome.alarms.clear(ALARM_NAME);
        await chrome.alarms.create(ALARM_NAME, { periodInMinutes: msg.interval / 60 });
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: `未知消息类型: ${msg.type}` };
  }
}

// ========== 启动时恢复状态 ==========

(async () => {
  await loadState();
  console.log('[auto-cook] 扩展已加载，当前状态:', currentState.status);

  // 检查 alarm 是否存在(扩展重载后 alarm 可能还在)
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing) {
    console.log('[auto-cook] 已有活跃 alarm，恢复 watching');
    currentState.status = 'watching';
    await saveState();
  } else if (currentState.status === 'watching') {
    // 状态说在 watching 但 alarm 没了，修正
    currentState.status = 'idle';
    await saveState();
  }
})();
