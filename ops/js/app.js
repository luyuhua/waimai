// ========= STATE =========
let state = {page:'revenue', store:'all', platform:'all', time:'today'};
const charts = {};
let authState = { user: null, session: null, role: null, loading: true };

// ========= AUTH UI =========
function showAuthOverlay(mode) {
  const ov = document.getElementById('auth-overlay');
  if (!ov) return;
  ov.style.display = 'flex';
  document.getElementById('auth-mode-label').textContent = mode === 'signup' ? '注册' : '登录';
  document.getElementById('auth-submit-btn').textContent = mode === 'signup' ? '注册' : '登录';
  document.getElementById('auth-toggle-text').textContent = mode === 'signup' ? '已有账号？' : '没有账号？';
  document.getElementById('auth-toggle-link').textContent = mode === 'signup' ? '立即登录' : '立即注册';
  document.getElementById('auth-error').style.display = 'none';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-card').dataset.mode = mode;
}

function hideAuthOverlay() {
  const ov = document.getElementById('auth-overlay');
  if (ov) ov.style.display = 'none';
}

async function initAuthUI() {
  const submitBtn = document.getElementById('auth-submit-btn');
  const toggleLink = document.getElementById('auth-toggle-link');
  const skipBtn = document.getElementById('auth-skip-btn');
  const emailEl = document.getElementById('auth-email');
  const passwordEl = document.getElementById('auth-password');
  const errEl = document.getElementById('auth-error');

  submitBtn.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    const password = passwordEl.value.trim();
    const mode = document.getElementById('auth-card').dataset.mode;
    if (!email || !password) { errEl.textContent = '请填写邮箱和密码'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    try {
      if (mode === 'signup') {
        const { data } = await signUp(email, password);
        if (data.user && data.session) {
          // Auto-confirmed signup
          onAuthenticated(data.session);
        } else {
          errEl.textContent = '检查邮箱中的确认链接，确认后请登录。';
          errEl.style.display = 'block';
        }
      } else {
        const data = await signIn(email, password);
        onAuthenticated(data.session);
      }
    } catch (e) {
      errEl.textContent = e.message || '认证失败，请重试';
      errEl.style.display = 'block';
    }
  });

  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    const currentMode = document.getElementById('auth-card').dataset.mode;
    showAuthOverlay(currentMode === 'signup' ? 'signin' : 'signup');
  });

  skipBtn.addEventListener('click', () => {
    hideAuthOverlay();
    authState.loading = false;
    authState.user = null;
    loadInitialData();
  });
}

async function onAuthenticated(session) {
  authState.session = session;
  authState.user = session.user;
  hideAuthOverlay();
  const role = await apiFetchUserRole();
  authState.role = role ? role.role : 'operator';
  authState.loading = false;
  loadInitialData();
}

async function checkAuth() {
  const session = await getSession();
  if (session) {
    authState.session = session;
    authState.user = session.user;
    const role = await apiFetchUserRole();
    authState.role = role ? role.role : 'operator';
    authState.loading = false;
    hideAuthOverlay();
    loadInitialData();
  } else {
    authState.loading = false;
    showAuthOverlay('signin');
  }
}

onAuthChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    authState = { user: null, session: null, role: null, loading: false };
    showAuthOverlay('signin');
  } else if (event === 'SIGNED_IN' && session) {
    onAuthenticated(session);
  }
});

function fmt(n){return '¥'+n.toLocaleString('zh-CN',{minimumFractionDigits:0})}
function pct(a,b){return ((a/b)*100).toFixed(1)+'%'}
function dc(id){if(charts[id]){charts[id].destroy();delete charts[id];}}

