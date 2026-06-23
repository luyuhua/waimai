// popup.js — 控制面板

const $ = (id) => document.getElementById(id);
const dot = $('statusDot');
const statusText = $('statusText');
const lastAction = $('lastAction');
const errorRow = $('errorRow');
const errorText = $('errorText');
const intervalInput = $('intervalInput');
const btnStart = $('btnStart');
const btnStop = $('btnStop');
const btnOnce = $('btnOnce');
const hint = $('hint');

async function refreshStatus() {
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  render(state);
}

function render(state) {
  const { status, interval, lastAction: la, error } = state;

  dot.className = status === 'watching' ? 'watching' : '';

  const labels = { idle: '待机', watching: '监控中' };
  statusText.textContent = labels[status] || status;

  if (status === 'watching') {
    btnStart.style.display = 'none';
    btnStop.style.display = 'block';
    btnOnce.disabled = true;
  } else {
    btnStart.style.display = 'block';
    btnStop.style.display = 'none';
    btnOnce.disabled = false;
  }

  intervalInput.value = interval || 30;

  if (la) {
    const t = new Date(la.time);
    const ts = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    const icon = la.success ? '✅' : '❌';
    lastAction.textContent = `${icon} ${ts} ${la.text}`;
  } else {
    lastAction.textContent = '-';
  }

  if (error) {
    errorRow.style.display = 'flex';
    errorText.textContent = error;
  } else {
    errorRow.style.display = 'none';
  }

  hint.style.display = status === 'idle' ? 'block' : 'none';
}

function pad(n) { return String(n).padStart(2, '0'); }

btnStart.addEventListener('click', async () => {
  const interval = parseInt(intervalInput.value) || 30;
  btnStart.disabled = true;
  btnStart.textContent = '启动中...';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'START_WATCH', interval });
    if (res.ok) {
      await chrome.runtime.sendMessage({ type: 'SET_INTERVAL', interval });
      render(res.status);
    } else {
      alert('启动失败: ' + res.error);
      btnStart.disabled = false;
      btnStart.textContent = '▶ 开始监控';
    }
  } catch (err) {
    alert('通信错误: ' + err.message);
    btnStart.disabled = false;
    btnStart.textContent = '▶ 开始监控';
  }
});

btnStop.addEventListener('click', async () => {
  btnStop.disabled = true;
  btnStop.textContent = '停止中...';
  const res = await chrome.runtime.sendMessage({ type: 'STOP_WATCH' });
  render(res.status);
});

btnOnce.addEventListener('click', async () => {
  btnOnce.disabled = true;
  btnOnce.textContent = '检查中...';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'RUN_ONCE' });
    if (res.ok) {
      render(res.status);
    } else {
      alert('检查失败: ' + res.error);
    }
  } catch (err) {
    alert('通信错误: ' + err.message);
  }
  btnOnce.disabled = false;
  btnOnce.textContent = '⚡ 立即检查一次';
});

intervalInput.addEventListener('change', () => {
  let val = parseInt(intervalInput.value) || 30;
  if (val < 10) val = 10;
  if (val > 600) val = 600;
  intervalInput.value = val;
  chrome.runtime.sendMessage({ type: 'SET_INTERVAL', interval: val });
});

refreshStatus();
setInterval(refreshStatus, 3000);
