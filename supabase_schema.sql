-- 美团外卖自动出餐助手 — Supabase 建表 SQL
-- 通过 API 执行，也可在 SQL Editor 粘贴

-- 1. 订单主表
create table if not exists orders (
  id                    bigint generated always as identity primary key,
  order_no              text not null unique,
  platform              text not null default 'meituan',
  order_index           integer,
  order_time            text,
  deliver_time          text,
  customer_name         text,
  is_new_customer       boolean default false,
  customer_order_count  integer default 0,
  is_fav_customer       boolean default false,
  rider_status          text,
  status                text,
  status_text           text,
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
  cook_remaining_time   text,
  buttons               jsonb default '[]'::jsonb,
  raw_json              jsonb,
  first_seen_at         timestamptz default now(),
  last_updated_at       timestamptz default now()
);

-- 2. 订单商品明细
create table if not exists order_products (
  id          bigint generated always as identity primary key,
  order_no    text not null references orders(order_no) on delete cascade,
  name        text not null,
  unit_price  real default 0,
  quantity    integer default 1,
  total_price real default 0,
  unique(order_no, name)
);

-- 3. 订单状态变更日志
create table if not exists order_events (
  id          bigint generated always as identity primary key,
  order_no    text not null,
  from_status text,
  to_status   text not null,
  event_time  timestamptz default now()
);

-- RLS 全开（anon key 可读写，service_role 不受限）
alter table orders enable row level security;
alter table order_products enable row level security;
alter table order_events enable row level security;

-- orders 策略
create policy "anon_all_orders" on orders for all to anon using (true) with check (true);

-- order_products 策略
create policy "anon_all_order_products" on order_products for all to anon using (true) with check (true);

-- order_events 策略
create policy "anon_all_order_events" on order_events for all to anon using (true) with check (true);