function exportCSV(filename,headers,rows){
  const BOM='﻿';
  const csv=BOM+[headers.join(','),...rows.map(r=>r.map(v=>'"'+(v==null?'':String(v)).replace(/"/g,'""')+'"').join(','))].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename+'.csv';document.body.appendChild(a);a.click();
  document.body.removeChild(a);URL.revokeObjectURL(url);
}

async function handleGlobalExport(){
  const p = state.page;
  if (p === 'revenue') {
    const orders = await getFilteredOrders();
    const income = orders.reduce((s, o) => s + (o.estimated_income || 0), 0);
    const commission = orders.reduce((s, o) => s + (o.commission_amount || 0), 0);
    const discount = orders.reduce((s, o) => s + (o.order_discount || 0), 0);
    const subsidy = orders.reduce((s, o) => s + (o.delivery_subsidy || 0), 0);
    const netInc = income - commission - discount + subsidy;
    exportCSV('营收数据', ['指标', '金额'], [
      ['营业收入', fmt(income)],
      ['平台佣金', fmt(-commission)],
      ['订单优惠', fmt(-discount)],
      ['配送补贴', fmt(subsidy)],
      ['净收入', fmt(netInc)],
      ['订单数', orders.length],
    ]);
  } else if (p === 'orders') {
    const orders = await getFilteredOrders();
    const hourMap = {};
    for (let i = 0; i < 24; i++) hourMap[i] = 0;
    for (const o of orders) {
      const t = parseOrderTime(o.order_time);
      if (t) hourMap[t.getHours()] = (hourMap[t.getHours()] || 0) + 1;
    }
    const dayMap = new Map();
    for (const o of orders) {
      const t = parseOrderTime(o.order_time);
      if (!t) continue;
      const key = `${t.getMonth() + 1}/${t.getDate()}`;
      dayMap.set(key, (dayMap.get(key) || 0) + 1);
    }
    const trend = [...dayMap.entries()].sort();
    exportCSV('订单数据', ['日期/时段', '订单量'], [
      ...trend.map(([d, c]) => ['日期: ' + d, c]),
      ...Array.from({ length: 24 }, (_, i) => [i + ':00', hourMap[i]]),
    ]);
  } else if (p === 'users') {
    const orders = await getFilteredOrders();
    const custMap = new Map();
    for (const o of orders) {
      const name = o.customer_name || '未知';
      if (!custMap.has(name)) custMap.set(name, { orders: 0, spend: 0, last: '' });
      const c = custMap.get(name);
      c.orders++;
      c.spend += (o.estimated_income || 0) - (o.commission_amount || 0) + (o.delivery_subsidy || 0);
      const t = parseOrderTime(o.order_time);
      if (t && (!c.last || t > new Date(c.last))) c.last = `${t.getMonth() + 1}/${t.getDate()}`;
    }
    const sorted = [...custMap.entries()].sort((a, b) => b[1].spend - a[1].spend).slice(0, 50);
    exportCSV('客户数据', ['排名', '客户名称', '订单数', '消费总额', '最后下单'], sorted.map(([name, c], i) => [i + 1, name, c.orders, fmt(c.spend), c.last]));
  } else if (p === 'products') {
    const orders = await getFilteredOrders();
    const mappings = await apiFetchMappings();
    const dishes = await apiFetchDishes();
    const mappingMap = {};
    for (const m of mappings) { if (m.status === 'confirmed' && m.dish_id) mappingMap[`${m.platform}|||${m.platform_dish_name}`] = m.dish_id; }
    const dishMap = {};
    for (const d of dishes) { dishMap[d.id] = d.cost || 0; }
    const prodMap = new Map();
    for (const o of orders) {
      for (const p of (o.order_products || [])) {
        const qty = p.quantity || 1;
        const rev = p.total_price || (p.unit_price || 0) * qty;
        const dishId = mappingMap[`${o.platform}|||${p.name}`];
        const cost = dishId ? (dishMap[dishId] || 0) : 0;
        if (!prodMap.has(p.name)) prodMap.set(p.name, { qty: 0, rev: 0, cost: 0, margin: 0 });
        const entry = prodMap.get(p.name);
        entry.qty += qty;
        entry.rev += rev;
        entry.cost += cost * qty;
        entry.margin = entry.rev > 0 ? ((entry.rev - entry.cost) / entry.rev * 100) : 0;
      }
    }
    const sorted = [...prodMap.entries()].sort((a, b) => b[1].rev - a[1].rev);
    exportCSV('商品数据', ['商品名称', '销量', '收入', '成本', '毛利率'], sorted.map(([name, d]) => [name, d.qty, fmt(d.rev), fmt(d.cost), d.margin.toFixed(1) + '%']));
  } else if (p === 'dishes') {
    const dishes = await apiFetchDishes();
    const filtered = dishes.filter(d => {
      if (dishFilter.search && !d.name.includes(dishFilter.search)) return false;
      if (dishFilter.cat && d.cat !== dishFilter.cat) return false;
      if (dishFilter.status && d.status !== dishFilter.status) return false;
      return true;
    });
    exportCSV('菜品管理', ['菜品名称', '分类', '成本价', '售价', '毛利率', '状态'], filtered.map(d => [d.name, d.cat, fmt(d.cost), fmt(d.price), d.price > 0 ? ((d.price - d.cost) / d.price * 100).toFixed(1) + '%' : '0.0%', d.status]));
  } else if (p === 'reports') {
    const orders = await getAnalyticsOrders();
    const reports = [];
    if (orders.length) {
      const dayMap = new Map();
      for (const o of orders) {
        const t = parseOrderTime(o.order_time);
        if (!t) continue;
        const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        if (!dayMap.has(key)) dayMap.set(key, []);
        dayMap.get(key).push(o);
      }
      for (const [dateKey, dayOrders] of dayMap) {
        const income = dayOrders.reduce((s, o) => s + (o.estimated_income || 0), 0);
        const commission = dayOrders.reduce((s, o) => s + (o.commission_amount || 0), 0);
        const discount = dayOrders.reduce((s, o) => s + (o.order_discount || 0), 0);
        const subsidy = dayOrders.reduce((s, o) => s + (o.delivery_subsidy || 0), 0);
        const netInc = income - commission - discount + subsidy;
        reports.push({ type: '日报', date: dateKey, store: '全部店铺', income, net: netInc, gross: netInc, orders: dayOrders.length });
      }
      reports.sort((a, b) => b.date.localeCompare(a.date));
    }
    if (!reports.length) reports.push({ type: '日报', date: '无数据', store: '全部店铺', income: 0, gross: 0, net: 0, orders: 0 });
    exportCSV('运营报告', ['类型', '日期', '店铺', '收入', '毛利', '净利', '订单数'], reports.map(r => [r.type, r.date, r.store, r.income, r.gross, r.net, r.orders]));
  }
}

// ========= NAVIGATION =========
function showPage(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pg=document.getElementById('page-'+page);
  if(pg)pg.classList.add('active');
  const ni=document.querySelector('[data-page="'+page+'"]');
  if(ni)ni.classList.add('active');
  state.page=page;
  renderPage(page);
}

async function renderPage(page){
  switch(page){
    case 'revenue': await renderRevenue();break;
    case 'users': await renderUsers();break;
    case 'orders': await renderOrders();break;
    case 'products': await renderProducts();break;
    case 'dishes': await renderDishes();break;
    case 'import': await renderImport();break;
    case 'costs': await renderCosts();break;
    case 'fixed': await renderFixed();break;
    case 'reports': await renderReports();break;
  }
}

// ========= ANALYTICS HELPERS =========
function getTimeRange() {
  const now = new Date();
  let start, end;
  switch (state.time) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      break;
    case '7d':
      start = daysAgo(7);
      end = now;
      break;
    case '30d':
      start = daysAgo(30);
      end = now;
      break;
    case 'custom': {
      const from = document.getElementById('gf-date-from').value;
      const to = document.getElementById('gf-date-to').value;
      start = from ? new Date(from) : daysAgo(30);
      end = to ? new Date(to + 'T23:59:59') : now;
      break;
    }
    default:
      start = daysAgo(7);
      end = now;
  }
  return { start, end };
}

let analyticsCache = null;

async function getAnalyticsOrders() {
  if (!USE_REAL_DATA || !authState.user) return [];
  if (analyticsCache) return analyticsCache;
  try {
    const raw = await apiFetchAllOrdersWithProducts();
    analyticsCache = raw;
    return raw;
  } catch (e) {
    console.warn('Analytics fetch failed:', e);
    return [];
  }
}

async function getFilteredOrders() {
  const all = await getAnalyticsOrders();
  if (!all.length) return [];

  const { start, end } = getTimeRange();
  const stores = await apiFetchStores();

  // Build store id → name lookup
  const storeMap = {};
  for (const s of stores) {
    storeMap[s.id] = s.name;
  }

  return all.filter(o => {
    const t = parseOrderTime(o.order_time);
    if (!t || t < start || t > end) return false;
    if (state.store && state.store !== 'all') {
      const storeName = storeMap[parseInt(state.store)];
      if (storeName && o.shop_name !== storeName) return false;
    }
    if (state.platform && state.platform !== 'all') {
      if (o.platform !== state.platform) return false;
    }
    return true;
  });
}

// ========= REVENUE PAGE =========
async function renderRevenue(){
  let orders = [];
  let income = 24850, cogs = 10388, commission = 1250, discount = 680, subsidy = 400;
  let opCost = 2820, fixCost = 2100, net = 9542, orderCount = 763;

  // Real data path
  if (USE_REAL_DATA && authState.user) {
    try {
      orders = await getFilteredOrders();
      if (orders.length) {
        // Fetch mappings + dishes for COGS
        const [mappings, dishes] = await Promise.all([apiFetchMappings(), apiFetchDishes()]);
        const mappingMap = new Map();
        for (const m of mappings) {
          if (m.dish_id) mappingMap.set(`${m.platform}|||${m.platform_dish_name}`, m.dish_id);
        }
        const dishMap = new Map();
        for (const d of dishes) dishMap.set(d.id, d.cost || 0);

        orderCount = orders.length;
        income = 0; cogs = 0; commission = 0; discount = 0; subsidy = 0;

        for (const o of orders) {
          income += o.estimated_income || 0;
          commission += o.commission_amount || 0;
          discount += o.order_discount || 0;
          subsidy += o.delivery_subsidy || 0;
          if (o.order_products) {
            for (const p of o.order_products) {
              const key = `${o.platform}|||${p.name}`;
              const dishId = mappingMap.get(key);
              const cost = dishId ? (dishMap.get(dishId) || 0) : 0;
              cogs += (p.quantity || 0) * cost;
            }
          }
        }

        const netIncome = income - commission - discount + subsidy;
        const grossProfit = netIncome - cogs;

        // Fetch op costs (daily) and fixed costs for the period
        const today = new Date().toISOString().slice(0, 10);
        const storeId = (state.store && state.store !== 'all') ? parseInt(state.store) : null;
        const [dailyCosts, fixedCosts] = await Promise.all([
          apiFetchDailyCosts(storeId, state.time === 'today' ? today : null),
          apiFetchFixedCosts(storeId)
        ]);

        opCost = 0;
        for (const dc of dailyCosts) {
          if (dc.daily_op_cost_items) {
            for (const item of dc.daily_op_cost_items) {
              opCost += item.amount || 0;
            }
          }
        }

        const daysInMonth = getDaysInMonth();
        fixCost = 0;
        for (const fc of fixedCosts) {
          if (fc.active) fixCost += (fc.monthly || 0) / daysInMonth;
        }

        // Scale fixed cost for date range
        const { start, end } = getTimeRange();
        const rangeDays = Math.max(1, Math.ceil((end - start) / (24 * 3600 * 1000)));
        fixCost *= rangeDays;
        opCost = opCost || 0;

        net = grossProfit - opCost - fixCost;
        discount = discount; // Already summed
      }
    } catch (e) {
      console.warn('Revenue analytics failed:', e);
    }
  }

  // KPI cards
  const netIncome = income - commission - discount + subsidy;
  const grossProfit = netIncome - cogs;
  const netMargin = income > 0 ? (net / income * 100).toFixed(1) : '0.0';
  const avgOrderValue = orderCount > 0 ? income / orderCount : 0;
  const costRate = income > 0 ? (cogs / income * 100).toFixed(1) : '0.0';
  const grossRate = income > 0 ? (grossProfit / income * 100).toFixed(1) : '0.0';
  const totalDeduct = commission + discount - subsidy + opCost + fixCost;

  document.getElementById('rev-income').textContent = fmt(income);
  document.getElementById('rev-gross').textContent = fmt(grossProfit);
  document.getElementById('rev-net').textContent = fmt(net);
  document.getElementById('rev-alert').style.display = (netMargin < 40 && income > 0) ? '' : 'none';

  // Rewrite KPI grid
  const kpiGrid = document.querySelector('#page-revenue .kpi-grid');
  kpiGrid.innerHTML = `
    <div class="kpi">
      <div class="kpi-lbl">营业收入<span class="badge b-blue">${state.time === 'today' ? '今日' : state.time}</span></div>
      <div class="kpi-val" id="rev-income">${fmt(income)}</div>
      <div class="kpi-sub">${orderCount} 单 · 客单价 <strong>${fmt(avgOrderValue)}</strong></div>
    </div>
    <div class="kpi">
      <div class="kpi-lbl">毛利额</div>
      <div class="kpi-val" style="color:#4F6BED">${fmt(grossProfit)}</div>
      <div class="kpi-sub">毛利率 <strong>${grossRate}%</strong></div>
    </div>
    <div class="kpi net">
      <div class="kpi-lbl">实际净利 <span class="kpi-rate">净利率 ${netMargin}%</span></div>
      <div class="kpi-val" id="rev-net">${fmt(net)}</div>
      <div class="kpi-sub">净收入 ${fmt(netIncome)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-lbl">总扣减成本</div>
      <div class="kpi-val" style="color:#F59E0B">${fmt(totalDeduct)}</div>
      <div class="kpi-sub">佣金 ${fmt(commission)} + 折扣 ${fmt(discount)} + 补贴 -${fmt(subsidy)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-lbl">菜品成本合计</div>
      <div class="kpi-val">${fmt(cogs)}</div>
      <div class="kpi-sub">成本占收入比 <strong>${costRate}%</strong></div>
    </div>
    <div class="kpi">
      <div class="kpi-lbl">订单数</div>
      <div class="kpi-val">${orderCount}</div>
      <div class="kpi-sub">平台扣减 ${fmt(commission + discount)}</div>
    </div>
  `;

  // Waterfall
  const maxAmt = Math.max(income, 1);
  const wfRows = [
    { label: '营业收入', amount: income, color: '#4F6BED', width: 100 },
    { label: '减：佣金', amount: -commission, color: '#EF4444', width: commission / maxAmt * 100 },
    { label: '减：订单折扣', amount: -discount, color: '#EF4444', width: discount / maxAmt * 100 },
    { label: '加：配送补贴', amount: subsidy, color: '#22C55E', width: subsidy / maxAmt * 100 },
    { label: '= 净收入', amount: netIncome, color: '#4F6BED', width: netIncome / maxAmt * 100, bold: true },
    { label: '减：菜品成本', amount: -cogs, color: '#EF4444', width: cogs / maxAmt * 100 },
    { label: '= 毛利', amount: grossProfit, color: '#10B981', width: grossProfit / maxAmt * 100, bold: true },
    { label: '减：运营成本', amount: -opCost, color: '#F59E0B', width: opCost / maxAmt * 100 },
    { label: '减：固定成本摊销', amount: -fixCost, color: '#F59E0B', width: fixCost / maxAmt * 100 },
    { label: '= 实际净利', amount: net, color: '#22C55E', width: Math.abs(net) / maxAmt * 100, bold: true },
  ];

  document.getElementById('wf-rows').innerHTML = wfRows.map(r => `
    <div class="wf-row">
      <div class="wf-row-lbl" style="${r.bold ? 'font-weight:700;color:var(--t1)' : ''}">${r.label}</div>
      <div class="wf-bar-bg">
        <div class="wf-bar-fill" style="width:${Math.max(parseFloat(r.width), 3)}%;background:${r.color}">
          ${parseFloat(r.width) > 12 ? pct(Math.abs(r.amount), income) : ''}
        </div>
      </div>
      <div class="wf-row-amt" style="color:${r.amount < 0 ? '#EF4444' : 'var(--t1)'}${r.bold ? ';font-weight:700' : ''}">${r.amount < 0 ? '-' : ''}${fmt(Math.abs(r.amount))}</div>
      <div class="wf-row-rt">${r.bold ? pct(Math.abs(r.amount), income) : pct(Math.abs(r.amount), income)}</div>
    </div>
  `).join('');

  // Revenue trend chart (by day)
  dc('c-rev-trend');
  const trendCtx = document.getElementById('c-rev-trend').getContext('2d');
  const { start: tStart, end: tEnd } = getTimeRange();
  const dayMap = new Map();
  for (const o of orders) {
    const t = parseOrderTime(o.order_time);
    if (!t) continue;
    const dayKey = `${t.getMonth() + 1}/${t.getDate()}`;
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, { income: 0, count: 0 });
    const d = dayMap.get(dayKey);
    d.income += o.estimated_income || 0;
    d.count++;
  }
  const sortedDays = [...dayMap.keys()].sort((a, b) => {
    const [am, ad] = a.split('/'), [bm, bd] = b.split('/');
    return parseInt(am) * 100 + parseInt(ad) - (parseInt(bm) * 100 + parseInt(bd));
  });
  const dayLabels = sortedDays.length ? sortedDays : ['6/16', '6/17', '6/18', '6/19', '6/20', '6/21', '6/22'];
  const incomeData = sortedDays.length ? sortedDays.map(k => dayMap.get(k).income) : [21200, 19800, 24100, 19540, 26100, 22380, 24850];

  charts['c-rev-trend'] = new Chart(trendCtx, {
    type: 'line',
    data: {
      labels: dayLabels,
      datasets: [
        { label: '营业收入', data: incomeData, borderColor: '#4F6BED', backgroundColor: 'rgba(79,107,237,.08)', borderWidth: 2, fill: true, tension: .4, pointRadius: 3, pointBackgroundColor: '#4F6BED' },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 12 } } }, scales: { y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { size: 10 }, callback: v => '¥' + v.toLocaleString() } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } } }
  });

  // Op cost doughnut (from daily_op_costs)
  dc('c-op-cost');
  const opCtx = document.getElementById('c-op-cost').getContext('2d');
  let opLabels = ['推广费用', '霸王餐补贴', '大额订单补贴', '其他'];
  let opData = [1500, 800, 520, 0];
  if (USE_REAL_DATA && authState.user) {
    try {
      const storeId = (state.store && state.store !== 'all') ? parseInt(state.store) : null;
      const today = new Date().toISOString().slice(0, 10);
      const dailyCosts = await apiFetchDailyCosts(storeId, state.time === 'today' ? today : null);
      const catMap = new Map();
      for (const dc of dailyCosts) {
        if (dc.daily_op_cost_items) {
          for (const item of dc.daily_op_cost_items) {
            const cat = item.category || 'other';
            catMap.set(cat, (catMap.get(cat) || 0) + (item.amount || 0));
          }
        }
      }
      if (catMap.size) {
        opLabels = [...catMap.keys()];
        opData = [...catMap.values()];
      }
    } catch (e) { /* use mock */ }
  }
  charts['c-op-cost'] = new Chart(opCtx, {
    type: 'doughnut',
    data: { labels: opLabels, datasets: [{ data: opData, backgroundColor: ['#4F6BED', '#F59E0B', '#EF4444', '#10B981', '#7C3AED', '#0EA5E9'], borderWidth: 0, hoverOffset: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 8 } } } }
  });

  // Fixed cost doughnut
  dc('c-fix-cost');
  const fixCtx = document.getElementById('c-fix-cost').getContext('2d');
  let fixLabels = ['房租摊销', '水电摊销', '人工摊销'];
  let fixData = [387, 103, 1452];
  if (USE_REAL_DATA && authState.user) {
    try {
      const storeId = (state.store && state.store !== 'all') ? parseInt(state.store) : null;
      const fixedCosts = await apiFetchFixedCosts(storeId);
      const activeCosts = fixedCosts.filter(c => c.active);
      if (activeCosts.length) {
        const daysInMonth = getDaysInMonth();
        const fixCatMap = new Map();
        for (const fc of activeCosts) {
          const cat = fc.category || 'other';
          const dailyShare = (fc.monthly || 0) / daysInMonth;
          fixCatMap.set(cat, (fixCatMap.get(cat) || 0) + dailyShare);
        }
        fixLabels = [...fixCatMap.keys()];
        fixData = [...fixCatMap.values()];
      }
    } catch (e) { /* use mock */ }
  }
  charts['c-fix-cost'] = new Chart(fixCtx, {
    type: 'doughnut',
    data: { labels: fixLabels, datasets: [{ data: fixData, backgroundColor: ['#7C3AED', '#0EA5E9', '#F97316', '#10B981', '#4F6BED'], borderWidth: 0, hoverOffset: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 8 } } } }
  });
}

