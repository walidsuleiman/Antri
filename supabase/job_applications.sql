create table if not exists public.job_applications (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null default '',
  company text not null default '',
  location text not null default '',
  date_applied date,
  heard_back boolean not null default false,
  status text not null default 'Applied'
    check (status in ('Saved', 'Applied', 'Follow-up', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn')),
  priority text not null default 'Medium'
    check (priority in ('High', 'Medium', 'Low')),
  compensation text not null default '',
  source text not null default '',
  contact text not null default '',
  url text not null default '',
  follow_up date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_applications_user_id_date_applied_idx
  on public.job_applications (user_id, date_applied desc);

alter table public.job_applications enable row level security;

drop policy if exists "Users can read their job applications" on public.job_applications;
create policy "Users can read their job applications"
  on public.job_applications
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their job applications" on public.job_applications;
create policy "Users can create their job applications"
  on public.job_applications
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their job applications" on public.job_applications;
create policy "Users can update their job applications"
  on public.job_applications
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their job applications" on public.job_applications;
create policy "Users can delete their job applications"
  on public.job_applications
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on table public.job_applications to authenticated;
