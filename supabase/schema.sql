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

-- Version 2 ------------------------------------------------------------------
-- Item catalog, position tracks and screenshots. Running this whole file again
-- adds these without touching anything you already have.

-- Everything the game knows about each item you have come across.
create table if not exists public.items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id integer not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- Position and state every 2 seconds, in chunks of up to 1000 points.
create table if not exists public.tracks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id text not null,
  chunk integer not null,
  machine text,
  points jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id, chunk)
);

-- Screenshots uploaded from the gaming PC (the images are in Storage).
create table if not exists public.screenshots (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  flavor text,
  machine text,
  taken_ms bigint,
  path text not null,
  width integer,
  height integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

alter table public.items enable row level security;
alter table public.tracks enable row level security;
alter table public.screenshots enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own tracks" on public.tracks;
create policy "own tracks" on public.tracks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own screenshots" on public.screenshots;
create policy "own screenshots" on public.screenshots for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.items, public.tracks, public.screenshots to authenticated;

-- A private storage bucket for screenshot images, one folder per user.
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false)
  on conflict (id) do nothing;

drop policy if exists "chronicler screenshots read" on storage.objects;
create policy "chronicler screenshots read" on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "chronicler screenshots write" on storage.objects;
create policy "chronicler screenshots write" on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "chronicler screenshots update" on storage.objects;
create policy "chronicler screenshots update" on storage.objects for update to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "chronicler screenshots delete" on storage.objects;
create policy "chronicler screenshots delete" on storage.objects for delete to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text);