// ========= USERS PAGE =========
async function renderUsers(){
  let orders = [];
  let customers = CUSTOMERS;
  let newCount = 245, oldCount = 518;

  if (USE_REAL_DATA && authState.user) {
    try {
      orders = await getFilteredOrders();
      if (orders.length) {
        // Group by customer_name
        const custMap = new Map();
        for (const o of orders) {
          const name = o.customer_name || '未知客户';
          if (!custMap.has(name)) custMap.set(name, { orders: 0, spend: 0, lastOrder: null, isNew: 0, isFav: 0 });
          const c = custMap.get(name);
          c.orders++;
          c.spend += (o.estimated_income || 0);
          const t = parseOrderTime(o.order_time);
          if (!c.lastOrder || (t && t > c.lastOrder)) c.lastOrder = t;
          if (o.is_new_customer) c.isNew++;
          if (o.is_fav_customer) c.isFav++;
        }
        // Count new vs old
        newCount = 0; oldCount = 0;
        const custArr = [];
        for (const [name, c] of custMap) {
          custArr.push({ id: name, orders: c.orders, spend: c.spend, lastOrder: c.lastOrder, tag: c.isFav > 0 ? '收藏客户' : '', isNew: c.isNew });
          if (c.isNew >= c.orders - c.isNew) newCount++;
          else oldCount++;
        }
        custArr.sort((a, b) => b.spend - a.spend);
        customers = custArr.slice(0, 20);
      }
    } catch (e) { console.warn('Users analytics failed:', e); }
  }

  // Customer table
  const tbl = document.getElementById('tbl-customers');
  if (USE_REAL_DATA && authState.user && customers.length > 0) {
    tbl.innerHTML = `<thead><tr><th>排名</th><th>客户名称</th><th>订单次数</th><th>累计消费</th><th>最近下单</th><th>标签</th></tr></thead>
    <tbody>${customers.map((c, i) => {
      const lastStr = c.lastOrder ? `${c.lastOrder.getMonth() + 1}/${c.lastOrder.getDate()}` : '-';
      return `<tr>
        <td><strong>#${i + 1}</strong></td>
        <td>${escHtml(c.id)}</td>
        <td>${c.orders} 次</td>
        <td>${fmt(c.spend)}</td>
        <td>${lastStr}</td>
        <td>${c.tag ? `<span class="badge b-purple">${c.tag}</span>` : '-'}</td>
      </tr>`;
    }).join('')}</tbody>`;
  } else {
    tbl.innerHTML = `<thead><tr><th>排名</th><th>用户ID</th><th>订单次数</th><th>累计消费</th><th>最近下单</th><th>标签</th><th>操作</th></tr></thead>
    <tbody>${CUSTOMERS.map(c => `<tr>
      <td><strong>#${c.rank}</strong></td>
      <td style="font-family:monospace">${c.id}</td>
      <td>${c.orders} 次</td>
      <td>${fmt(c.spend)}</td>
      <td>${c.lastOrder}</td>
      <td>${c.tag ? `<span class="badge b-purple">${c.tag}</span>` : '-'}</td>
      <td><button class="btn-icon" title="编辑标签" onclick="editCustomerTag('${c.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button></td>
    </tr>`).join('')}</tbody>`;
  }

  // New vs old pie
  dc('c-new-old');
  const ctx = document.getElementById('c-new-old').getContext('2d');
  const totalCust = newCount + oldCount || 1;
  charts['c-new-old'] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['新客', '老客'], datasets: [{ data: [newCount, oldCount], backgroundColor: ['#4F6BED', '#22C55E'], borderWidth: 0, hoverOffset: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '58%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 10 } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} 人 (${((ctx.raw / totalCust) * 100).toFixed(1)}%)` } } } }
  });

  // User trend (new vs returning by day)
  dc('c-user-trend');
  const ctx2 = document.getElementById('c-user-trend').getContext('2d');
  let trendLabels = ['6/16', '6/17', '6/18', '6/19', '6/20', '6/21', '6/22'];
  let newData = [32, 28, 45, 29, 52, 38, 41];
  let oldData = [68, 72, 91, 74, 98, 82, 67];
  if (orders.length) {
    const dayCustMap = new Map();
    for (const o of orders) {
      const t = parseOrderTime(o.order_time);
      if (!t) continue;
      const key = `${t.getMonth() + 1}/${t.getDate()}`;
      if (!dayCustMap.has(key)) dayCustMap.set(key, { newC: 0, oldC: 0 });
      const d = dayCustMap.get(key);
      if (o.is_new_customer) d.newC++; else d.oldC++;
    }
    const sorted = [...dayCustMap.keys()].sort((a, b) => {
      const [am, ad] = a.split('/'), [bm, bd] = b.split('/');
      return parseInt(am) * 100 + parseInt(ad) - (parseInt(bm) * 100 + parseInt(bd));
    });
    if (sorted.length) {
      trendLabels = sorted;
      newData = sorted.map(k => dayCustMap.get(k).newC);
      oldData = sorted.map(k => dayCustMap.get(k).oldC);
    }
  }
  charts['c-user-trend'] = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: trendLabels,
      datasets: [
        { label: '新客', data: newData, backgroundColor: '#4F6BED', borderRadius: 4, stack: 's' },
        { label: '老客', data: oldData, backgroundColor: '#22C55E', borderRadius: 4, stack: 's' },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { size: 10 } } } } }
  });

  // Price distribution (from estimated_income)
  dc('c-price-dist');
  const ctx3 = document.getElementById('c-price-dist').getContext('2d');
  const priceBins = [0, 15, 25, 35, 50, 80, Infinity];
  const priceLabels = ['0-15元', '15-25元', '25-35元', '35-50元', '50-80元', '80元+'];
  const priceDist = [0, 0, 0, 0, 0, 0];
  for (const o of orders) {
    const v = o.estimated_income || 0;
    for (let i = 0; i < priceBins.length - 1; i++) {
      if (v >= priceBins[i] && v < priceBins[i + 1]) { priceDist[i]++; break; }
    }
  }
  const hasPriceData = orders.length > 0;
  charts['c-price-dist'] = new Chart(ctx3, {
    type: 'bar',
    data: { labels: priceLabels, datasets: [{ data: hasPriceData ? priceDist : [42, 128, 218, 195, 120, 60], backgroundColor: '#4F6BED', borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { size: 10 } } } } }
  });

  // Order frequency distribution
  dc('c-dist-dist');
  const ctx4 = document.getElementById('c-dist-dist').getContext('2d');
  const freqLabels = ['1单', '2单', '3单', '4单', '5单+'];
  const freqDist = [0, 0, 0, 0, 0];
  if (orders.length) {
    const custFreq = new Map();
    for (const o of orders) {
      const name = o.customer_name || '未知';
      custFreq.set(name, (custFreq.get(name) || 0) + 1);
    }
    for (const count of custFreq.values()) {
      if (count <= 1) freqDist[0]++;
      else if (count <= 2) freqDist[1]++;
      else if (count <= 3) freqDist[2]++;
      else if (count <= 4) freqDist[3]++;
      else freqDist[4]++;
    }
  }
  charts['c-dist-dist'] = new Chart(ctx4, {
    type: 'bar',
    data: { labels: freqLabels, datasets: [{ data: orders.length ? freqDist : [180, 245, 168, 95, 75], backgroundColor: '#10B981', borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { size: 10 } } } } }
  });
}

function editCustomerTag(id){
  const c = CUSTOMERS.find(x => x.id === id);
  if (!c) return;
  const newTag = prompt('编辑客户标签\n\n客户: ' + c.id + '\n当前标签: ' + (c.tag || '无'), c.tag || '');
  if (newTag === null) return;
  c.tag = newTag.trim();
  renderUsers();
}

