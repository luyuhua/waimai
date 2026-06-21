-- 美团外卖自动出餐助手 — Supabase 建表 SQL
-- 在 SQL Editor 粘贴执行: https://supabase.com/dashboard/project/ubnjwhavibtyafyicrdv/sql/new

-- 先删旧表（如果存在）
drop table if exists order_events cascade;
drop table if exists order_products cascade;
drop table if exists orders cascade;

-- 1. 订单主表（静态/准静态字段，不含每秒变化的瞬态数据）
create table orders (
  id                    bigint generated always as identity primary key,
  order_no              text not null unique,
  shop_name             text not null default '',
  platform              text not null default 'meituan',
  order_index           integer,
  order_time            text,
  deliver_time          text,
  customer_name         text,
  is_new_customer       boolean default false,
  customer_order_count  integer default 0,
  is_fav_customer       boolean default false,
  status                text default '',
  cook_time             text,
  suggested_cook_time   text,
  suggested_cook_time_sec integer default 0,
  is_pre_order          boolean default false,
  suggested_cook_deadline text,
  phone_tail            text,
  remark                text,
  estimated_income      real default 0,
  delivery_type         text,
  is_flash_delivery     boolean default false,
  rider_name            text,
  commission_rate       real default 0,
  commission_amount     real default 0,
  delivery_subsidy      real default 0,
  order_discount        real default 0,
  pack_fee              real default 0,
  raw_json              jsonb,
  first_seen_at         timestamptz default now(),
  last_updated_at       timestamptz default now()
);

-- 字段注释
comment on column orders.order_no is '美团订单编号，唯一标识';
comment on column orders.shop_name is '店铺名称，从页面 header [class*="current-poi"] 提取';
comment on column orders.platform is '平台: meituan / eleme';
comment on column orders.order_index is '订单序号 #N';
comment on column orders.order_time is '下单时间 MM-DD HH:mm';
comment on column orders.deliver_time is '预计送达时间 MM-DD HH:mm';
comment on column orders.customer_name is '顾客姓名（含称呼）';
comment on column orders.is_new_customer is '是否门店新客';
comment on column orders.customer_order_count is '顾客历史下单次数';
comment on column orders.is_fav_customer is '是否收藏店铺';
comment on column orders.status is '订单状态: pending_accept/pending_cook/cooked/delivered/cancelled';
comment on column orders.cook_time is '出餐用时 MM:SS';
comment on column orders.suggested_cook_time is '建议出餐时长 X分X秒';
comment on column orders.suggested_cook_time_sec is '建议出餐时长（秒）';
comment on column orders.is_pre_order is '是否预订单';
comment on column orders.suggested_cook_deadline is '建议出餐截止时间（预订单）';
comment on column orders.phone_tail is '手机尾号 4 位';
comment on column orders.remark is '订单备注';
comment on column orders.estimated_income is '预计收入（元）';
comment on column orders.delivery_type is '配送类型: meituan/other';
comment on column orders.is_flash_delivery is '是否闪电送/15分钟配送';
comment on column orders.rider_name is '骑手姓名';
comment on column orders.commission_rate is '佣金比例 %';
comment on column orders.commission_amount is '佣金金额（元）';
comment on column orders.delivery_subsidy is '商家配送补贴（元）';
comment on column orders.order_discount is '商家订单优惠（元）';
comment on column orders.pack_fee is '打包费（元）';
comment on column orders.raw_json is 'extractOrders() 原始返回的完整 JSON';
comment on column orders.first_seen_at is '首次发现时间';
comment on column orders.last_updated_at is '最后更新时间';

-- 2. 订单商品明细
create table order_products (
  id          bigint generated always as identity primary key,
  order_no    text not null references orders(order_no) on delete cascade,
  name        text not null,
  unit_price  real default 0,
  quantity    integer default 1,
  total_price real default 0,
  unique(order_no, name)
);

comment on table order_products is '订单商品明细，一对多关联 orders';
comment on column order_products.order_no is '关联 orders.order_no';
comment on column order_products.name is '商品名称';
comment on column order_products.unit_price is '单价（元）';
comment on column order_products.quantity is '数量';
comment on column order_products.total_price is '小计（元）';

-- 3. 订单状态变更日志
create table order_events (
  id          bigint generated always as identity primary key,
  order_no    text not null,
  from_status text,
  to_status   text not null,
  event_time  timestamptz default now()
);

comment on table order_events is '订单状态变更事件日志';
comment on column order_events.order_no is '关联 orders.order_no';
comment on column order_events.from_status is '变更前状态';
comment on column order_events.to_status is '变更后状态';
comment on column order_events.event_time is '事件时间';

-- RLS 全开（anon key 可读写）
alter table orders enable row level security;
alter table order_products enable row level security;
alter table order_events enable row level security;

create policy "anon_all_orders" on orders for all to anon using (true) with check (true);
create policy "anon_all_order_products" on order_products for all to anon using (true) with check (true);
create policy "anon_all_order_events" on order_events for all to anon using (true) with check (true);
