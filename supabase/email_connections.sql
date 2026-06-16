-- Antri — email forwarding connections (Gmail/Outlook auto-forward sync).
-- Run in the Supabase SQL Editor after job_applications.sql.
--
-- Each user gets a unique forwarding token. They set a Gmail/Outlook filter to
-- auto-forward recruiter emails to u-<token>@inbox.antri.xyz. An inbound-email
-- provider (Postmark) delivers those to POST /api/inbound-email, which looks up
-- the user by token and updates the matching application.
--
-- The browser may READ its own connection (to show the address + any pending
-- Gmail verification code). Only the service role (server) writes here.

create table if not exists public.email_connections (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  token              text unique not null,
  verification_code  text,          -- latest Gmail/Outlook forwarding confirmation code
  verification_from  text,          -- who that confirmation came from
  last_event_at      timestamptz,   -- last time we processed a forwarded email
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists email_connections_token_idx on public.email_connections (token);

alter table public.email_connections enable row level security;

drop policy if exists "Users can read their email connection" on public.email_connections;
create policy "Users can read their email connection"
  on public.email_connections
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert/update/delete policies for authenticated users: only the service
-- role (which bypasses RLS) provisions tokens and records inbound events.
grant select on table public.email_connections to authenticated;