// ========= ORDERS PAGE =========
async function renderOrders(){
  let orders = [];

  if (USE_REAL_DATA && authState.user) {
    try { orders = await getFilteredOrders(); } catch (e) { console.warn('Orders analytics failed:', e); }
  }

  // Order trend by day, split by platform
  dc('c-order-trend');
  const ctx = document.getElementById('c-order-trend').getContext('2d');
  let trendLabels = ['6/16', '6/17', '6/18', '6/19', '6/20', '6/21', '6/22'];
  let mtData = [152, 138, 178, 141, 198, 162, 182];
  let tbData = [130, 130, 156, 120, 176, 141, 160];
  if (orders.length) {
    const dayPlatMap = new Map();
    for (const o of orders) {
      const t = parseOrderTime(o.order_time);
      if (!t) continue;
      const key = `${t.getMonth() + 1}/${t.getDate()}`;
      if (!dayPlatMap.has(key)) dayPlatMap.set(key, { mt: 0, tb: 0, other: 0 });
      const d = dayPlatMap.get(key);
      if (o.platform === 'meituan') d.mt++;
      else if (o.platform === 'taobao') d.tb++;
      else d.other++;
    }
    const sorted = [...dayPlatMap.keys()].sort((a, b) => {
      const [am, ad] = a.split('/'), [bm, bd] = b.split('/');
      return parseInt(am) * 100 + parseInt(ad) - (parseInt(bm) * 100 + parseInt(bd));
    });
    if (sorted.length) {
      trendLabels = sorted;
      mtData = sorted.map(k => dayPlatMap.get(k).mt);
      tbData = sorted.map(k => dayPlatMap.get(k).tb);
    }
  }
  charts['c-order-trend'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trendLabels,
      datasets: [
        { label: '美团外卖', data: mtData, borderColor: '#4F6BED', borderWidth: 2, tension: 0.4, pointRadius: 3, fill: false, pointBackgroundColor: '#4F6BED' },
        { label: '淘宝闪购', data: tbData, borderColor: '#10B981', borderWidth: 2, tension: 0.4, pointRadius: 3, fill: false, pointBackgroundColor: '#10B981' },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 12 } } }, scales: { y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { size: 10 } } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } } }
  });

  // Hourly distribution
  dc('c-hourly');
  const ctx2 = document.getElementById('c-hourly').getContext('2d');
  const hourLabels = Array.from({ length: 24 }, (_, i) => i + ':00');
  const hourlyData = new Array(24).fill(0);
  for (const o of orders) {
    const t = parseOrderTime(o.order_time);
    if (t) hourlyData[t.getHours()]++;
  }
  const hasHourlyData = orders.length > 0;
  const mockHourly = [0, 0, 2, 3, 12, 28, 65, 82, 95, 72, 55, 62, 88, 72, 48, 38, 32, 45, 68, 85, 92, 78, 52, 18];
  const displayHourly = hasHourlyData ? hourlyData : mockHourly;
  const maxVal = Math.max(...displayHourly);
  charts['c-hourly'] = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: hourLabels,
      datasets: [{
        data: displayHourly,
        backgroundColor: displayHourly.map(v => {
          const ratio = v / maxVal;
          if (ratio > 0.8) return '#EF4444';
          if (ratio > 0.5) return '#F59E0B';
          if (ratio > 0.2) return '#4F6BED';
          return '#CBD5E1';
        }),
        borderRadius: 4,
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.raw} 单` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } }, y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { size: 10 } } } } }
  });
}

// ========= PRODUCTS PAGE =========
async function renderProducts(){
  // Product aggregation
  const prodMap = new Map(); // name → { qty, revenue, cost, costKnown }
  let productData = [];
  let useReal = false;

  if (USE_REAL_DATA && authState.user) {
    try {
      const orders = await getFilteredOrders();
      if (orders.length) {
        useReal = true;
        const mappings = await apiFetchMappings();
        const dishes = await apiFetchDishes();

        // Build mappingMap: "platform|||platform_dish_name" → dish_id
        const mappingMap = {};
        for (const m of mappings) {
          if (m.status === 'confirmed' && m.dish_id) {
            mappingMap[`${m.platform}|||${m.platform_dish_name}`] = m.dish_id;
          }
        }
        // Build dishMap: dish_id → cost_price
        const dishMap = {};
        for (const d of dishes) {
          dishMap[d.id] = d.cost || 0;
        }

        for (const o of orders) {
          const prods = o.order_products || [];
          for (const p of prods) {
            const name = p.name || '未知商品';
            const qty = p.quantity || 1;
            const revenue = p.total_price || (p.unit_price || 0) * qty;
            if (!prodMap.has(name)) prodMap.set(name, { qty: 0, revenue: 0, cost: 0, costKnown: false, platform: o.platform });
            const entry = prodMap.get(name);
            entry.qty += qty;
            entry.revenue += revenue;
            if (!entry.costKnown) {
              const key = `${o.platform}|||${name}`;
              const dishId = mappingMap[key];
              if (dishId && dishMap[dishId] > 0) {
                entry.cost = dishMap[dishId];
                entry.costKnown = true;
              }
            }
          }
        }
        productData = [...prodMap.entries()].map(([name, e]) => ({
          name,
          sales: e.qty,
          price: e.qty > 0 ? e.revenue / e.qty : 0,
          cost: e.cost,
          revenue: e.revenue,
          margin: e.revenue > 0 ? ((e.revenue - e.cost * e.qty) / e.revenue * 100) : 0,
          grossProfit: e.revenue - e.cost * e.qty
        }));
      }
    } catch (e) { console.warn('Products analytics failed:', e); }
  }

  // Fallback to mock
  if (!useReal) {
    productData = DISHES.map(d => ({
      name: d.name,
      sales: d.sales,
      price: d.price,
      cost: d.cost,
      revenue: d.price * d.sales,
      margin: (d.price - d.cost) / d.price * 100,
      grossProfit: (d.price - d.cost) * d.sales
    }));
  }

  const salesData = [...productData].sort((a, b) => b.sales - a.sales);
  const marginData = [...productData].filter(p => p.cost > 0).sort((a, b) => b.margin - a.margin);

  // Sales rank
  dc('c-sales-rank');
  const ctx = document.getElementById('c-sales-rank').getContext('2d');
  const showSales = salesData.length ? salesData.slice(0, 15) : DISHES.map(d => ({ name: d.name, sales: d.sales }));
  charts['c-sales-rank'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: showSales.map(d => d.name),
      datasets: [{ data: showSales.map(d => d.sales), backgroundColor: 'rgba(79,107,237,.75)', borderRadius: 4, borderSkipped: false }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `销量: ${ctx.raw} 份` } } }, scales: { x: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { size: 10 } } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } } }
  });

  // Margin rank
  dc('c-margin-rank');
  const ctx2 = document.getElementById('c-margin-rank').getContext('2d');
  const showMargin = marginData.length ? marginData.slice(0, 15) : DISHES.map(d => ({ name: d.name, margin: parseFloat(((d.price - d.cost) / d.price * 100).toFixed(1)) }));
  charts['c-margin-rank'] = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: showMargin.map(d => d.name),
      datasets: [{ data: showMargin.map(d => parseFloat(d.margin.toFixed(1))), backgroundColor: 'rgba(16,185,129,.75)', borderRadius: 4, borderSkipped: false }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `毛利率: ${ctx.raw}%` } } }, scales: { x: { max: 100, grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { size: 10 }, callback: v => v + '%' } }, y: { grid: { display: false }, ticks: { font: { size: 11 } } } } }
  });

  // Scatter
  dc('c-scatter');
  const ctx3 = document.getElementById('c-scatter').getContext('2d');
  const allVals = productData.length ? productData : DISHES.map(d => ({ name: d.name, sales: d.sales, margin: (d.price - d.cost) / d.price * 100, price: d.price }));
  const S = allVals.map(d => d.sales), M = allVals.map(d => d.margin);
  const medSales = S.length ? S.sort((a, b) => a - b)[Math.floor(S.length / 2)] : 230;
  const medMargin = M.length ? M.sort((a, b) => a - b)[Math.floor(M.length / 2)] : 50;
  const scatterData = allVals.map(d => {
    let color;
    if (d.sales >= medSales && d.margin >= medMargin) color = 'rgba(34,197,94,.8)';
    else if (d.sales >= medSales && d.margin < medMargin) color = 'rgba(245,158,11,.8)';
    else if (d.sales < medSales && d.margin >= medMargin) color = 'rgba(79,107,237,.8)';
    else color = 'rgba(239,68,68,.8)';
    return { x: d.sales, y: parseFloat(d.margin.toFixed(1)), r: Math.sqrt((d.price || 30) * d.sales / 500) * 4, color, label: d.name };
  });
  charts['c-scatter'] = new Chart(ctx3, {
    type: 'bubble',
    data: { datasets: scatterData.map(d => ({ label: d.label, data: [{ x: d.x, y: d.y, r: Math.max(d.r, 8) }], backgroundColor: d.color, borderColor: 'rgba(0,0,0,.1)', borderWidth: 1 })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: 销量${ctx.raw.x}份, 毛利率${ctx.raw.y}%` } } },
      scales: {
        x: { title: { display: true, text: '销量（份）', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,.05)' }, ticks: { font: { size: 10 } } },
        y: { title: { display: true, text: '毛利率（%）', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,.05)', drawBorder: false }, ticks: { font: { size: 10 }, callback: v => v + '%' }, min: 0, max: 100 }
      }
    }
  });

  // Contribution pie
  dc('c-contrib');
  const ctx4 = document.getElementById('c-contrib').getContext('2d');
  const sortedByGP = [...allVals].sort((a, b) => b.grossProfit - a.grossProfit);
  const topProducts = sortedByGP.slice(0, 6);
  const otherGP = sortedByGP.slice(6).reduce((s, d) => s + d.grossProfit, 0);
  charts['c-contrib'] = new Chart(ctx4, {
    type: 'doughnut',
    data: {
      labels: [...topProducts.map(d => d.name), '其他'],
      datasets: [{ data: [...topProducts.map(d => d.grossProfit), otherGP], backgroundColor: ['#4F6BED', '#22C55E', '#F59E0B', '#EF4444', '#7C3AED', '#0EA5E9', '#9CA3AF'], borderWidth: 0, hoverOffset: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '52%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 6 } } } }
  });
}

// ========= DISHES PAGE =========
let dishFilter={search:'',cat:'',status:'',store:''};
let dishPage=1;
const dishPerPage=7;

let dishesData = [];

async function renderDishes(){
  try {
    if (USE_REAL_DATA && authState.user) {
      dishesData = await apiFetchDishes();
    } else {
      dishesData = DISHES;
    }
  } catch(e) { console.warn('Fetch dishes failed:', e); dishesData = DISHES; }

  let data = dishesData.filter(d=>{
    if(dishFilter.search && !d.name.includes(dishFilter.search)) return false;
    if(dishFilter.cat && d.cat !== dishFilter.cat) return false;
    if(dishFilter.status && d.status !== dishFilter.status) return false;
    if(dishFilter.store && String(d.store_id) !== String(dishFilter.store)) return false;
    return true;
  });
  const total = data.length;
  const pages = Math.ceil(total/dishPerPage);
  const start = (dishPage-1)*dishPerPage;
  const slice = data.slice(start,start+dishPerPage);
  document.getElementById('dish-count-lbl').textContent = `共 ${total} 条记录`;
  const tbody = document.getElementById('dish-tbody');
  tbody.innerHTML = slice.map(d=>{
    const margin = d.price > 0 ? ((d.price-d.cost)/d.price*100).toFixed(1) : '0.0';
    return `<tr>
      <td><input type="checkbox" style="accent-color:var(--primary);cursor:pointer"></td>
      <td><strong>${escHtml(d.name)}</strong></td>
      <td><span class="badge b-blue">${escHtml(d.cat)}</span></td>
      <td>¥${(d.cost||0).toFixed(2)}</td>
      <td>¥${(d.price||0).toFixed(2)}</td>
      <td><span style="color:${parseFloat(margin)>55?'#22C55E':parseFloat(margin)>40?'#F59E0B':'#EF4444'};font-weight:600">${margin}%</span></td>
      <td><span class="badge ${d.status==='上架'?'b-green':'b-gray'}">${d.status}</span></td>
      <td style="font-size:11.5px;color:var(--t2)">${escHtml(d.store||'')}</td>
      <td>
        <button class="btn-icon" title="编辑" onclick="editDish(${d.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-icon" title="成本历史" onclick="showCostHistory('${escHtml(d.name)}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></button>
        <button class="btn-icon" title="删除" style="color:#EF4444" onclick="deleteDish(${d.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
      </td>
    </tr>`;
  }).join('');

  // Pagination
  const pgEl=document.getElementById('dish-pagination');
  let pgHtml='';
  for(let i=1;i<=pages;i++){pgHtml+=`<button class="pg-btn${i===dishPage?' active':''}" data-pg="${i}">${i}</button>`;}
  pgEl.innerHTML=pgHtml;
  pgEl.querySelectorAll('.pg-btn').forEach(b=>b.addEventListener('click',async()=>{dishPage=parseInt(b.dataset.pg);await renderDishes();}));
  }

  // Update dish suggestion lists
  const dl = document.getElementById('mm-dish-suggestions');
  if (dl) dl.innerHTML = dishesData.map(d => `<option value="${escHtml(d.name)}">`).join('');

// ========= IMPORT PAGE =========
let mappingEditingId = null;
let importPreviewData = [];

let mappingsData = [];

async function renderImport(){
  await renderMapping();
  await renderStatusOverview();
}

async function renderMapping(){
  const tbody = document.getElementById('mapping-tbody');
  if(!tbody)return;
  try {
    if (USE_REAL_DATA && authState.user) {
      mappingsData = await apiFetchMappings();
    } else {
      mappingsData = DISH_MAPPINGS;
    }
  } catch(e) { console.warn('Fetch mappings failed:', e); mappingsData = DISH_MAPPINGS; }

  const cat = document.getElementById('map-cat-filter')?.value || 'all';
  const plat = document.getElementById('map-plat-filter')?.value || 'all';
  const search = (document.getElementById('map-search')?.value || '').toLowerCase();
  let data = mappingsData.filter(m => {
    if(cat !== 'all' && m.category !== cat && m.dishes?.category !== cat) return false;
    if(plat !== 'all' && m.platform !== plat) return false;
    if(search && !m.platformName.toLowerCase().includes(search) && !m.ownName.toLowerCase().includes(search)) return false;
    return true;
  });
  document.getElementById('mapping-count').textContent = data.length + '条';
  const platLabel = p => p === 'meituan' ? '美团外卖' : '淘宝闪购';
  const platBadge = p => p === 'meituan' ? 'b-blue' : 'b-purple';
  tbody.innerHTML = data.map(m => `
    <tr>
      <td><span class="badge ${platBadge(m.platform)}">${platLabel(m.platform)}</span></td>
      <td><strong>${escHtml(m.platformName)}</strong></td>
      <td style="text-align:center;color:var(--t3)">→</td>
      <td><strong>${escHtml(m.ownName || '未关联')}</strong></td>
      <td><span class="badge b-gray">${m.category || m.dishes?.category || ''}</span></td>
      <td style="font-weight:600;color:${m.matchCount>0?'var(--primary)':'var(--t3)'}">${m.matchCount || 0}</td>
      <td>
        <button class="btn-icon" title="编辑" onclick="editMapping(${m.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-icon" title="删除" style="color:#EF4444" onclick="deleteMapping(${m.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
      </td>
    </tr>
  `).join('');
}

function escHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function openMappingModal(platform, platformName){
  mappingEditingId = null;
  document.getElementById('mapping-modal-title').textContent = '新增菜品映射';
  document.getElementById('mm-platform').value = platform || 'meituan';
  document.getElementById('mm-platform-name').value = platformName || '';
  document.getElementById('mm-own-name').value = '';
  document.getElementById('mm-category').value = '主食';
  const dl = document.getElementById('mm-dish-suggestions');
  dl.innerHTML = dishesData.map(d => `<option value="${d.name}">`).join('');
  document.getElementById('mapping-modal').classList.add('open');
}

function editMapping(id){
  const m = mappingsData.find(x => x.id === id);
  if(!m)return;
  mappingEditingId = id;
  document.getElementById('mapping-modal-title').textContent = '编辑菜品映射';
  document.getElementById('mm-platform').value = m.platform;
  document.getElementById('mm-platform-name').value = m.platformName;
  document.getElementById('mm-own-name').value = m.ownName || '';
  document.getElementById('mm-category').value = m.category || m.dishes?.category || '主食';
  const dl = document.getElementById('mm-dish-suggestions');
  dl.innerHTML = dishesData.map(d => `<option value="${d.name}">`).join('');
  document.getElementById('mapping-modal').classList.add('open');
}

async function saveMapping(){
  const platform = document.getElementById('mm-platform').value;
  const platformName = document.getElementById('mm-platform-name').value.trim();
  const ownName = document.getElementById('mm-own-name').value.trim();
  const category = document.getElementById('mm-category').value;
  if(!platformName){ alert('请输入平台菜品名 (K)'); return; }
  if(!ownName){ alert('请输入自有标准菜品名 (V)'); return; }

  if(USE_REAL_DATA && authState.user){
    try {
      const dish = dishesData.find(d => d.name === ownName);
      if(mappingEditingId){
        await apiUpdateMapping(mappingEditingId, {
          platform, platform_dish_name: platformName,
          dish_id: dish ? dish.id : null, status: dish ? 'manual' : 'pending'
        });
      } else {
        await apiCreateMapping({
          platform, platform_dish_name: platformName,
          dish_id: dish ? dish.id : null, status: dish ? 'manual' : 'pending'
        });
      }
    } catch(e) { alert('保存失败：' + (e.message||e)); return; }
  } else {
    if(mappingEditingId){
      const m = DISH_MAPPINGS.find(x => x.id === mappingEditingId);
      if(m){ m.platform = platform; m.platformName = platformName; m.ownName = ownName; m.category = category; }
    } else {
      const newId = Math.max(0, ...DISH_MAPPINGS.map(x => x.id)) + 1;
      DISH_MAPPINGS.push({ id: newId, platform, platformName, ownName, category, matchCount: 0 });
    }
  }
  mappingEditingId = null;
  closeModal('mapping-modal');
  await renderMapping();
  await renderStatusOverview();
}

async function deleteMapping(id){
  if(!confirm('确认删除此映射？删除后相关订单将无法自动关联。')) return;
  if(USE_REAL_DATA && authState.user){
    try { await apiDeleteMapping(id); } catch(e) { alert('删除失败：'+(e.message||e)); return; }
  } else {
    const idx = DISH_MAPPINGS.findIndex(x => x.id === id);
    if(idx >= 0) DISH_MAPPINGS.splice(idx, 1);
  }
  await renderMapping();
  await renderStatusOverview();
}

function handleFileImport(event){
  const file = event.target.files[0];
  if(!file)return;
  const reader = new FileReader();
  reader.onload = function(e){
    const text = e.target.result;
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if(lines.length < 2){ alert('文件为空或格式不正确'); return; }
    // Detect platform from filename or first line
    const fn = file.name.toLowerCase();
    const platform = fn.includes('meituan') || fn.includes('美团') ? 'meituan' : 'taobao';
    // Parse header and rows
    const header = lines[0].split(/[,\t]/).map(h => h.trim().replace(/^"|"$/g,''));
    const nameIdx = header.findIndex(h => h.includes('菜') || h.includes('品') || h.includes('名'));
    const priceIdx = header.findIndex(h => h.includes('价') || h.includes('售'));
    const salesIdx = header.findIndex(h => h.includes('量') || h.includes('销'));
    importPreviewData = [];
    for(let i = 1; i < lines.length; i++){
      const cols = lines[i].split(/[,\t]/).map(c => c.trim().replace(/^"|"$/g,''));
      const pname = nameIdx >= 0 ? cols[nameIdx] : cols[0];
      if(!pname || pname === '菜品名' || pname.includes('合计')) continue;
      importPreviewData.push({
        platform,
        platformName: pname,
        price: priceIdx >= 0 ? parseFloat(cols[priceIdx]) || 0 : 0,
        sales: salesIdx >= 0 ? parseInt(cols[salesIdx]) || 0 : 0,
        ownName: pname.replace(/[（(].*?[）)]/g,'').replace(/【.*?】/g,'').trim(),
        category: '主食'
      });
    }
    document.getElementById('import-preview').style.display = 'block';
    renderImportPreview();
  };
  reader.readAsText(file, 'UTF-8');
}

function renderImportPreview(){
  const tbody = document.getElementById('import-preview-tbody');
  if(!tbody)return;
  const platLabel = p => p === 'meituan' ? '美团外卖' : '淘宝闪购';
  const platBadge = p => p === 'meituan' ? 'b-blue' : 'b-purple';
  tbody.innerHTML = importPreviewData.map((d, i) => `
    <tr>
      <td><span class="badge ${platBadge(d.platform)}">${platLabel(d.platform)}</span></td>
      <td>${escHtml(d.platformName)}</td>
      <td>¥${d.price.toFixed(2)}</td>
      <td>${d.sales}</td>
      <td><input type="text" value="${escHtml(d.ownName)}" data-idx="${i}" class="pv-own-name" style="width:100%;border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:12px"></td>
      <td><select data-idx="${i}" class="pv-cat" style="border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:12px"><option>主食</option><option>小吃</option><option>饮品</option><option>套餐</option><option>甜品</option></select></td>
    </tr>
  `).join('');
}

async function batchCreateMappings(){
  if(!importPreviewData.length){ alert('没有可导入的数据'); return; }
  // Read user-edited values from DOM
  document.querySelectorAll('.pv-own-name').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    if(idx >= 0 && idx < importPreviewData.length) importPreviewData[idx].ownName = inp.value.trim();
  });
  document.querySelectorAll('.pv-cat').forEach(sel => {
    const idx = parseInt(sel.dataset.idx);
    if(idx >= 0 && idx < importPreviewData.length) importPreviewData[idx].category = sel.value;
  });
  let created = 0;
  if(USE_REAL_DATA && authState.user){
    for(const d of importPreviewData){
      if(!d.ownName) continue;
      try {
        // Find dish by ownName for dish_id
        const dish = dishesData.find(dish => dish.name === d.ownName);
        // Check if mapping already exists
        const exists = mappingsData.some(m => m.platform === d.platform && m.platformName === d.platformName);
        if(exists) continue;
        await apiCreateMapping({
          platform: d.platform,
          platform_dish_name: d.platformName,
          dish_id: dish ? dish.id : null,
          status: dish ? 'manual' : 'pending'
        });
        created++;
      } catch(e) { console.warn('Create mapping failed:', d.platformName, e); }
    }
  } else {
    const maxId = Math.max(0, ...DISH_MAPPINGS.map(x => x.id));
    importPreviewData.forEach((d, i) => {
      if(!d.ownName) return;
      const exists = DISH_MAPPINGS.some(m => m.platform === d.platform && m.platformName === d.platformName);
      if(exists) return;
      DISH_MAPPINGS.push({ id: maxId + created + 1, platform: d.platform, platformName: d.platformName, ownName: d.ownName, category: d.category, matchCount: d.sales });
      created++;
    });
  }
  importPreviewData = [];
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-file-input').value = '';
  await renderMapping();
  await renderStatusOverview();
  alert(`已成功创建 ${created} 条 KV 映射`);
}

