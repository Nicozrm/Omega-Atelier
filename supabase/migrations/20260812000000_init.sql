-- ══════════════════════════════════════════════════════════════════════════
--  OMEGA ATELIER 2.0 — Schema, RLS, Realtime, Storage
--
--  Ausführen: Supabase Dashboard → SQL Editor → New query → einfügen → Run.
--
--  ── Wiederholbar ────────────────────────────────────────────────────────
--  Dieses Skript ist idempotent: es legt nur an, was fehlt, und ersetzt
--  Policies und Funktionen an Ort und Stelle. Es DROPPT KEINE TABELLE und
--  löscht keine Zeile. Zweimal ausführen ist folgenlos, und ein späteres
--  erneutes Ausführen aktualisiert die Regeln, ohne Pläne anzufassen.
--
--  Genau das ist der Grund, warum unten überall `if not exists`,
--  `create or replace` und `drop policy if exists` steht statt eines
--  bequemen `drop schema public cascade`.
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ═══════════════════════════ 1 · PROFILES ═════════════════════════════════
-- Spiegelt `auth.users`, weil RLS-Policies und Joins nicht auf das
-- auth-Schema zugreifen dürfen.

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- E-Mail eindeutig und case-insensitive: die Einladung sucht nach E-Mail,
-- und ohne diesen Index wäre „Max@x.de" ein anderer Nutzer als „max@x.de".
create unique index if not exists profiles_email_key
  on public.profiles (lower(email)) where email is not null;

/*
 * Profil beim Registrieren anlegen.
 *
 * `security definer`, weil der Trigger auf auth.users feuert und der
 * einfügende Rollenkontext keine Rechte auf public.profiles hat.
 *
 * Die E-Mail kann NULL sein — bei OAuth-Anbietern, die keine liefern, und bei
 * anonymen Sessions. Das alte Schema rief `split_part(new.email, '@', 1)`
 * ungeschützt auf; bei NULL kam dabei NULL heraus und das Profil hatte keinen
 * Namen. Deshalb hier eine Kette bis zu einem garantierten Fallback.
 */
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
    lower(nullif(new.email, '')),
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Nutzer'
    ),
    nullif(new.raw_user_meta_data->>'avatar_url', '')
  )
  on conflict (id) do update
    set email      = coalesce(excluded.email, public.profiles.email),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════ 2 · PLANS ════════════════════════════════════

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

