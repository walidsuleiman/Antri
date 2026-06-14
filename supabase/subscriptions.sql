-- Antri — subscriptions + free-tier enforcement
-- Run this in the Supabase SQL Editor AFTER job_applications.sql.
--
-- Free plan:  up to 50 applications, no Smart Add / extension (gated in server.py).
-- Pro plan:   unlimited applications + Smart Add + extension ($9.99/mo via Stripe).
--
-- Stripe is the source of truth for who is paying. This table is a cache that
-- the Stripe webhook updates with the **service-role key** (server-side only).
-- The browser may READ its own row (for UI) but never writes here.

create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text not null default 'free'
    check (status in ('free', 'active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Users may read ONLY their own subscription row (drives the upgrade UI).
drop policy if exists "Users can read their subscription" on public.subscriptions;
create policy "Users can read their subscription"
  on public.subscriptions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert/update/delete policies for authenticated users: the browser can't
-- forge a subscription. Only the service role (which bypasses RLS) writes here.
grant select on table public.subscriptions to authenticated;

-- --------------------------------------------------------------------------
-- is_pro(): is this user on an active paid plan right now?
-- --------------------------------------------------------------------------
create or replace function public.is_pro(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = uid
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

-- --------------------------------------------------------------------------
-- Free-tier cap: a non-Pro user may hold at most 50 applications.
-- Enforced in Postgres because card writes go browser -> Supabase directly
-- (they never pass through server.py), so this is the authoritative gate.
-- Existing rows are never touched: only NEW inserts past the cap are blocked,
-- so a downgraded Pro user keeps all their data and can still edit/delete.
-- --------------------------------------------------------------------------
create or replace function public.enforce_application_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  app_cap constant integer := 50;
  current_count integer;
begin
  if public.is_pro(new.user_id) then
    return new;  -- Pro = unlimited
  end if;

  select count(*) into current_count
  from public.job_applications
  where user_id = new.user_id;

  if current_count >= app_cap then
    raise exception
      'FREE_TIER_LIMIT: Free accounts are limited to % applications. Upgrade to Pro for unlimited.', app_cap
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_application_cap on public.job_applications;
create trigger enforce_application_cap
  before insert on public.job_applications
  for each row execute function public.enforce_application_cap();