async function renderStatusOverview(){
  const stats = document.getElementById('mapping-stats');
  if(!stats)return;
  let totalOrders = 2145, mappedOrders = 0, unmappedOrders = 0, coverage = '0.0';
  try {
    if(USE_REAL_DATA && authState.user){
      // Fetch all mappings for stats
      const allMappings = await apiFetchMappings();
      mappedOrders = allMappings.reduce((s, m) => s + (m.matchCount || 0), 0);
      // Try to get total orders from orders table
      try {
        const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
        totalOrders = count || 0;
      } catch(e) { /* use fallback */ }
      unmappedOrders = Math.max(0, totalOrders - mappedOrders);
      coverage = totalOrders > 0 ? ((mappedOrders / totalOrders) * 100).toFixed(1) : '0.0';
    } else {
      mappedOrders = DISH_MAPPINGS.reduce((s, m) => s + m.matchCount, 0);
      unmappedOrders = totalOrders - mappedOrders;
      coverage = totalOrders > 0 ? ((mappedOrders / totalOrders) * 100).toFixed(1) : '0.0';
    }
  } catch(e) { console.warn('Status overview fetch failed:', e); }

  stats.innerHTML = `
    <div class="kpi"><div class="kpi-num">${totalOrders.toLocaleString()}</div><div class="kpi-lbl">近30天订单总数</div></div>
    <div class="kpi"><div class="kpi-num" style="color:#22C55E">${mappedOrders.toLocaleString()}</div><div class="kpi-lbl">已映射订单</div></div>
    <div class="kpi"><div class="kpi-num" style="color:${unmappedOrders>0?'#EF4444':'#22C55E'}">${unmappedOrders.toLocaleString()}</div><div class="kpi-lbl">未映射订单</div></div>
    <div class="kpi"><div class="kpi-num" style="color:${parseFloat(coverage)>80?'#22C55E':parseFloat(coverage)>50?'#F59E0B':'#EF4444'}">${coverage}%</div><div class="kpi-lbl">映射覆盖率</div></div>
  `;

  // Show pending mappings after stats
  const pendingSection = document.getElementById('pending-mappings-section');
  if(pendingSection){
    try {
      let pending = [];
      if(USE_REAL_DATA && authState.user){
        pending = await apiFetchPendingMappings();
      } else {
        pending = MATCH_PENDING;
      }
      if(pending.length > 0){
        pendingSection.style.display = 'block';
        pendingSection.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h4 style="margin:0;font-size:13px;color:var(--t1)">待关联平台商品 (${pending.length}个)</h4>
            <button class="btn-sm btn-primary" onclick="autoExtractProducts()" id="btn-auto-extract">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
              自动提取
            </button>
          </div>
          ${USE_REAL_DATA && authState.user ? pending.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;margin-bottom:6px;background:var(--bg);border:1px solid var(--border2);border-radius:6px">
              <div style="flex:1">
                <span class="badge ${p.platform==='meituan'?'b-blue':'b-purple'}">${p.platform==='meituan'?'美团':'淘宝'}</span>
                <strong style="margin-left:8px;font-size:12.5px">${escHtml(p.platformName || p.src)}</strong>
                <span style="margin-left:8px;font-size:11px;color:var(--t3)">出现 ${p.order_count || 0} 次</span>
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn-sm btn-primary" onclick="quickMapPending('${escHtml((p.platformName||p.src||''))}','${p.platform||''}')">关联</button>
                <button class="btn-sm btn-outline" onclick="quickIgnorePending(${p.id})">忽略</button>
              </div>
            </div>
          `).join('') : pending.map(p => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;margin-bottom:6px;background:var(--bg);border:1px solid var(--border2);border-radius:6px">
              <span><span class="badge b-gray">${p.plat||''}</span><strong style="margin-left:8px">${escHtml(p.src)}</strong></span>
            </div>
          `).join('')}
        `;
      } else {
        pendingSection.style.display = 'none';
      }
    } catch(e) { console.warn('Pending mappings render failed:', e); }
  }
}

async function autoExtractProducts(){
  const btn = document.getElementById('btn-auto-extract');
  if(btn){ btn.disabled = true; btn.textContent = '提取中...'; }
  try {
    await apiAutoExtractProducts();
    await renderStatusOverview();
  } catch(e) { alert('自动提取失败：' + (e.message||e)); }
  if(btn){ btn.disabled = false; btn.textContent = '自动提取'; }
}

async function quickMapPending(platformName, platform){
  openMappingModal(platform, platformName);
}

async function quickIgnorePending(id){
  if(!confirm('确认忽略此商品？')) return;
  if(USE_REAL_DATA && authState.user){
    try { await apiIgnoreMapping(id); } catch(e) { alert('操作失败：'+(e.message||e)); return; }
  }
  await renderStatusOverview();
}

// ========= COSTS PAGE =========
let costsData = { income: 24850, cogs: 10388, opCosts: {} };

async function renderCosts(){
  if(USE_REAL_DATA && authState.user){
    try {
      // Fetch today's daily costs
      const today = new Date().toISOString().split('T')[0];
      const storeId = (state.store && state.store !== 'all') ? state.store : null;
      const data = await apiFetchDailyCosts(storeId, today);
      if(data && data.length > 0 && data[0].daily_op_cost_items){
        const items = data[0].daily_op_cost_items;
        costsData.opCosts = {};
        items.forEach(item => {
          costsData.opCosts[item.category] = (costsData.opCosts[item.category] || 0) + item.amount;
        });
        // Populate form fields
        const promoEl = document.getElementById('c-promo');
        const bwcEl = document.getElementById('c-bwc');
        const bigEl = document.getElementById('c-big');
        const otherEl = document.getElementById('c-other');
        if(promoEl) promoEl.value = costsData.opCosts.promotion || '';
        if(bwcEl) bwcEl.value = costsData.opCosts.bawangcan || '';
        if(bigEl) bigEl.value = costsData.opCosts.subsidy || '';
        if(otherEl) otherEl.value = costsData.opCosts.other || '';
        // Load custom items
        const customWrap = document.getElementById('cost-custom-rows');
        if(customWrap && items.length > 0){
          customCostCount = 0;
          customWrap.innerHTML = items
            .filter(item => !['promotion','bawangcan','subsidy','other'].includes(item.category))
            .map(item => {
              customCostCount++;
              return `
                <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-top:8px;align-items:flex-end">
                  <div class="fg"><label>成本名称</label><input class="f-input" type="text" value="${escHtml(item.name||'')}" data-cost-name></div>
                  <div class="fg"><label>金额（元）</label><input class="f-input" type="number" value="${item.amount||0}" data-cost-amount></div>
                  <button class="btn-icon" style="color:#EF4444;margin-bottom:2px" onclick="this.parentElement.remove()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>`;
            }).join('');
        }
      }
    } catch(e) { console.warn('Fetch daily costs failed:', e); }
  }
  updateCostSummary();
  ['c-promo','c-bwc','c-big','c-other'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', updateCostSummary);
  });
}