create index if not exists plans_owner_idx   on public.plans (owner_id);
create index if not exists plans_updated_idx on public.plans (updated_at desc);
-- Die Plan-Liste sortiert nach updated_at und filtert implizit über RLS auf
-- den Besitzer; der zusammengesetzte Index bedient beides in einem Scan.
create index if not exists plans_owner_updated_idx
  on public.plans (owner_id, updated_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

/*
 * Besitz und Sichtbarkeit gehören dem Eigentümer — und das muss ein Trigger
 * durchsetzen, keine Policy.
 *
 * Der naheliegende Weg wäre, die UPDATE-Policy zu teilen: eine für den
 * Eigentümer, eine für Editoren, und in der Editor-Variante `with check
 * (owner_id <> auth.uid() and not is_public)`. Das funktioniert nicht, und der
 * Grund ist die Auswertungsregel: **permissive Policies werden ODER-verknüpft.**
 * Setzt ein Editor `owner_id` auf sich selbst, scheitert zwar seine eigene
 * Policy — aber die Eigentümer-Policy prüft die *neue* Zeile, in der er nun
 * Eigentümer ist, und lässt sie durch. Die Vereinigung erlaubt exakt den
 * Übergang, den beide einzeln verbieten. (Nachgestellt und bestätigt.)
 *
 * Der eigentliche Grund liegt tiefer: die Bedingung lautet „diese Spalte darf
 * sich nicht ändern", und `with check` sieht nur die neue Zeile. Ohne Zugriff
 * auf OLD ist die Regel in einer Policy gar nicht formulierbar — egal wie man
 * sie schneidet. Deshalb hier, wo OLD und NEW beide vorliegen.
 *
 * Ein normales Speichern schreibt nur `doc` und `title`; die anderen Spalten
 * behalten ihren Wert und der Trigger schweigt. Er feuert nur bei einem
 * echten Versuch, und dann laut statt still korrigierend.
 */
create or replace function public.guard_plan_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from old.owner_id then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Nur der Eigentümer kann den Besitz eines Plans übertragen'
        using errcode = 'insufficient_privilege';
    end if;
    if new.is_public is distinct from old.is_public then
      raise exception 'Nur der Eigentümer kann die Sichtbarkeit eines Plans ändern'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists plans_guard_ownership on public.plans;
create trigger plans_guard_ownership before update on public.plans
  for each row execute function public.guard_plan_ownership();

-- ═══════════════════════════ 3 · VERSIONEN ════════════════════════════════
/*
 * Versionsverlauf.
 *
 * ── Warum nicht bei jedem Update ──
 * Die App speichert automatisch. Ein Trigger auf jedem `update of doc` legt
 * deshalb bei jedem Autosave eine Vollkopie des Dokuments an — bei einer
 * Stunde Arbeit sind das dutzende Kopien eines mehrere hundert Kilobyte
 * grossen JSONB, und die Tabelle wächst schneller als die Nutzdaten. Das war
 * der Zustand im alten Schema.
 *
 * Eine Version entsteht hier nur, wenn sich das Dokument wirklich geändert hat
 * UND seit der letzten Version genug Zeit vergangen ist. Das ergibt einen
 * lesbaren Verlauf statt eines Tastenanschlag-Protokolls.
 */
create table if not exists public.plan_versions (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  version    integer not null,
  doc        jsonb not null,
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (plan_id, version)
);

create index if not exists plan_versions_plan_idx
  on public.plan_versions (plan_id, version desc);

-- Mindestabstand zwischen zwei Schnappschüssen desselben Plans.
create or replace function public.snapshot_plan_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  last_at  timestamptz;
  next_ver integer;
begin
  -- Unverändertes Dokument: kein Schnappschuss. `is distinct from` behandelt
  -- NULL korrekt, `<>` täte das nicht.
  if new.doc is not distinct from old.doc then
    return new;
  end if;

  select max(created_at), coalesce(max(version), 0) + 1
    into last_at, next_ver
  from public.plan_versions where plan_id = new.id;

  if last_at is not null and last_at > now() - interval '5 minutes' then
    return new;
  end if;

  insert into public.plan_versions (plan_id, version, doc, created_by)
  values (new.id, next_ver, new.doc, auth.uid());
  return new;
end;
$$;

drop trigger if exists plans_version on public.plans;
create trigger plans_version after update of doc on public.plans
  for each row execute function public.snapshot_plan_version();

-- ═══════════════════════════ 4 · MITARBEIT ════════════════════════════════

create table if not exists public.plan_collaborators (
  plan_id    uuid not null references public.plans(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('viewer', 'editor')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create index if not exists collab_user_idx on public.plan_collaborators (user_id);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  floor_id   text,
  target_id  text,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (length(btrim(body)) > 0),
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists comments_plan_idx on public.comments (plan_id, created_at desc);

-- ═══════════════════════ 5 · ZUGRIFFS-HELFER ══════════════════════════════
/*
 * Beide `security definer`, und das ist hier kein Bequemlichkeitsgriff,
 * sondern notwendig: eine Policy auf `plans`, die `plan_collaborators` liest,
 * löst dort wiederum die Policy aus, die `plans` liest — unendliche Rekursion,
 * Postgres bricht mit „infinite recursion detected in policy" ab. Ein
 * `security definer`-Helfer umgeht RLS im Inneren und beendet die Kette.
 *
 * `set search_path = public` ist dabei Pflicht: ohne ihn könnte ein Aufrufer
 * mit eigenem search_path eine gleichnamige Tabelle unterschieben und die
 * Funktion mit Besitzerrechten darauf laufen lassen.
 */
create or replace function public.can_read_plan(p_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.plans p
    where p.id = p_id
      and (p.owner_id = auth.uid()
        or p.is_public
        or exists (select 1 from public.plan_collaborators c
                   where c.plan_id = p.id and c.user_id = auth.uid()))
  );
$$;

create or replace function public.can_edit_plan(p_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.plans p
    where p.id = p_id
      and (p.owner_id = auth.uid()
        or exists (select 1 from public.plan_collaborators c
                   where c.plan_id = p.id and c.user_id = auth.uid() and c.role = 'editor'))
  );
$$;

create or replace function public.owns_plan(p_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.plans p where p.id = p_id and p.owner_id = auth.uid());
$$;

/*
 * Einladung per E-Mail.
 *
 * Die App muss aus einer E-Mail eine user_id machen. Das alte Schema löste das
 * mit `create policy "profiles read self" ... using (true)` — also SELECT auf
 * die ganze Profiltabelle für jeden angemeldeten Nutzer. Der Kommentar dort
 * behauptete „nur display_name und avatar"; die Spalte `email` stand aber in
 * derselben Tabelle, und ein einziges `select email from profiles` hätte die
 * Adressen aller Nutzer ausgegeben.
 *
 * Stattdessen diese Funktion: sie beantwortet genau die eine Frage, gibt keine
 * E-Mail zurück (der Aufrufer kennt sie bereits, er hat sie eingegeben) und
 * lässt sich nicht zum Auflisten missbrauchen.
 */
create or replace function public.find_user_by_email(p_email text)
returns table (id uuid, display_name text, avatar_url text)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_url
  from public.profiles p
  where auth.uid() is not null
    and lower(p.email) = lower(btrim(p_email))
  limit 1;
$$;

revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

-- ═══════════════════════ 6 · ROW LEVEL SECURITY ═══════════════════════════

alter table public.profiles           enable row level security;
alter table public.plans              enable row level security;
alter table public.plan_versions      enable row level security;
alter table public.plan_collaborators enable row level security;
alter table public.comments           enable row level security;

-- ── PROFILES ──────────────────────────────────────────────────────────────
-- Sichtbar ist das eigene Profil und wer an einem gemeinsamen Plan mitarbeitet
-- (die Mitarbeiterliste zeigt Namen und Avatar). Sonst niemand.
drop policy if exists "profiles read self"    on public.profiles;
drop policy if exists "profiles update self"  on public.profiles;
drop policy if exists "profiles select"       on public.profiles;
drop policy if exists "profiles update"       on public.profiles;

create policy "profiles select" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.plan_collaborators c
      join public.plans p on p.id = c.plan_id
      where c.user_id = public.profiles.id
        and (p.owner_id = auth.uid()
          or exists (select 1 from public.plan_collaborators mine
                     where mine.plan_id = p.id and mine.user_id = auth.uid()))
    )
    or exists (
      select 1 from public.plans p
      where p.owner_id = public.profiles.id
        and exists (select 1 from public.plan_collaborators mine
                    where mine.plan_id = p.id and mine.user_id = auth.uid())
    )
  );

-- `with check` gespiegelt, sonst könnte ein Update die eigene Zeile auf eine
-- fremde id umschreiben und sie damit übernehmen.
create policy "profiles update" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── PLANS ─────────────────────────────────────────────────────────────────
drop policy if exists "plans select"        on public.plans;
drop policy if exists "plans insert"        on public.plans;
drop policy if exists "plans update"        on public.plans;  -- Name vor der Aufteilung
drop policy if exists "plans update owner"  on public.plans;
drop policy if exists "plans update editor" on public.plans;
drop policy if exists "plans delete"        on public.plans;

create policy "plans select" on public.plans
  for select
  using (
    owner_id = auth.uid()
    or is_public
    or exists (select 1 from public.plan_collaborators c
               where c.plan_id = public.plans.id and c.user_id = auth.uid())
  );

create policy "plans insert" on public.plans
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy "plans update" on public.plans
  for update to authenticated
  using (
    owner_id = auth.uid()
    or exists (select 1 from public.plan_collaborators c
               where c.plan_id = public.plans.id and c.user_id = auth.uid() and c.role = 'editor')
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from public.plan_collaborators c
               where c.plan_id = public.plans.id and c.user_id = auth.uid() and c.role = 'editor')
  );

