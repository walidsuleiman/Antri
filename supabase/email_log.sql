-- Antri — transactional email log.
-- Run in the Supabase SQL Editor after job_applications.sql and subscriptions.sql.
--
-- Tracks which lifecycle emails have been sent to each user so the cron job
-- never double-sends. The unique index on (user_id, type) is the hard guard.
--
-- Types used by emails.py:
--   welcome        — sent once after signup
--   trial_start    — sent when a Stripe subscription enters 'trialing'
--   trial_reminder — sent ~2 days before a trial ends

create table if not exists public.email_log (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  type       text        not null,
  sent_at    timestamptz not null default now()
);

-- Hard uniqueness guard: one row per user per email type.
create unique index if not exists email_log_user_type_idx
  on public.email_log (user_id, type);

alter table public.email_log enable row level security;
-- Only the service role writes here — no browser policies needed.

-- --------------------------------------------------------------------------
-- users_pending_welcome()
-- New users (created within the last `hours` hours) who haven't received a
-- welcome email yet. Called by emails.py to find the first send batch.
-- --------------------------------------------------------------------------
create or replace function public.users_pending_welcome(hours int default 48)
returns table (user_id uuid, user_email text)
language sql
security definer
set search_path = public, auth
as $$
  select u.id, u.email
  from auth.users u
  left join public.email_log el
    on el.user_id = u.id and el.type = 'welcome'
  where el.user_id is null
    and u.created_at > now() - (hours || ' hours')::interval
    and u.email is not null
  order by u.created_at asc;
$$;

-- --------------------------------------------------------------------------
-- subscriptions_pending_trial_start()
-- Trialing subscriptions where the trial_start confirmation hasn't been sent.
-- --------------------------------------------------------------------------
create or replace function public.subscriptions_pending_trial_start()
returns table (user_id uuid, user_email text, period_end timestamptz)
language sql
security definer
set search_path = public, auth
as $$
  select s.user_id, u.email, s.current_period_end
  from public.subscriptions s
  join auth.users u on u.id = s.user_id
  left join public.email_log el
    on el.user_id = s.user_id and el.type = 'trial_start'
  where s.status = 'trialing'
    and el.user_id is null
    and u.email is not null;
$$;

-- --------------------------------------------------------------------------
-- subscriptions_pending_trial_reminder(reminder_days)
-- Trialing subscriptions whose period_end falls within a ±1 day window
-- around `reminder_days` days from now, and haven't had a reminder sent.
-- Default reminder_days = 2  →  fires when ~2 days remain.
-- --------------------------------------------------------------------------
create or replace function public.subscriptions_pending_trial_reminder(
  reminder_days int default 2
)
returns table (user_id uuid, user_email text, period_end timestamptz)
language sql
security definer
set search_path = public, auth
as $$
  select s.user_id, u.email, s.current_period_end
  from public.subscriptions s
  join auth.users u on u.id = s.user_id
  left join public.email_log el
    on el.user_id = s.user_id and el.type = 'trial_reminder'
  where s.status = 'trialing'
    and el.user_id is null
    and s.current_period_end between
        now() + ((reminder_days - 1) || ' days')::interval
      and
        now() + ((reminder_days + 1) || ' days')::interval
    and u.email is not null;
$$;