function getOpCost(){
  const p = parseFloat(document.getElementById('c-promo')?.value) || 0;
  const b = parseFloat(document.getElementById('c-bwc')?.value) || 0;
  const big = parseFloat(document.getElementById('c-big')?.value) || 0;
  const o = parseFloat(document.getElementById('c-other')?.value) || 0;
  return p + b + big + o;
}

function updateCostSummary(){
  const income = costsData.income;
  const cogs = costsData.cogs;
  const op = getOpCost();
  const fix = dailyFixedTotal || 2100;
  const gross = income - cogs;
  const net = gross - op - fix;
  const rows = [
    {label:'营业收入（今日）',amt:income,color:'#4F6BED',deduct:false},
    {label:'减：菜品成本',amt:cogs,color:'#EF4444',deduct:true},
    {label:'= 毛利',amt:gross,color:'#10B981',deduct:false,bold:true},
    {label:'减：运营成本（已录入）',amt:op,color:'#F59E0B',deduct:true},
    {label:'减：固定成本日摊',amt:fix,color:'#F59E0B',deduct:true},
    {label:'= 预估净利',amt:net,color:net>0?'#22C55E':'#EF4444',deduct:false,bold:true},
  ];
  const el = document.getElementById('cost-summary-rows');
  if(!el)return;
  el.innerHTML = rows.map(r=>`
    <div class="wf-row" style="margin-bottom:6px">
      <div class="wf-row-lbl" style="${r.bold?'font-weight:700;font-size:12.5px;color:var(--t1)':'font-size:11.5px'}">${r.label}</div>
      <div class="wf-row-amt" style="color:${r.deduct?'#EF4444':r.color};font-weight:${r.bold?'700':'500'};font-size:${r.bold?'14':'13'}px">
        ${r.deduct?'-':''}${fmt(r.amt)}
      </div>
    </div>
  `).join('');
}

// ========= FIXED COSTS PAGE =========
let fixedCostsData = [];
let dailyFixedTotal = 2100;