create policy "plans delete" on public.plans
  for delete to authenticated
  using (owner_id = auth.uid());

-- ── PLAN_VERSIONS ─────────────────────────────────────────────────────────
-- Kein UPDATE, kein DELETE: ein Verlauf, den man umschreiben kann, ist keiner.
-- Eingefügt wird ausschliesslich vom Trigger (security definer).
drop policy if exists "versions select" on public.plan_versions;
drop policy if exists "versions insert" on public.plan_versions;

create policy "versions select" on public.plan_versions
  for select using (public.can_read_plan(plan_id));

-- ── PLAN_COLLABORATORS ────────────────────────────────────────────────────
drop policy if exists "collab select" on public.plan_collaborators;
drop policy if exists "collab write"  on public.plan_collaborators;
drop policy if exists "collab insert" on public.plan_collaborators;
drop policy if exists "collab update" on public.plan_collaborators;
drop policy if exists "collab delete" on public.plan_collaborators;

create policy "collab select" on public.plan_collaborators
  for select to authenticated
  using (user_id = auth.uid() or public.owns_plan(plan_id));

-- Einladen, Rolle ändern und entfernen darf nur der Eigentümer. Ein Editor
-- könnte sonst weitere Editoren einladen — Rechteweitergabe ohne den Besitzer.
create policy "collab insert" on public.plan_collaborators
  for insert to authenticated
  with check (public.owns_plan(plan_id) and user_id <> auth.uid());

