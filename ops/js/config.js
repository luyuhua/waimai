// ========= Supabase 配置 =========
// 在 Supabase Dashboard > Settings > API 中获取
const SUPABASE_URL = 'https://ubnjwhavibtyafyicrdv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVibmp3aGF2aWJ0eWFmeWljcmR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMDcxNzUsImV4cCI6MjA5NzU4MzE3NX0.7_3fuNhchNVuLaM6cSzDoKWMAk4ZBZI1PuwMxxj1V8M';

// ========= 模式切换 =========
// false = 使用 mock 数据（与旧版行为一致）
// true  = 连接 Supabase 真实数据（Phase 2 启用）
const USE_REAL_DATA = true;

// ========= App 常量 =========
const APP_NAME = '外卖智慧运营助手';
const getDaysInMonth = () => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();

// 解析订单时间 TEXT "MM-DD HH:mm" → Date 对象
// 用当前年份补全，如果解析日期 > 当前日期 6 个月则视为上一年
function parseOrderTime(orderTime) {
  if (!orderTime) return null;
  try {
    const [datePart, timePart] = orderTime.split(' ');
    const [month, day] = datePart.split('-');
    const [hour, minute] = (timePart || '00:00').split(':');
    const now = new Date();
    let year = now.getFullYear();
    const parsed = new Date(year, parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
    if (isNaN(parsed.getTime())) return null;
    if (parsed - now > 180 * 24 * 3600 * 1000) parsed.setFullYear(year - 1);
    return parsed;
  } catch (e) {
    return null;
  }
}

// 获取指定天数前的日期（用于时间范围筛选）
function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