async function renderFixed(){
  const list = document.getElementById('fixed-cost-list');
  if(!list)return;
  try {
    if(USE_REAL_DATA && authState.user){
      const storeId = (state.store && state.store !== 'all') ? state.store : null;
      fixedCostsData = await apiFetchFixedCosts(storeId);
    } else {
      fixedCostsData = FIXED_COSTS;
    }
  } catch(e) { console.warn('Fetch fixed costs failed:', e); fixedCostsData = FIXED_COSTS; }
  const daysInMonth = getDaysInMonth();
  dailyFixedTotal = fixedCostsData.filter(f => f.active).reduce((s, f) => s + Math.round((f.monthly || 0) / daysInMonth), 0);

  list.innerHTML = fixedCostsData.map(fc => `
    <div class="ci">
      <div class="ci-info">
        <div class="ci-name">${fc.name}</div>
        <div class="ci-sub">${fc.store || ''} · 每日摊算 ${fmt(Math.round((fc.monthly || 0) / daysInMonth))}</div>
      </div>
      <div class="ci-right">
        <div class="ci-amt">${fmt(fc.monthly || 0)}/月</div>
        <div class="ci-actions">
          <button class="toggle ${fc.active ? 'on' : ''}" onclick="toggleFixedCost(${fc.id}, this)"></button>
          <button class="btn-icon" title="编辑" onclick="editFixedCost(${fc.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        </div>
      </div>
    </div>
  `).join('');

  const daily = document.getElementById('fixed-daily-list');
  if(daily){
    daily.innerHTML = fixedCostsData.filter(f => f.active).map(fc => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border2)">
        <span style="font-size:12px;color:var(--t2)">${fc.name}</span>
        <span style="font-size:12.5px;font-weight:600">${fmt(Math.round((fc.monthly || 0) / daysInMonth))}</span>
      </div>
    `).join('');
  }

  // Update chart if canvas exists
  const canvas = document.getElementById('c-fixed-month');
  if(canvas){
    if(charts['c-fixed-month']) charts['c-fixed-month'].destroy();
    const elapsed = new Date().getDate();
    const remaining = daysInMonth - elapsed;
    const activeCosts = fixedCostsData.filter(f => f.active);
    charts['c-fixed-month'] = new Chart(canvas.getContext('2d'), {
      type:'bar',
      data:{
        labels: activeCosts.map(f => f.name),
        datasets:[
          {label:'已产生',data: activeCosts.map(f => Math.round((f.monthly || 0) * elapsed / daysInMonth)), backgroundColor:'#4F6BED', borderRadius:4, stack:'s'},
          {label:'待产生',data: activeCosts.map(f => Math.round((f.monthly || 0) * remaining / daysInMonth)), backgroundColor:'#E5E7EB', borderRadius:4, stack:'s'},
        ]
      },
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:11},padding:8}}},scales:{x:{grid:{display:false},ticks:{font:{size:10}}},y:{grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:10},callback:v=>'¥'+v.toLocaleString()}}}}
    });
  }
}

async function toggleFixedCost(id, btn){
  const fc = fixedCostsData.find(f => f.id === id);
  if(!fc) return;
  const newActive = !fc.active;
  if(USE_REAL_DATA && authState.user){
    try { await apiUpdateFixedCost(id, { active: newActive }); } catch(e) { alert('操作失败：'+(e.message||e)); return; }
  }
  fc.active = newActive;
  btn.classList.toggle('on', newActive);
  await renderFixed();
}

async function editFixedCost(id){
  const fc = fixedCostsData.find(f => f.id === id);
  if(!fc) return;
  const newName = prompt('名称：', fc.name);
  if(newName === null) return;
  const newMonthly = prompt('月金额（元）：', fc.monthly);
  if(newMonthly === null) return;
  const monthly = parseFloat(newMonthly);
  if(isNaN(monthly) || monthly < 0){ alert('请输入有效金额'); return; }
  if(USE_REAL_DATA && authState.user){
    try { await apiUpdateFixedCost(id, { name: newName, monthly }); } catch(e) { alert('保存失败：'+(e.message||e)); return; }
  }
  fc.name = newName;
  fc.monthly = monthly;
  await renderFixed();
}

// ========= REPORTS PAGE =========
let reportType = 'daily';

async function renderReports(){
  const list = document.getElementById('report-list');
  if (!list) return;

  let reports = [];
  try {
    if (USE_REAL_DATA && authState.user) {
      const raw = await apiFetchAllOrdersWithProducts();
      if (raw.length) {
        // Generate daily reports from orders
        const dayMap = new Map();
        for (const o of raw) {
          const t = parseOrderTime(o.order_time);
          if (!t) continue;
          const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
          if (!dayMap.has(key)) dayMap.set(key, []);
          dayMap.get(key).push(o);
        }
        const mappings = await apiFetchMappings();
        const dishes = await apiFetchDishes();
        const mappingMap = {};
        for (const m of mappings) {
          if (m.status === 'confirmed' && m.dish_id) {
            mappingMap[`${m.platform}|||${m.platform_dish_name}`] = m.dish_id;
          }
        }
        const dishMap = {};
        for (const d of dishes) { dishMap[d.id] = d.cost || 0; }

        for (const [dateKey, dayOrders] of dayMap) {
          const income = dayOrders.reduce((s, o) => s + (o.estimated_income || 0), 0);
          const commission = dayOrders.reduce((s, o) => s + (o.commission_amount || 0), 0);
          const discount = dayOrders.reduce((s, o) => s + (o.order_discount || 0), 0);
          const subsidy = dayOrders.reduce((s, o) => s + (o.delivery_subsidy || 0), 0);
          const netIncome = income - commission - discount + subsidy;
          let cogs = 0;
          for (const o of dayOrders) {
            for (const p of (o.order_products || [])) {
              const qty = p.quantity || 1;
              const dishId = mappingMap[`${o.platform}|||${p.name}`];
              const cost = dishId ? (dishMap[dishId] || 0) : 0;
              cogs += qty * cost;
            }
          }
          const gross = netIncome - cogs;
          const orderCount = dayOrders.length;
          reports.push({
            id: 'd-' + dateKey,
            type: 'daily',
            date: dateKey,
            store: '全部店铺',
            income: Math.round(income * 100) / 100,
            gross: Math.round(gross * 100) / 100,
            net: Math.round((gross) * 100) / 100, // net before fixed costs
            orders: orderCount
          });
        }

        // Generate weekly report if enough data
        if (reports.length >= 7) {
          const last7 = reports.slice(-7);
          reports.push({
            id: 'w-latest',
            type: 'weekly',
            date: `${last7[0].date} ~ ${last7[last7.length - 1].date}`,
            store: '全部店铺',
            income: Math.round(last7.reduce((s, r) => s + r.income, 0) * 100) / 100,
            gross: Math.round(last7.reduce((s, r) => s + r.gross, 0) * 100) / 100,
            net: Math.round(last7.reduce((s, r) => s + r.net, 0) * 100) / 100,
            orders: last7.reduce((s, r) => s + r.orders, 0)
          });
        }

        reports.sort((a, b) => b.date.localeCompare(a.date));
      }
    }
  } catch (e) { console.warn('Reports generation failed:', e); }

  // Fallback to mock
  if (!reports.length) reports = REPORTS;

  const filtered = reports.filter(r => r.type === reportType);
  list.innerHTML = filtered.map(r => `
    <div class="report-card" onclick="openReport('${r.id}')">
      <div class="rc-header">
        <div>
          <div class="rc-title">${r.type === 'daily' ? '📋 运营日报' : '📊 运营周报'} · ${r.date}</div>
          <div class="rc-date">${r.store}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-sm btn-outline" style="height:28px" onclick="event.stopPropagation();handleGlobalExport()">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>CSV
          </button>
        </div>
      </div>
      <div class="rc-kpis">
        <div class="rc-kpi"><strong>${fmt(r.income)}</strong>营业收入</div>
        <div class="rc-kpi"><strong style="color:#4F6BED">${fmt(r.gross)}</strong>毛利</div>
        <div class="rc-kpi"><strong style="color:#22C55E">${fmt(r.net)}</strong>净利</div>
        <div class="rc-kpi"><strong>${r.orders}</strong>订单数</div>
        <div class="rc-kpi"><strong>${pct(r.net, r.income)}</strong>净利率</div>
      </div>
    </div>
  `).join('');

  // Type tabs
  document.querySelectorAll('[data-rtype]').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.rtype === reportType);
    tab.onclick = () => { reportType = tab.dataset.rtype; renderReports(); };
  });
}

async function openReport(id){
  // Parse dynamic report ID: d-YYYY-MM-DD or w-latest
  let r = REPORTS.find(x => x.id === id);
  if (!r) {
    if (id.startsWith('d-')) {
      r = { id, type: 'daily', date: id.slice(2), store: '全部店铺', income: 0, gross: 0, net: 0, orders: 0 };
    } else if (id === 'w-latest') {
      r = { id, type: 'weekly', date: '', store: '全部店铺', income: 0, gross: 0, net: 0, orders: 0 };
    }
  }
  if (!r) return;

  // Try to compute real data
  let income = r.income, gross = r.gross, net = r.net, orders = r.orders;
  let topProducts = [{ name: '叉烧饭', sales: 60, change: '+8', up: true }, { name: '冰镇奶茶', sales: 54, change: '+12', up: true }, { name: '港式煲仔饭', sales: 35, change: '-5', up: false }];
  let costItems = [['推广费用', '¥1,500'], ['霸王餐补贴', '¥800'], ['大额订单补贴', '¥520']];
  let fixedItems = [['门店租金摊销', '¥387'], ['水电费摊销', '¥103'], ['人工成本摊销', '¥1,452'], ['设备折旧', '¥0（已暂停）']];

  try {
    if (USE_REAL_DATA && authState.user) {
      const raw = await apiFetchAllOrdersWithProducts();
      const dateStr = r.date;
      let dayOrders;
      if (r.type === 'daily') {
        dayOrders = raw.filter(o => {
          const t = parseOrderTime(o.order_time);
          if (!t) return false;
          return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` === dateStr;
        });
      } else {
        // Weekly: use all orders
        dayOrders = raw;
      }

      if (dayOrders.length) {
        income = dayOrders.reduce((s, o) => s + (o.estimated_income || 0), 0);
        const commission = dayOrders.reduce((s, o) => s + (o.commission_amount || 0), 0);
        const discount = dayOrders.reduce((s, o) => s + (o.order_discount || 0), 0);
        const subsidy = dayOrders.reduce((s, o) => s + (o.delivery_subsidy || 0), 0);
        const netInc = income - commission - discount + subsidy;

        const mappings = await apiFetchMappings();
        const dishes = await apiFetchDishes();
        const mappingMap = {};
        for (const m of mappings) { if (m.status === 'confirmed' && m.dish_id) mappingMap[`${m.platform}|||${m.platform_dish_name}`] = m.dish_id; }
        const dishMap = {};
        for (const d of dishes) { dishMap[d.id] = d.cost || 0; }

        let cogs = 0;
        const prodMap = new Map();
        for (const o of dayOrders) {
          for (const p of (o.order_products || [])) {
            const qty = p.quantity || 1;
            const rev = p.total_price || (p.unit_price || 0) * qty;
            const dishId = mappingMap[`${o.platform}|||${p.name}`];
            const cost = dishId ? (dishMap[dishId] || 0) : 0;
            cogs += qty * cost;
            if (!prodMap.has(p.name)) prodMap.set(p.name, 0);
            prodMap.set(p.name, prodMap.get(p.name) + qty);
          }
        }
        gross = netInc - cogs;
        net = gross; // before fixed costs

        const sortedProds = [...prodMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        if (sortedProds.length) {
          topProducts = sortedProds.map(([name, qty]) => ({ name, sales: qty, change: '', up: true }));
        }

        // Fetch real costs
        const dailyCosts = await apiFetchDailyCosts();
        const fixedCosts = await apiFetchFixedCosts();
        const daysInMonth = getDaysInMonth();
        if (dailyCosts.length) {
          costItems = [];
          for (const dc of dailyCosts) {
            for (const item of (dc.daily_op_cost_items || [])) {
              costItems.push([item.name || item.category, fmt(item.amount || 0)]);
            }
          }
        }
        const activeFixed = fixedCosts.filter(f => f.active);
        if (activeFixed.length) {
          fixedItems = activeFixed.map(f => [f.name, fmt(f.monthly / daysInMonth)]);
        }

        orders = dayOrders.length;
      }
    }
  } catch (e) { console.warn('Report detail failed:', e); }

  document.getElementById('report-modal-content').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div>
        <div style="font-size:16px;font-weight:700;margin-bottom:3px">${r.type === 'daily' ? '运营日报' : '运营周报'} · ${r.date}</div>
        <div style="font-size:11.5px;color:var(--t2)">${r.store} · 自动生成</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn-sm btn-outline" onclick="closeModal('report-modal')">关闭</button>
        <button class="btn-sm btn-primary" onclick="handleGlobalExport()">导出 CSV</button>
      </div>
    </div>
    <div class="kpi-grid" style="margin-bottom:16px">
      <div class="kpi"><div class="kpi-lbl">营业收入</div><div class="kpi-val">${fmt(income)}</div></div>
      <div class="kpi"><div class="kpi-lbl">毛利</div><div class="kpi-val" style="color:#4F6BED">${fmt(gross)}</div></div>
      <div class="kpi net"><div class="kpi-lbl">净利 <span class="kpi-rate">${pct(net, income)}</span></div><div class="kpi-val">${fmt(net)}</div></div>
      <div class="kpi"><div class="kpi-lbl">订单数</div><div class="kpi-val">${orders}</div></div>
    </div>
    <div class="detail-section">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:#F8F9FC;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--t2);margin-bottom:8px;font-weight:600">运营成本</div>
          ${costItems.map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0"><span>${k}</span><span style="font-weight:600">${v}</span></div>`).join('')}
          <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:6px 0 0;border-top:1px solid var(--border);margin-top:6px;font-weight:700"><span>合计</span><span>${fmt(costItems.reduce((s, [, v]) => {
            const n = parseFloat(v.replace(/[¥,]/g, ''));
            return s + (isNaN(n) ? 0 : n);
          }, 0))}</span></div>
        </div>
        <div style="background:#F8F9FC;border-radius:8px;padding:12px">
          <div style="font-size:11px;color:var(--t2);margin-bottom:8px;font-weight:600">固定成本日摊</div>
          ${fixedItems.map(([k, v]) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0"><span>${k}</span><span style="font-weight:600">${v}</span></div>`).join('')}
          <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:6px 0 0;border-top:1px solid var(--border);margin-top:6px;font-weight:700"><span>合计</span><span>${fmt(fixedItems.reduce((s, [, v]) => {
            const n = parseFloat(v.replace(/[¥,]/g, ''));
            return s + (isNaN(n) ? 0 : n);
          }, 0))}</span></div>
        </div>
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">🏆 近期 TOP 菜品</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${topProducts.map(d => `
          <div style="background:#F8F9FC;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:13px;font-weight:600">${d.name}</div>
            <div style="font-size:18px;font-weight:700;margin:4px 0">${d.sales}份</div>
            ${d.change ? `<span class="badge ${d.up ? 'b-green' : 'b-red'}">${d.change}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.getElementById('report-modal').classList.add('open');
}

async function generateReport(){
  const btn = event.target;
  const origHTML = btn.innerHTML;
  btn.textContent = '⏳ 分析中...';
  btn.disabled = true;
  try {
    await renderReports();
    const list = document.getElementById('report-list');
    if (!list) return;
    const firstCard = list.querySelector('.report-card');
    if (firstCard) {
      const onclick = firstCard.getAttribute('onclick');
      if (onclick) {
        const match = onclick.match(/openReport\('([^']+)'\)/);
        if (match) await openReport(match[1]);
      }
    }
  } catch (e) { console.warn('Generate report failed:', e); }
  btn.innerHTML = origHTML;
  btn.disabled = false;
}

// ========= MODALS =========
let dishEditingId = null; // null=新增, string=编辑

async function populateDmStoreDropdown() {
  const sel = document.getElementById('dm-store');
  if (!sel) return;
  sel.innerHTML = '';
  try {
    if (USE_REAL_DATA) {
      const stores = await apiFetchStores();
      stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        sel.appendChild(opt);
      });
    } else {
      // Mock stores
      ['旺角港式茶餐厅','尖沙咀麻辣烫'].forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
    }
  } catch (e) {
    console.warn('Populate dish modal store dropdown failed:', e);
  }
}

function editDish(id){
  const d = dishesData.find(x => x.id === id);
  if(!d) return;
  dishEditingId = id;
  document.getElementById('dish-modal-title').textContent = '编辑菜品';
  document.getElementById('dm-name').value = d.name || '';
  document.getElementById('dm-cat').value = d.cat || '主食';
  document.getElementById('dm-cost').value = d.cost || 0;
  document.getElementById('dm-price').value = d.price || 0;
  document.getElementById('dm-store').value = d.store_id || d.store || '';
  document.getElementById('dm-status').value = d.status || '上架';
  document.getElementById('dm-proc').value = d.proc || '';
  document.getElementById('dm-note').value = d.note || '';
  document.getElementById('dish-modal').classList.add('open');
}

async function openDishModal(){
  dishEditingId = null;
  document.getElementById('dish-modal-title').textContent = '新增菜品';
  ['dm-name','dm-cost','dm-price','dm-proc','dm-note'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('dm-cat').value='主食';
  document.getElementById('dm-status').value='上架';
  await populateDmStoreDropdown();
  // Default to current global store filter, or first store
  const sel = document.getElementById('dm-store');
  if (sel && sel.options.length > 0) {
    if (state.store && state.store !== 'all') {
      sel.value = state.store;
    }
  }
  document.getElementById('dish-modal').classList.add('open');
}

async function openFixedModal(){
  document.getElementById('fixed-modal').classList.add('open');
  // Clear form
  ['fm-name','fm-monthly','fm-category'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const catEl = document.getElementById('fm-category');
  if (catEl) catEl.value = 'other';
  // Populate store dropdown
  const sel = document.getElementById('fm-store');
  if (sel) {
    sel.innerHTML = '';
    try {
      if (USE_REAL_DATA) {
        const stores = await apiFetchStores();
        stores.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          sel.appendChild(opt);
        });
      }
    } catch(e) { console.warn('Populate fixed cost store dropdown failed:', e); }
    // Default to current store filter
    if (state.store && state.store !== 'all') {
      sel.value = state.store;
    }
  }
}
function closeModal(id){document.getElementById(id).classList.remove('open')}
async function saveDish(){
  const name=document.getElementById('dm-name').value.trim();
  const cat=document.getElementById('dm-cat').value;
  const cost=parseFloat(document.getElementById('dm-cost').value)||0;
  const price=parseFloat(document.getElementById('dm-price').value)||0;
  const storeVal=document.getElementById('dm-store').value;
  const status=document.getElementById('dm-status').value;
  const proc=document.getElementById('dm-proc').value.trim();
  const note=document.getElementById('dm-note').value.trim();
  if(!name){alert('请输入菜品名称');return;}

  if(USE_REAL_DATA && authState.user){
    try {
      if(dishEditingId){
        await apiUpdateDish(dishEditingId, {name, cat, cost, price, status, proc, note});
      } else {
        const store_id = parseInt(storeVal);
        if (!store_id) { alert('请选择所属店铺'); return; }
        await apiCreateDish({name, cat, cost, price, status, proc, note, store_id});
      }
    } catch(e) { alert('保存失败：' + (e.message||e)); return; }
  } else {
    if(dishEditingId){
      const d=dishesData.find(x=>x.id===dishEditingId);
      if(d){
        if(d.cost!==cost){
          if(!d.costHistory)d.costHistory=[];
          d.costHistory.push({date:new Date().toISOString().slice(0,10),old:d.cost,new:cost});
        }
        d.name=name;d.cat=cat;d.cost=cost;d.price=price;d.store=storeVal;d.status=status;d.proc=proc;d.note=note;
      }
    }else{
      dishesData.push({id:Math.max(0,...dishesData.map(x=>x.id))+1,name,cat,cost,price,store:storeVal,status,proc,note,sales:0});
    }
  }
  dishEditingId=null;
  closeModal('dish-modal');
  await renderDishes();
}
async function deleteDish(id){
  const d = dishesData.find(x=>x.id===id);
  const dname = d ? d.name : ('#'+id);
  if(!confirm('确认删除菜品「'+dname+'」？此操作不可恢复。'))return;
  if(USE_REAL_DATA && authState.user){
    try { await apiDeleteDish(id); } catch(e) { alert('删除失败：'+(e.message||e)); return; }
  } else {
    const idx=dishesData.findIndex(d=>d.id===id);
    if(idx>=0)dishesData.splice(idx,1);
  }
  await renderDishes();
}
function showCostHistory(name){
  const d = dishesData.length ? dishesData.find(x=>x.name===name) : DISHES.find(x=>x.name===name);
  if(!d)return;
  const history=d.costHistory||[];
  if(!history.length){alert('「'+name+'」暂无成本变更记录');return;}
  document.getElementById('report-modal-content').innerHTML=`
    <div style="font-size:16px;font-weight:700;margin-bottom:12px">📋 ${name} · 成本变更历史</div>
    <table class="tbl"><thead><tr><th>日期</th><th>旧成本</th><th>新成本</th><th>变动</th></tr></thead>
    <tbody>${history.map(h=>`<tr><td>${h.date}</td><td>¥${h.old.toFixed(2)}</td><td>¥${h.new.toFixed(2)}</td><td style="color:${h.new>h.old?'#EF4444':'#22C55E'};font-weight:600">${h.new>h.old?'+':''}¥${(h.new-h.old).toFixed(2)}</td></tr>`).join('')}</tbody></table>
    <div style="margin-top:12px;text-align:right"><button class="btn-sm btn-outline" onclick="closeModal('report-modal')">关闭</button></div>
  `;
  document.getElementById('report-modal').classList.add('open');
}
async function batchOffDishes(){
  const checks=document.querySelectorAll('#dish-tbody input[type=checkbox]:checked');
  if(!checks.length){alert('请先勾选要操作的菜品');return;}
  if(!confirm('确认将 '+checks.length+' 个菜品批量下架？'))return;
  for(const cb of checks){
    const row=cb.closest('tr');
    const nameEl=row.querySelector('td:nth-child(2) strong');
    if(!nameEl) continue;
    const d=dishesData.find(x=>x.name===nameEl.textContent);
    if(!d) continue;
    if(USE_REAL_DATA && authState.user){
      try { await apiUpdateDish(d.id, { status: '下架' }); } catch(e) { alert('操作失败：'+(e.message||e)); return; }
    }
    d.status='下架';
  }
  await renderDishes();
}
async function batchPriceDishes(){
  const checks=document.querySelectorAll('#dish-tbody input[type=checkbox]:checked');
  if(!checks.length){alert('请先勾选要操作的菜品');return;}
  const newPrice=prompt('输入新售价（元）','');
  if(newPrice===null||newPrice==='')return;
  const price=parseFloat(newPrice);
  if(isNaN(price)||price<=0){alert('请输入有效价格');return;}
  for(const cb of checks){
    const row=cb.closest('tr');
    const nameEl=row.querySelector('td:nth-child(2) strong');
    if(!nameEl) continue;
    const d=dishesData.find(x=>x.name===nameEl.textContent);
    if(!d) continue;
    if(USE_REAL_DATA && authState.user){
      try { await apiUpdateDish(d.id, { price }); } catch(e) { alert('操作失败：'+(e.message||e)); return; }
    }
    d.price=price;
  }
  await renderDishes();
}
function toggleAllDishes(cb){
  document.querySelectorAll('#dish-tbody input[type=checkbox]').forEach(c=>c.checked=cb.checked);
}

let customCostCount=0;
function addCustomCostRow(){
  customCostCount++;
  const wrap=document.getElementById('cost-custom-rows');
  const row=document.createElement('div');
  row.style.cssText='display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-top:8px;align-items:flex-end';
  row.innerHTML=`
    <div class="fg"><label>成本名称</label><input class="f-input" type="text" placeholder="如：临时用工费"></div>
    <div class="fg"><label>金额（元）</label><input class="f-input" type="number" placeholder="¥ 0.00"></div>
    <button class="btn-icon" style="color:#EF4444;margin-bottom:2px" onclick="this.parentElement.remove()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  `;
  wrap.appendChild(row);
}