create policy "collab update" on public.plan_collaborators
  for update to authenticated
  using (public.owns_plan(plan_id))
  with check (public.owns_plan(plan_id) and user_id <> auth.uid());

-- Der Eigentümer entfernt jeden; ein Mitarbeiter darf sich selbst entfernen.
create policy "collab delete" on public.plan_collaborators
  for delete to authenticated
  using (public.owns_plan(plan_id) or user_id = auth.uid());

-- ── COMMENTS ──────────────────────────────────────────────────────────────
drop policy if exists "comments select" on public.comments;
drop policy if exists "comments insert" on public.comments;
drop policy if exists "comments update" on public.comments;
drop policy if exists "comments delete" on public.comments;

create policy "comments select" on public.comments
  for select using (public.can_read_plan(plan_id));

create policy "comments insert" on public.comments
  for insert to authenticated
  with check (public.can_read_plan(plan_id) and author_id = auth.uid());

-- Der Autor bearbeitet seinen Text; wer den Plan bearbeiten darf, darf einen
-- Kommentar zusätzlich als erledigt markieren. `with check` verhindert, dass
-- dabei die Urheberschaft umgeschrieben wird.
create policy "comments update" on public.comments
  for update to authenticated
  using (author_id = auth.uid() or public.can_edit_plan(plan_id))
  with check (author_id = public.comments.author_id);

create policy "comments delete" on public.comments
  for delete to authenticated
  using (author_id = auth.uid() or public.owns_plan(plan_id));

-- ═══════════════════════════ 7 · REALTIME ═════════════════════════════════
/*
 * `alter publication ... add table` scheitert, wenn die Tabelle schon drin ist
 * — das allein machte das alte Skript beim zweiten Durchlauf unbrauchbar.
 * Deshalb vorher nachsehen.
 *
 * Realtime respektiert RLS: ein Client bekommt nur Änderungen an Zeilen, die
 * er auch lesen dürfte.
 */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plans'
  ) then
    alter publication supabase_realtime add table public.plans;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end $$;

-- Ohne das liefert ein UPDATE-Event nur die geänderten Spalten, und der Client
-- kann alt gegen neu nicht vergleichen.
alter table public.plans    replica identity full;
alter table public.comments replica identity full;

-- Live-Cursor laufen über Realtime-Broadcast-Kanäle (rein clientseitig);
-- dafür braucht es keine Tabelle.

-- ═══════════════════════════ 8 · STORAGE ══════════════════════════════════
-- Vorschaubilder für `plans.cover_url`.

insert into storage.buckets (id, name, public)
values ('plan-covers', 'plan-covers', true)
on conflict (id) do nothing;

drop policy if exists "covers read"   on storage.objects;
drop policy if exists "covers write"  on storage.objects;
drop policy if exists "covers update" on storage.objects;
drop policy if exists "covers delete" on storage.objects;

create policy "covers read" on storage.objects
  for select using (bucket_id = 'plan-covers');

-- Pfad ist `<user-id>/<plan-id>.<ext>`: der erste Ordner muss die eigene
-- Nutzer-ID sein, sonst könnte jeder in fremde Ordner schreiben.
create policy "covers write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'plan-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "covers update" on storage.objects
  for update to authenticated
  using (bucket_id = 'plan-covers' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'plan-covers' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "covers delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'plan-covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ═══════════════════════════ 9 · RECHTE ═══════════════════════════════════
-- Supabase vergibt Tabellenrechte standardmässig grosszügig; RLS ist die
-- eigentliche Grenze. Explizit gesetzt, damit ein Blick genügt.

grant usage on schema public to anon, authenticated;
grant select                         on public.plans            to anon, authenticated;
grant insert, update, delete         on public.plans            to authenticated;
grant select                         on public.plan_versions    to authenticated;
grant select, insert, update, delete on public.plan_collaborators to authenticated;
grant select, insert, update, delete on public.comments         to authenticated;
grant select, update                 on public.profiles         to authenticated;
