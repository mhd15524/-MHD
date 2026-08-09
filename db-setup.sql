-- ============================================================
-- Installments Ledger — Complete Supabase Schema  (run ONCE)
-- Project: cgaopjqydylfhkgnqegf
-- ============================================================
-- How to run:
--   1. Go to https://supabase.com/dashboard
--   2. Open project cgaopjqydylfhkgnqegf
--   3. SQL Editor → New query → paste ALL of this → Run
-- ============================================================

-- ----------------------------------------------------------------
-- SECTION 1: Auth & Access Tables
-- ----------------------------------------------------------------

create table if not exists public.il_vaults (
  owner      text primary key,
  enc_salt   text not null default '',
  payload    text not null,
  rev        bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.il_users (
  username    text primary key,
  pass_hash   text not null,
  salt        text not null,
  enc_salt    text not null,
  pubkey      text not null,
  privkey_enc text not null,
  wrapped_key text not null default '',
  role        text not null default '',
  is_admin    boolean not null default false,
  status      text not null default 'pending',
  created_at  timestamptz not null default now()
);

create table if not exists public.il_roles (
  name   text primary key,
  kind   text not null default 'customers',
  colors text not null default '[]',
  pages  text not null default '[]'
);

-- ----------------------------------------------------------------
-- SECTION 2: Business Settings
-- ----------------------------------------------------------------

create table if not exists public.il_settings (
  key   text primary key,
  value text not null default ''
);

-- ----------------------------------------------------------------
-- SECTION 3: Customers
-- ----------------------------------------------------------------

create table if not exists public.il_customers (
  id                   integer primary key,
  name                 text not null,
  notes                text not null default '',
  cat                  text not null default 'gold',
  plan_type            text not null default 'installments',
  plan_total           numeric(14,2) not null default 0,
  plan_down            numeric(14,2) not null default 0,
  plan_start_date      text not null default '',
  plan_frequency       text not null default 'monthly',
  plan_count           integer not null default 0,
  plan_amount_per_inst numeric(14,2) not null default 0,
  box_total            numeric(14,2),
  box_paid             numeric(14,2),
  box_remaining        numeric(14,2),
  created_at           text not null default ''
);

-- ----------------------------------------------------------------
-- SECTION 4: Installment Schedule
-- ----------------------------------------------------------------

create table if not exists public.il_installments (
  customer_id integer not null references public.il_customers(id) on delete cascade,
  inst_num    integer not null,
  due_date    text not null,
  amount      numeric(14,2) not null,
  primary key (customer_id, inst_num)
);

-- ----------------------------------------------------------------
-- SECTION 5: Payment Records
-- ----------------------------------------------------------------

create table if not exists public.il_payments (
  id          integer not null,
  customer_id integer not null references public.il_customers(id) on delete cascade,
  date        text not null,
  amount      numeric(14,2) not null,
  note        text not null default '',
  primary key (customer_id, id)
);

-- ----------------------------------------------------------------
-- SECTION 6: Discounts
-- ----------------------------------------------------------------

create table if not exists public.il_discounts (
  id          integer not null,
  customer_id integer not null references public.il_customers(id) on delete cascade,
  date        text not null,
  inst_num    integer not null default 0,
  amount      numeric(14,2) not null,
  primary key (customer_id, id)
);

-- ----------------------------------------------------------------
-- SECTION 7: Activity Logs
-- ----------------------------------------------------------------

create table if not exists public.il_logs (
  id     integer primary key,
  date   text not null,
  type   text not null,
  detail text not null default ''
);

-- ================================================================
-- Row Level Security — open policies (app manages access itself)
-- ================================================================

alter table public.il_vaults       enable row level security;
alter table public.il_users        enable row level security;
alter table public.il_roles        enable row level security;
alter table public.il_settings     enable row level security;
alter table public.il_customers    enable row level security;
alter table public.il_installments enable row level security;
alter table public.il_payments     enable row level security;
alter table public.il_discounts    enable row level security;
alter table public.il_logs         enable row level security;

do $$ declare t text; begin
  foreach t in array array[
    'il_vaults', 'il_users', 'il_roles', 'il_settings',
    'il_customers', 'il_installments', 'il_payments',
    'il_discounts', 'il_logs'
  ] loop
    execute format('drop policy if exists "allow_all" on public.%I', t);
    execute format(
      'create policy "allow_all" on public.%I
       for all to anon, authenticated
       using (true) with check (true)', t
    );
  end loop;
end $$;
