-- ══════════════════════════════════════════════════════════════════════════
--  OMEGA ATELIER — Digital Twin: verbundene Geräte je Konto
--
--  Ausführen: Supabase Dashboard → SQL Editor → New query → einfügen → Run.
--  Idempotent, wie das Basis-Skript: legt nur an, was fehlt.
--
--  ── Warum eine eigene Tabelle ────────────────────────────────────────────
--  Die verbundenen Geräte gehören zum Konto, nicht zu einem einzelnen Plan.
--  Wer zwei Grundrisse pflegt, hat trotzdem eine Wohnung und eine Gerätewelt;
--  sie in `plans.doc` zu hängen würde sie pro Plan duplizieren und beim
--  Planwechsel auseinanderlaufen lassen.
--
--  ── Was NICHT drinsteht ──────────────────────────────────────────────────
--  Keine Zugangsdaten. Gespeichert werden Geräte, Raumzuordnungen und die
--  Kennung der Quellen — kein Token, kein API-Secret, kein Kamerapasswort.
--  Eine Live-Quelle wird nach dem Neuladen wieder verbunden, und dabei fragt
--  sie erneut nach ihren Zugangsdaten.
--
--  ── Schreibrate ──────────────────────────────────────────────────────────
--  Der Client schreibt gebündelt: nur wenn sich die *Identität* des Twins
--  ändert (Gerät kommt dazu, Raumzuordnung ändert sich, Quelle verbunden),
--  gedrosselt auf höchstens einen Schreibvorgang pro zehn Sekunden. Ein Dutzend
--  pollender Lampen erzeugt keinen einzigen.
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.twin_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists twin_state_touch on public.twin_state;
create trigger twin_state_touch before update on public.twin_state
  for each row execute function public.touch_updated_at();

alter table public.twin_state enable row level security;

-- Eine Zeile pro Konto, und nur der Eigentümer sieht sie. `with check`
-- gespiegelt, sonst könnte ein Update die Zeile auf eine fremde user_id
-- umschreiben.
drop policy if exists "twin_state select" on public.twin_state;
drop policy if exists "twin_state insert" on public.twin_state;
drop policy if exists "twin_state update" on public.twin_state;
drop policy if exists "twin_state delete" on public.twin_state;

create policy "twin_state select" on public.twin_state
  for select to authenticated
  using (user_id = auth.uid());

create policy "twin_state insert" on public.twin_state
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "twin_state update" on public.twin_state
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "twin_state delete" on public.twin_state
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.twin_state to authenticated;
