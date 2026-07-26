-- ══════════════════════════════════════════════════════════════════════
--  OMEGA ATELIER 2.0 — Supabase Schema + RLS + Realtime
--  Ausführen in: Supabase Dashboard → SQL Editor → New query → Run
-- ══════════════════════════════════════════════════════════════════════

-- Extensions ---------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ────────────────────────── PROFILES ─────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  email        text,
  created_at   timestamptz not null default now()
);

-- Auto-insert profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ────────────────────────── PLANS ────────────────────────────────────────
create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Neuer Plan',
  description text,
  doc         jsonb not null,
  is_public   boolean not null default false,
  cover_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists plans_owner_idx on public.plans(owner_id);
create index if not exists plans_updated_idx on public.plans(updated_at desc);

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before update on public.plans
  for each row execute procedure public.touch_updated_at();

-- ────────────────────────── PLAN VERSIONS ────────────────────────────────
create table if not exists public.plan_versions (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  version    integer not null,
  doc        jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  note       text,
  unique(plan_id, version)
);

create index if not exists plan_versions_plan_idx on public.plan_versions(plan_id, version desc);

-- Auto-version on each plans update
create or replace function public.snapshot_plan_version()
returns trigger language plpgsql as $$
declare next_ver integer;
begin
  select coalesce(max(version), 0) + 1 into next_ver
  from public.plan_versions where plan_id = new.id;
  insert into public.plan_versions(plan_id, version, doc, created_by)
  values (new.id, next_ver, new.doc, auth.uid());
  return new;
end;
$$;

drop trigger if exists plans_version on public.plans;
create trigger plans_version after update of doc on public.plans
  for each row execute procedure public.snapshot_plan_version();

-- ────────────────────────── COLLABORATORS ────────────────────────────────
create table if not exists public.plan_collaborators (
  plan_id    uuid not null references public.plans(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('viewer','editor')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create index if not exists collab_user_idx on public.plan_collaborators(user_id);

-- ────────────────────────── COMMENTS ─────────────────────────────────────
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  floor_id   uuid,
  target_id  uuid,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists comments_plan_idx on public.comments(plan_id);

-- ════════════════════════ ROW LEVEL SECURITY ══════════════════════════════
alter table public.profiles            enable row level security;
alter table public.plans               enable row level security;
alter table public.plan_versions       enable row level security;
alter table public.plan_collaborators  enable row level security;
alter table public.comments            enable row level security;

-- PROFILES --
drop policy if exists "profiles read self" on public.profiles;
create policy "profiles read self"
  on public.profiles for select
  using (true); -- profiles are public (display_name, avatar only)

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self"
  on public.profiles for update
  using (id = auth.uid());

-- Helper: can_access_plan ----
create or replace function public.can_access_plan(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.plans p
    where p.id = p_id
      and (
        p.owner_id = auth.uid()
        or p.is_public = true
        or exists (
          select 1 from public.plan_collaborators c
          where c.plan_id = p.id and c.user_id = auth.uid()
        )
      )
  )
$$;

create or replace function public.can_edit_plan(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.plans p
    where p.id = p_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.plan_collaborators c
          where c.plan_id = p.id and c.user_id = auth.uid() and c.role = 'editor'
        )
      )
  )
$$;

-- PLANS --
drop policy if exists "plans select"    on public.plans;
drop policy if exists "plans insert"    on public.plans;
drop policy if exists "plans update"    on public.plans;
drop policy if exists "plans delete"    on public.plans;

create policy "plans select" on public.plans
  for select using (
    owner_id = auth.uid()
    or is_public = true
    or exists (select 1 from public.plan_collaborators c
               where c.plan_id = id and c.user_id = auth.uid())
  );

create policy "plans insert" on public.plans
  for insert with check (owner_id = auth.uid());

create policy "plans update" on public.plans
  for update using (
    owner_id = auth.uid()
    or exists (select 1 from public.plan_collaborators c
               where c.plan_id = id and c.user_id = auth.uid() and c.role = 'editor')
  );

create policy "plans delete" on public.plans
  for delete using (owner_id = auth.uid());

-- PLAN_VERSIONS --
drop policy if exists "versions select" on public.plan_versions;
create policy "versions select" on public.plan_versions
  for select using (public.can_access_plan(plan_id));

drop policy if exists "versions insert" on public.plan_versions;
create policy "versions insert" on public.plan_versions
  for insert with check (public.can_edit_plan(plan_id));

-- COLLABORATORS --
drop policy if exists "collab select" on public.plan_collaborators;
drop policy if exists "collab write"  on public.plan_collaborators;

create policy "collab select" on public.plan_collaborators
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.plans p where p.id = plan_id and p.owner_id = auth.uid())
  );

create policy "collab write" on public.plan_collaborators
  for all using (
    exists (select 1 from public.plans p where p.id = plan_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.plans p where p.id = plan_id and p.owner_id = auth.uid())
  );

-- COMMENTS --
drop policy if exists "comments select" on public.comments;
drop policy if exists "comments insert" on public.comments;
drop policy if exists "comments update" on public.comments;
drop policy if exists "comments delete" on public.comments;

create policy "comments select" on public.comments
  for select using (public.can_access_plan(plan_id));

create policy "comments insert" on public.comments
  for insert with check (public.can_access_plan(plan_id) and author_id = auth.uid());

create policy "comments update" on public.comments
  for update using (author_id = auth.uid() or public.can_edit_plan(plan_id));

create policy "comments delete" on public.comments
  for delete using (author_id = auth.uid());

-- ══════════════════════════ REALTIME ═════════════════════════════════════
-- Enable realtime on collaboration-relevant tables.
alter publication supabase_realtime add table public.plans;
alter publication supabase_realtime add table public.comments;

-- Note on presence / cursors: use Supabase Realtime Broadcast channels
-- (client-side only) for live cursors. No table needed.