// ========= TABS =========
function setupTabs(containerId, contentPrefix){
  const container=document.getElementById(containerId);
  if(!container)return;
  container.addEventListener('click',async e=>{
    const tab=e.target.closest('.ptab');
    if(!tab)return;
    container.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const key=tab.dataset.tab||tab.dataset.rtype;
    if(tab.dataset.tab){
      document.querySelectorAll('[id^="tab-"]').forEach(c=>c.classList.remove('active'));
      const target=document.getElementById('tab-'+key);
      if(target){target.classList.add('active');if(key==='mapping')await renderMapping();if(key==='status-overview')await renderStatusOverview();}
    }
    if(tab.dataset.rtype){reportType=key;renderReports();}
  });
}

// ========= FILTERS =========
async function updateStoreDropdown() {
  const sel = document.getElementById('gf-store');
  const dishSel = document.getElementById('dish-store-filter');
  try {
    if (USE_REAL_DATA) {
      const stores = await apiFetchStores();
      if (sel) {
        sel.innerHTML = '<option value="all">全部店铺</option>';
        stores.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          sel.appendChild(opt);
        });
      }
      if (dishSel) {
        dishSel.innerHTML = '<option value="">全部店铺</option>';
        stores.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          dishSel.appendChild(opt);
        });
      }
    }
  } catch (e) {
    console.warn('Load stores for dropdown failed:', e);
  }
}

function setupFilters(){
  document.getElementById('gf-platform').addEventListener('change',e=>{state.platform=e.target.value;renderPage(state.page);});
  document.getElementById('gf-store').addEventListener('change',e=>{state.store=e.target.value;renderPage(state.page);});
  document.getElementById('time-tabs').addEventListener('click',async e=>{
    const tab=e.target.closest('.time-tab');
    if(!tab)return;
    document.querySelectorAll('.time-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    state.time=tab.dataset.range;
    const isCustom=tab.dataset.range==='custom';
    const df=document.getElementById('gf-date-from'),dt=document.getElementById('gf-date-to'),ds=document.getElementById('gf-date-sep');
    df.style.display=isCustom?'':'none';
    dt.style.display=isCustom?'':'none';
    ds.style.display=isCustom?'':'none';
    if(isCustom){
      if(!df.value){
        const end=new Date(),start=new Date();
        start.setDate(start.getDate()-30);
        df.value=start.toISOString().slice(0,10);
        dt.value=end.toISOString().slice(0,10);
      }
    }
    await renderPage(state.page);
  });
  document.getElementById('gf-date-from').addEventListener('change',async()=>{await renderPage(state.page)});
  document.getElementById('gf-date-to').addEventListener('change',async()=>{await renderPage(state.page)});
  document.getElementById('dish-search').addEventListener('input',async e=>{dishFilter.search=e.target.value;dishPage=1;await renderDishes();});
  document.getElementById('dish-cat-filter').addEventListener('change',async e=>{dishFilter.cat=e.target.value;dishPage=1;await renderDishes();});
  document.getElementById('dish-status-filter').addEventListener('change',async e=>{dishFilter.status=e.target.value;dishPage=1;await renderDishes();});
  document.getElementById('dish-store-filter').addEventListener('change',async e=>{dishFilter.store=e.target.value;dishPage=1;await renderDishes();});
}

// ========= MODAL CLOSE ON OVERLAY =========
document.querySelectorAll('.modal-overlay').forEach(overlay=>{
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.classList.remove('open');});
});

// ========= NAV =========
document.querySelectorAll('.nav-item[data-page]').forEach(item=>{
  item.addEventListener('click',()=>showPage(item.dataset.page));
});

async function loadInitialData() {
  try {
    if (USE_REAL_DATA && authState.user) {
      // Onboarding: auto-discover stores from orders
      let stores = await apiFetchStores();
      if (stores.length === 0) {
        showOnboardingStatus('正在从订单数据中发现店铺...');
        stores = await apiAutoDiscoverStores();
        updateOnboardingStatus(`发现 ${stores.length} 个店铺`);
      }

      // Onboarding: auto-extract products into dish_mappings
      if (stores.length > 0) {
        const mappings = await apiFetchMappings();
        if (mappings.length === 0) {
          showOnboardingStatus('正在提取平台商品...');
          const extracted = await apiAutoExtractProducts();
          updateOnboardingStatus(`提取了 ${extracted.length} 个平台商品，请在导入页面关联菜品`);
        }
      }

      if (stores.length) { state.store = 'all'; }
      hideOnboardingStatus();
    }
  } catch (e) {
    console.warn('Load initial data failed:', e);
    hideOnboardingStatus();
  }
  updateStoreDropdown();
  renderPage(state.page);
}

// ========= ONBOARDING UI =========
function showOnboardingStatus(msg) {
  let el = document.getElementById('onboarding-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'onboarding-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10001;background:#1e293b;color:#e2e8f0;padding:12px 24px;text-align:center;font-size:14px;display:flex;align-items:center;justify-content:center;gap:8px;';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
  el.innerHTML = `<span style="display:inline-block;width:16px;height:16px;border:2px solid #60a5fa;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></span> ${msg}`;
}

function updateOnboardingStatus(msg) {
  const el = document.getElementById('onboarding-banner');
  if (el) {
    el.innerHTML = `<span style="color:#4ade80;font-size:18px;">&#10003;</span> ${msg}`;
    setTimeout(() => { if (el) el.style.display = 'none'; }, 3000);
  }
}

function hideOnboardingStatus() {
  const el = document.getElementById('onboarding-banner');
  if (el) { el.style.display = 'none'; }
}

// ========= INIT =========
async function init(){
  setupFilters();
  setupTabs('import-tabs','tab-');
  setupTabs('report-type-tabs','');
  initAuthUI();
  // Upload zone click
  const uz = document.getElementById('upload-zone');
  if(uz){
    uz.addEventListener('click',() => document.getElementById('import-file-input').click());
    uz.addEventListener('dragover',e => { e.preventDefault(); uz.classList.add('drag-over'); });
    uz.addEventListener('dragleave',() => uz.classList.remove('drag-over'));
    uz.addEventListener('drop',e => { e.preventDefault(); uz.classList.remove('drag-over'); if(e.dataTransfer.files[0]){ document.getElementById('import-file-input').files = e.dataTransfer.files; handleFileImport({target:{files:e.dataTransfer.files}}); } });
  }
  if (USE_REAL_DATA) {
    await checkAuth();
    // If still loading (no session), auth overlay is shown; don't render yet
    if (!authState.user && authState.loading === false) {
      // User skipped auth or no session yet
    }
  } else {
    authState.loading = false;
    renderRevenue();
  }
}

// ========= Stubs for handlers not yet implemented =========
async function saveCosts(){
  if (!USE_REAL_DATA) { alert('演示模式下无法保存成本。请切换到真实数据模式。'); return; }
  const storeId = (state.store && state.store !== 'all') ? parseInt(state.store) : null;
  if (!storeId) { alert('请先在顶部筛选器中选择一个店铺'); return; }
  const date = new Date().toISOString().slice(0, 10);
  const items = [];
  ['c-promo','c-bwc','c-big','c-other'].forEach(id => {
    const el = document.getElementById(id);
    const val = parseFloat(el?.value) || 0;
    if (val > 0) {
      items.push({
        category: id === 'c-promo' ? 'promotion' : id === 'c-bwc' ? 'bawangcan' : id === 'c-big' ? 'subsidy' : 'other',
        name: id === 'c-promo' ? '满减促销' : id === 'c-bwc' ? '霸王餐支出' : id === 'c-big' ? '大促补贴' : '其他成本',
        amount: val
      });
    }
  });
  try {
    await apiSaveDailyCost({ store_id: storeId, date, items, notes: '' });
    await renderCosts();
    alert('成本保存成功！');
  } catch(e) { alert('保存失败：' + (e.message || e)); }
}

async function saveFixed(){
  if (!USE_REAL_DATA) { alert('演示模式下无法保存固定成本。请切换到真实数据模式。'); return; }
  const name = document.getElementById('fm-name')?.value?.trim();
  const monthly = parseFloat(document.getElementById('fm-monthly')?.value) || 0;
  const category = document.getElementById('fm-category')?.value || 'other';
  const store_id = parseInt(document.getElementById('fm-store')?.value);
  if (!name) { alert('请输入成本名称'); return; }
  if (!store_id) { alert('请选择所属店铺'); return; }
  try {
    await apiCreateFixedCost({ name, monthly, category, active: true, store_id });
    closeModal('fixed-modal');
    await renderFixed();
  } catch(e) { alert('保存失败：' + (e.message || e)); }
}

document.addEventListener('DOMContentLoaded',init);
