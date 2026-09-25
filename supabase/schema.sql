-- Chronicler database setup for Supabase.
-- Paste this whole file into Supabase > SQL Editor > New query and click Run.
-- Safe to run again: it only creates what is missing.
--
-- Every row belongs to the logged-in user (user_id), and row level security
-- means each user can only ever read or change their own rows.

-- Play sessions uploaded from the gaming PC (one per login or /reload).
create table if not exists public.sessions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  started bigint,
  char jsonb not null default '{}'::jsonb,
  build jsonb not null default '{}'::jsonb,
  expansion text,
  flavor text,
  account text,
  events jsonb not null default '[]'::jsonb,
  event_count integer not null default 0,
  machine text,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Recordings reported by the recording Mac (times in shared server-clock ms).
create table if not exists public.recordings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  path text,
  machine text,
  start_ms bigint,
  end_ms bigint,
  duration double precision,
  source text,
  sync jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

-- How far each computer's clock is from the server clock, measured regularly
-- by the open app. Used to line up game time (PC) with recording time (Mac).
create table if not exists public.clock_samples (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  machine text not null,
  offset_ms double precision not null,
  rtt_ms double precision not null,
  measured_at timestamptz not null default now()
);
create index if not exists clock_samples_lookup on public.clock_samples (user_id, machine, measured_at);

-- App settings, one row per user.
create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.sessions enable row level security;
alter table public.recordings enable row level security;
alter table public.clock_samples enable row level security;
alter table public.settings enable row level security;

drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own recordings" on public.recordings;
create policy "own recordings" on public.recordings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own clock samples" on public.clock_samples;
create policy "own clock samples" on public.clock_samples for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.sessions, public.recordings, public.clock_samples, public.settings to authenticated;

-- The shared clock both computers compare themselves against.
create or replace function public.server_time()
returns double precision
language sql
volatile
as $$ select extract(epoch from clock_timestamp()) * 1000 $$;

grant execute on function public.server_time() to authenticated;
