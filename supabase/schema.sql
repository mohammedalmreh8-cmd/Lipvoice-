-- ============================================================================
-- LipVoice - Supabase schema, Row Level Security and storage policies.
-- Run once in the Supabase SQL editor (or via `supabase db push`).
--
-- Model
--   * Personal Training : rows whose owner is the signed-in user. Private.
--   * Shared Training   : phrases with scope='shared'. A user contributes a
--                         phrase as status='pending'; a moderator approves it
--                         (status='approved'); other users then opt in through
--                         shared_enrollments. Approved shared takes are visible
--                         to all authenticated users so their template data can
--                         seed recognition, while personal data stays private.
-- ============================================================================

-- ---------------------------------------------------------------- extensions
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale       text not null default 'en' check (locale in ('en','ar')),
  role         text not null default 'user' check (role in ('user','moderator')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- phrases
create table if not exists public.phrases (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid references auth.users(id) on delete cascade,
  lang           text not null default 'en' check (lang in ('en','ar')),
  text           text not null,
  scope          text not null default 'personal' check (scope in ('personal','shared')),
  status         text not null default 'approved' check (status in ('pending','approved','rejected')),
  visibility     text not null default 'private' check (visibility in ('private','public')),
  contributed_by uuid references auth.users(id) on delete set null,
  review_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One personal phrase per (owner, language, text). Shared phrases are deduped
-- in application logic because their owner may be null.
create unique index if not exists phrases_personal_uniq
  on public.phrases (owner, lang, lower(text))
  where scope = 'personal';

create index if not exists phrases_shared_idx
  on public.phrases (scope, status, lang);

-- ---------------------------------------------------------------- takes
-- A "take" is one recorded training template: a 36 x 54 feature sequence
-- plus the pose it was recorded at. seq is stored as JSON text.
create table if not exists public.takes (
  id         uuid primary key default gen_random_uuid(),
  phrase_id  uuid not null references public.phrases(id) on delete cascade,
  owner      uuid references auth.users(id) on delete cascade,
  seq        jsonb not null,
  pose       jsonb,
  quality    jsonb,
  created_at timestamptz not null default now()
);

create index if not exists takes_phrase_idx on public.takes (phrase_id);
create index if not exists takes_owner_idx  on public.takes (owner);

-- ---------------------------------------------------------------- settings
create table if not exists public.user_settings (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  autospeak       boolean not null default false,
  sensitivity     numeric not null default 0.85,
  pause_ms        integer not null default 900,
  use_custom_voice boolean not null default true,
  tts             jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- voice profiles
create table if not exists public.voice_profiles (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  storage_path text,
  donor        jsonb,
  is_applied   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists voice_profiles_owner_idx on public.voice_profiles (owner);

-- ---------------------------------------------------------------- history
create table if not exists public.training_history (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  phrase_id  uuid references public.phrases(id) on delete set null,
  action     text not null,
  meta       jsonb,
  created_at timestamptz not null default now()
);

create index if not exists training_history_user_idx on public.training_history (user_id, created_at desc);

-- ---------------------------------------------------------------- shared opt-in
create table if not exists public.shared_enrollments (
  user_id    uuid not null references auth.users(id) on delete cascade,
  phrase_id  uuid not null references public.phrases(id) on delete cascade,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, phrase_id)
);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles            enable row level security;
alter table public.phrases             enable row level security;
alter table public.takes               enable row level security;
alter table public.user_settings       enable row level security;
alter table public.voice_profiles      enable row level security;
alter table public.training_history    enable row level security;
alter table public.shared_enrollments  enable row level security;

-- profiles -------------------------------------------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- phrases --------------------------------------------------------------------
drop policy if exists phrases_owner_all on public.phrases;
create policy phrases_owner_all on public.phrases
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists phrases_shared_read on public.phrases;
create policy phrases_shared_read on public.phrases
  for select using (
    scope = 'shared' and status = 'approved' and visibility = 'public'
  );

-- moderator access to the shared queue --------------------------------------
-- A moderator must be able to read phrases that are still pending and to
-- approve or reject them, even though they do not own them. Membership is
-- decided by the caller's own profile row.
create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'moderator'
  );
$$;

drop policy if exists phrases_moderator_read on public.phrases;
create policy phrases_moderator_read on public.phrases
  for select using (scope = 'shared' and public.is_moderator());

drop policy if exists phrases_moderator_update on public.phrases;
create policy phrases_moderator_update on public.phrases
  for update using (scope = 'shared' and public.is_moderator())
  with check (scope = 'shared');

-- takes ----------------------------------------------------------------------
drop policy if exists takes_owner_all on public.takes;
create policy takes_owner_all on public.takes
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists takes_shared_read on public.takes;
create policy takes_shared_read on public.takes
  for select using (
    exists (
      select 1 from public.phrases p
      where p.id = takes.phrase_id
        and p.scope = 'shared' and p.status = 'approved' and p.visibility = 'public'
    )
  );

-- settings -------------------------------------------------------------------
drop policy if exists settings_owner_all on public.user_settings;
create policy settings_owner_all on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- voice profiles -------------------------------------------------------------
drop policy if exists voice_owner_all on public.voice_profiles;
create policy voice_owner_all on public.voice_profiles
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- history --------------------------------------------------------------------
drop policy if exists history_owner_all on public.training_history;
create policy history_owner_all on public.training_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- shared enrollments ---------------------------------------------------------
drop policy if exists enroll_owner_all on public.shared_enrollments;
create policy enroll_owner_all on public.shared_enrollments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- New-user bootstrap: create a profile and default settings on sign-up.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- updated_at maintenance
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists phrases_touch on public.phrases;
create trigger phrases_touch before update on public.phrases
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Storage: private bucket for voice recordings, owner-scoped folders.
-- Path convention: <user_id>/<profile_id>.webm
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('voice-recordings', 'voice-recordings', false)
on conflict (id) do nothing;

drop policy if exists voice_files_owner_all on storage.objects;
create policy voice_files_owner_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'voice-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'voice-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
