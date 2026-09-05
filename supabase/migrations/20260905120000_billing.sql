-- ══════════════════════════════════════════════════════════════════════════
--  OMEGA ATELIER 2.0 — Abrechnung: Kunden, Bestellungen, Abos, Gutscheine
--
--  Ausführen: Supabase Dashboard → SQL Editor → New query → einfügen → Run.
--  Idempotent wie die Basis-Migration: legt nur an, was fehlt, ersetzt
--  Policies und Funktionen an Ort und Stelle, löscht nie eine Zeile.
--
--  ── Die eine Idee dieses Schemas ─────────────────────────────────────────
--  Der Tarif eines Kontos ist eine **Server-Aussage**. Bisher stand er in
--  `localStorage['omega.tier']`: eine Zeile in der Konsole, und der Browser
--  hielt sich für Max. Ab hier beantwortet `public.current_tier()` die Frage,
--  liest dafür ausschliesslich `subscriptions`, und in diese Tabelle schreibt
--  **kein** Client — nur der Webhook mit der Service-Rolle.
--
--  Deshalb steht hier auch nirgends ein `grant insert` für `authenticated`.
--  Wer bezahlt hat, ist keine Angabe, die der Zahlende selbst machen darf.
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

/*
 * `touch_updated_at` steht auch in `20260812000000_init.sql` — hier noch einmal,
 * und das ist kein Versehen.
 *
 * Eine Migration, die eine Funktion aus einer anderen Migration voraussetzt,
 * lässt sich nur in genau einer Reihenfolge und nur auf genau einer Datenbank
 * anwenden. Beim Einspielen fiel dieser Unterschied auch prompt auf: die
 * Live-Datenbank kannte `set_updated_at`, weil sie einen älteren Stand fährt —
 * die Abrechnung wäre an einem fehlenden Trigger gescheitert, nicht an ihrer
 * eigenen Logik.
 *
 * `create or replace` mit identischem Rumpf: zweimal ausführen ändert nichts,
 * und diese Datei läuft ab jetzt auf jeder Datenbank für sich.
 */
create or replace function public.touch_updated_at()
returns trigger language plpgsql
-- Fester search_path. Ohne ihn läuft die Funktion mit dem Pfad des Aufrufers,
-- und wer eine eigene `now()` in ein vorgeschaltetes Schema legt, bestimmt
-- damit den Inhalt einer fremden Spalte. Leer statt `public`, weil hier nur
-- Builtins gebraucht werden — pg_catalog wird immer implizit durchsucht.
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ═══════════════════════ 1 · RECHNUNGSKUNDE ═══════════════════════════════
-- Adresse und Steuerdaten, wie sie auf den Beleg gehören. Eine Zeile je Konto.

create table if not exists public.billing_customers (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text not null,
  business     boolean not null default false,
  company      text,
  vat_id       text,
  vat_verified boolean not null default false,
  street       text not null,
  postal_code  text not null,
  city         text not null,
  country      text not null check (char_length(country) = 2),
  phone        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists billing_customers_touch on public.billing_customers;
create trigger billing_customers_touch before update on public.billing_customers
  for each row execute function public.touch_updated_at();

-- ═══════════════════════ 2 · BESTELLUNGEN ═════════════════════════════════
/*
 * Eine Bestellung ist der Beleg eines Zahlungsversuchs — auch eines
 * gescheiterten. Fehlversuche zu löschen wäre bequem und falsch: „warum wurde
 * ich zweimal belastet?" lässt sich nur mit der vollständigen Reihe
 * beantworten.
 *
 * `idempotency_key` ist eindeutig, und das ist die eigentliche Schutzfunktion
 * dieser Tabelle. Ein Doppelklick auf „Kostenpflichtig bestellen", ein
 * wiederholter Webhook, ein Netzabbruch mit Neuversuch: alle drei kommen mit
 * demselben Schlüssel an und treffen auf dieselbe Zeile, statt zwei Abbuchungen
 * zu erzeugen.
 */
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete set null,
  idempotency_key  text not null unique,
  email            text not null,
  tier             text not null check (tier in ('pro', 'max')),
  interval         text not null check (interval in ('monthly', 'yearly')),
  seats            integer not null default 1 check (seats >= 1),
  currency         text not null check (char_length(currency) = 3),

  -- Alle Beträge in Minor Units. `numeric` wäre hier genauer als nötig und
  -- `float` gefährlich; ein Cent passt in ein bigint.
  net_amount       bigint not null check (net_amount >= 0),
  vat_amount       bigint not null check (vat_amount >= 0),
  total_amount     bigint not null check (total_amount >= 0),
  vat_rate         numeric(4,1) not null default 0,
  reverse_charge   boolean not null default false,

  method_id        text not null,
  provider         text not null,
  promo_code       text,
  trial_days       integer not null default 0 check (trial_days >= 0),

  status           text not null default 'pending'
                     check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded')),
  provider_ref     text,
  failure_reason   text,

  -- Zahlungsmittel nur als Erinnerungsstütze: Marke und vier Ziffern, bzw. die
  -- maskierte IBAN. Eine vollständige Kartennummer erreicht diese Datenbank
  -- nicht — siehe src/lib/billing/session.ts.
  method_label     text,

  billing_snapshot jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  paid_at          timestamptz
);

create index if not exists orders_user_idx    on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx  on public.orders (status) where status in ('pending', 'processing');
create index if not exists orders_provider_idx on public.orders (provider, provider_ref);

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

/*
 * Kartendaten dürfen hier nicht landen — auch nicht versehentlich, auch nicht
 * in `method_label` oder im JSON-Schnappschuss. Der Trigger ist die letzte
 * Instanz vor dem Speichern: er bricht ab statt zu bereinigen, denn stilles
 * Kürzen verbirgt den Fehler, während ein Abbruch dazu zwingt, ihn zu beheben.
 *
 * ── Warum Luhn und nicht nur „13 bis 19 Ziffern" ────────────────────────
 * Weil die einfache Regel zu oft danebengreift. Eine Bestellnummer aus der
 * Beschaffung („4500123456789"), eine Telefonnummer mit Leerzeichen, eine
 * lange Referenz — alles 13 Ziffern und keine Kartennummer. Ein Wächter, der
 * echte Bestellungen abweist, wird abgeschaltet, und dann bewacht er nichts
 * mehr.
 *
 * Zwei Merkmale zusammen treffen dagegen fast nur echte Karten: die
 * Luhn-Prüfsumme geht auf (Trefferquote bei zufälligen Ziffern: rund 10 %),
 * und die erste Ziffer ist eine vergebene Branchenkennung (3–6). Beides
 * gleichzeitig zufällig zu erfüllen ist selten genug, um dem Alarm zu glauben.
 */
create or replace function public.luhn_ok(digits text)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  total integer := 0;
  d     integer;
  dbl   boolean := false;
  i     integer;
begin
  for i in reverse length(digits)..1 loop
    d := ascii(substr(digits, i, 1)) - 48;
    if d < 0 or d > 9 then return false; end if;
    if dbl then
      d := d * 2;
      if d > 9 then d := d - 9; end if;
    end if;
    total := total + d;
    dbl := not dbl;
  end loop;
  return total % 10 = 0;
end;
$$;

create or replace function public.reject_card_numbers()
returns trigger
language plpgsql
-- Ruft `public.luhn_ok` voll qualifiziert auf, kommt deshalb mit leerem Pfad
-- aus. `pg_catalog` liefert regexp_matches und Konsorten.
set search_path = ''
as $$
declare
  haystack  text;
  candidate text;
begin
  haystack := coalesce(new.method_label, '') || ' ' || coalesce(new.billing_snapshot::text, '');

  -- Jede Ziffernfolge von 13 bis 19 Stellen einsammeln, Trenner vorher raus.
  for candidate in
    select regexp_replace(m[1], '[ -]', '', 'g')
    from regexp_matches(haystack, '((?:\d[ -]?){13,19})', 'g') as m
  loop
    if length(candidate) between 13 and 19
       and left(candidate, 1) between '3' and '6'
       and public.luhn_ok(candidate)
    then
      raise exception 'Kartennummern gehören nicht in orders — nur Marke und die letzten vier Stellen'
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists orders_no_pan on public.orders;
create trigger orders_no_pan before insert or update on public.orders
  for each row execute function public.reject_card_numbers();

-- ═══════════════════════ 3 · ABONNEMENTS ══════════════════════════════════
/*
 * Der Zustand, aus dem `current_tier()` liest. Genau eine aktive Zeile je
 * Konto — der Teilindex erzwingt das, statt sich auf die Anwendung zu
 * verlassen. Ein Konto mit zwei aktiven Abos wäre kein Datenfehler, den man
 * später bemerkt, sondern doppelte Abbuchung.
 */
create table if not exists public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  tier                 text not null check (tier in ('pro', 'max')),
  status               text not null
                         check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  interval             text not null check (interval in ('monthly', 'yearly')),
  seats                integer not null default 1 check (seats >= 1),
  currency             text not null,
  provider             text not null,
  provider_ref         text,
  order_id             uuid references public.orders(id) on delete set null,

  current_period_start timestamptz not null default now(),
  current_period_end   timestamptz not null,
  cancel_at_period_end boolean not null default false,
  trial_ends_at        timestamptz,
  cancelled_at         timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

-- Genau ein laufendes Abo je Konto.
create unique index if not exists subscriptions_one_live_per_user
  on public.subscriptions (user_id)
  where status in ('trialing', 'active', 'past_due');

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- ═══════════════════════ 4 · ANBIETER-EREIGNISSE ══════════════════════════
/*
 * Jeder Webhook, roh und unverändert. Zwei Gründe: Ereignisse kommen doppelt
 * (jeder Anbieter garantiert „mindestens einmal", keiner „genau einmal") —
 * `provider_event_id` ist deshalb eindeutig und macht die Verarbeitung
 * wiederholbar. Und wenn eine Abbuchung strittig wird, ist das hier die
 * einzige Fassung, die nicht von unserem Code interpretiert wurde.
 */
create table if not exists public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  provider_event_id text not null,
  event_type        text not null,
  order_id          uuid references public.orders(id) on delete set null,
  payload           jsonb not null,
  processed_at      timestamptz,
  error             text,
  received_at       timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists payment_events_order_idx on public.payment_events (order_id, received_at desc);

-- ═══════════════════════ 5 · GUTSCHEINE ═══════════════════════════════════
/*
 * Die Tabelle bleibt für Clients gesperrt. Wäre sie lesbar, liesse sich die
 * Codeliste in einer Abfrage abholen — und ein Gutschein, den jeder kennt, ist
 * ein Preisnachlass. Nachgeschlagen wird über `billing_lookup_promo`, das genau
 * einen Code beantwortet und weder Kontingent noch Nachbarn preisgibt.
 */
create table if not exists public.promo_codes (
  code             text primary key,
  label            text not null,
  percent_off      integer check (percent_off between 1 and 100),
  amount_off       bigint check (amount_off > 0),
  currency         text,
  interval         text check (interval in ('monthly', 'yearly')),
  tiers            text[],
  periods          integer check (periods > 0),
  active           boolean not null default true,
  starts_at        timestamptz,
  expires_at       timestamptz,
  max_redemptions  integer check (max_redemptions > 0),
  redemptions      integer not null default 0,
  created_at       timestamptz not null default now(),
  -- Entweder Prozent oder Betrag, nie beides und nie keines.
  constraint promo_one_kind check (
    (percent_off is not null and amount_off is null) or
    (percent_off is null and amount_off is not null)
  ),
  -- Ein fester Betrag ohne Währung wäre bedeutungslos.
  constraint promo_amount_needs_currency check (amount_off is null or currency is not null)
);

/*
 * Einen Code nachschlagen.
 *
 * `security definer`, weil die Tabelle selbst gesperrt ist. Gibt nur die
 * Konditionen zurück — kein `redemptions`, kein `max_redemptions`: aus „noch 3
 * von 100" liesse sich ableiten, wie gut eine Kampagne läuft, und das geht
 * niemanden ausserhalb an. Ob noch Kontingent frei ist, prüft die Edge Function
 * beim Einlösen.
 */
create or replace function public.billing_lookup_promo(p_code text)
-- `interval` in Anführungszeichen: in einer RETURNS-TABLE-Liste liest Postgres
-- den Bezeichner sonst als Typnamen und bricht mit einem Syntaxfehler ab. In
-- CREATE TABLE geht es unquotiert durch — derselbe Name, zwei Regeln.
returns table (
  code text, label text, percent_off integer, amount_off bigint,
  currency text, "interval" text, tiers text[], periods integer
)
language sql stable security definer
set search_path = public
as $$
  select p.code, p.label, p.percent_off, p.amount_off,
         p.currency, p.interval, p.tiers, p.periods
  from public.promo_codes p
  where p.code = upper(btrim(p_code))
    and p.active
    and (p.starts_at is null or p.starts_at <= now())
    and (p.expires_at is null or p.expires_at > now())
    and (p.max_redemptions is null or p.redemptions < p.max_redemptions)
  limit 1;
$$;

revoke all on function public.billing_lookup_promo(text) from public;
grant execute on function public.billing_lookup_promo(text) to anon, authenticated;

/*
 * Einlösung zählen.
 *
 * Wird vom Webhook gerufen, **nachdem** bezahlt wurde — nicht beim Anlegen der
 * Bestellung. Sonst verbraucht jeder abgebrochene Checkout ein Kontingent, und
 * eine auf hundert Stück begrenzte Aktion ist nach zwanzig Käufen und achtzig
 * Abbrüchen erschöpft.
 *
 * `where redemptions < max_redemptions` im Update selbst: zwei gleichzeitige
 * Einlösungen des letzten Stücks können sich so nicht überholen — die zweite
 * trifft auf keine Zeile mehr.
 */
create or replace function public.billing_redeem_promo(p_code text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  hit integer;
begin
  update public.promo_codes
     set redemptions = redemptions + 1
   where code = upper(btrim(p_code))
     and active
     and (max_redemptions is null or redemptions < max_redemptions);
  get diagnostics hit = row_count;
  return hit > 0;
end;
$$;

-- Nur die Service-Rolle. Ein Client, der Einlösungen hochzählen darf, kann
-- fremde Kampagnen leerlaufen lassen.
revoke all on function public.billing_redeem_promo(text) from public, anon, authenticated;

-- Reine Rechenhilfe des PAN-Wächters, kein API-Endpunkt.
revoke all on function public.luhn_ok(text) from public, anon, authenticated;

-- ═══════════════════════ 5b · PREISBUCH ═══════════════════════════════════
/*
 * Der massgebliche Preis steht hier, nicht im Bundle.
 *
 * `src/lib/billing/catalog.ts` führt dieselben Zahlen — die braucht die Seite,
 * um ohne Rundreise ein Preisschild zu zeichnen. Verbindlich ist aber diese
 * Tabelle: `billing-checkout` rechnet ausschliesslich damit und lehnt eine
 * Bestellung ab, deren mitgeschickte Summe abweicht (`amount_mismatch`).
 *
 * Der Unterschied ist keine Förmlichkeit. Ein Preis aus dem Browser ist ein
 * Feld, das jeder ändern kann; ein Preis aus dieser Tabelle ist eine Aussage
 * der Datenbank. Weichen beide voneinander ab, ist das ein Fehler — und zwar
 * ein lauter, der die Bestellung anhält, statt still den falschen Betrag zu
 * buchen.
 *
 * Lesbar für alle: ein Preisschild ist kein Geheimnis, und so kann der Client
 * die eigene Anzeige gegenprüfen.
 */
create table if not exists public.billing_prices (
  tier          text not null check (tier in ('pro', 'max')),
  interval      text not null check (interval in ('monthly', 'yearly')),
  currency      text not null check (char_length(currency) = 3),
  unit_amount   bigint not null check (unit_amount >= 0),
  active        boolean not null default true,
  updated_at    timestamptz not null default now(),
  primary key (tier, interval, currency)
);

insert into public.billing_prices (tier, interval, currency, unit_amount) values
  ('pro', 'monthly', 'EUR',   900), ('pro', 'yearly', 'EUR',  9000),
  ('pro', 'monthly', 'CHF',   950), ('pro', 'yearly', 'CHF',  9500),
  ('pro', 'monthly', 'GBP',   800), ('pro', 'yearly', 'GBP',  8000),
  ('pro', 'monthly', 'USD',  1000), ('pro', 'yearly', 'USD', 10000),
  ('max', 'monthly', 'EUR',  1900), ('max', 'yearly', 'EUR', 19000),
  ('max', 'monthly', 'CHF',  1950), ('max', 'yearly', 'CHF', 19500),
  ('max', 'monthly', 'GBP',  1700), ('max', 'yearly', 'GBP', 17000),
  ('max', 'monthly', 'USD',  2000), ('max', 'yearly', 'USD', 20000)
on conflict (tier, interval, currency) do nothing;

alter table public.billing_prices enable row level security;

drop policy if exists "prices readable" on public.billing_prices;
create policy "prices readable" on public.billing_prices
  for select using (active);

grant select on public.billing_prices to anon, authenticated;

-- ═══════════════════════ 6 · DER TARIF ════════════════════════════════════
/*
 * Die Frage, um die es geht: welchen Tarif hat dieses Konto?
 *
 * Beantwortet aus `subscriptions` und sonst nichts. `past_due` zählt
 * absichtlich noch als bezahlt — eine geplatzte Lastschrift ist ein Vorgang von
 * ein paar Tagen, und jemandem in dieser Zeit die eigenen Pläne zu sperren
 * wäre die falsche Reihenfolge. Erst `expired` oder `cancelled` nimmt den
 * Zugang; der Webhook setzt das, wenn der Zahlungsversuch endgültig scheitert.
 *
 * Läuft die Periode ab, ohne dass eine Verlängerung eintrifft, greift das
 * `current_period_end`-Kriterium: kein Abo ohne bezahlten Zeitraum.
 */
create or replace function public.current_tier()
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select s.tier
     from public.subscriptions s
     where s.user_id = auth.uid()
       and s.status in ('trialing', 'active', 'past_due')
       and s.current_period_end > now()
     order by case s.tier when 'max' then 2 when 'pro' then 1 else 0 end desc
     limit 1),
    'free'
  );
$$;

/*
 * `revoke ... from public` allein genügt hier NICHT.
 *
 * Supabase erteilt `anon` und `authenticated` EXECUTE direkt, nicht über die
 * Rolle PUBLIC — der Entzug von PUBLIC lässt den direkten Grant unberührt.
 * Nachgemessen: nach dem ersten Einspielen stand `has_function_privilege('anon',
 * 'current_tier()', 'EXECUTE')` weiterhin auf true, und der Datenbank-Linter
 * meldete es als „Public Can Execute SECURITY DEFINER Function".
 *
 * Schaden hätte es keinen angerichtet — ohne Sitzung ist `auth.uid()` null und
 * die Antwort „free". Aber eine SECURITY-DEFINER-Funktion, die ohne Anmeldung
 * erreichbar ist, ist eine Angriffsfläche mehr, als der Zweck verlangt.
 */
revoke all on function public.current_tier() from public, anon;
grant execute on function public.current_tier() to authenticated;

/*
 * Das laufende Abo mit den Feldern, die die Konto-Seite zeigt. Als Funktion und
 * nicht als View, damit dieselbe `security definer`-Grenze gilt und der Client
 * nicht doch über die Tabelle stolpert.
 */
create or replace function public.my_subscription()
returns table (
  tier text, status text, "interval" text, seats integer, currency text,
  current_period_end timestamptz, cancel_at_period_end boolean, trial_ends_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select s.tier, s.status, s.interval, s.seats, s.currency,
         s.current_period_end, s.cancel_at_period_end, s.trial_ends_at
  from public.subscriptions s
  where s.user_id = auth.uid()
    and s.status in ('trialing', 'active', 'past_due')
  order by s.created_at desc
  limit 1;
$$;

revoke all on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;

/*
 * Kündigen zum Periodenende — die einzige Schreiboperation, die ein Client an
 * seinem Abo auslösen darf, und selbst die setzt nur ein Flag. Der Zugang läuft
 * bis zum bezahlten Ende weiter; ein sofortiger Entzug wäre die Rückerstattung
 * schuldig, die hier niemand auslösen kann.
 */
create or replace function public.cancel_my_subscription(p_cancel boolean default true)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  hit integer;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = 'insufficient_privilege';
  end if;
  update public.subscriptions
     set cancel_at_period_end = p_cancel,
         cancelled_at = case when p_cancel then now() else null end
   where user_id = auth.uid()
     and status in ('trialing', 'active', 'past_due');
  get diagnostics hit = row_count;
  return hit > 0;
end;
$$;

revoke all on function public.cancel_my_subscription(boolean) from public, anon;
grant execute on function public.cancel_my_subscription(boolean) to authenticated;

-- ═══════════════════════ 7 · ROW LEVEL SECURITY ═══════════════════════════

alter table public.billing_customers enable row level security;
alter table public.orders            enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.payment_events    enable row level security;
alter table public.promo_codes       enable row level security;

-- ── BILLING_CUSTOMERS ─────────────────────────────────────────────────────
-- Die eigene Rechnungsadresse darf man sehen und pflegen.
drop policy if exists "billing customer select" on public.billing_customers;
drop policy if exists "billing customer upsert" on public.billing_customers;
drop policy if exists "billing customer update" on public.billing_customers;

create policy "billing customer select" on public.billing_customers
  for select to authenticated using (user_id = auth.uid());

create policy "billing customer upsert" on public.billing_customers
  for insert to authenticated with check (user_id = auth.uid());

create policy "billing customer update" on public.billing_customers
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── ORDERS ────────────────────────────────────────────────────────────────
-- Lesen ja, schreiben nein. Bestellungen legt ausschliesslich die Edge
-- Function an; ein Client, der seine eigene Bestellung auf `paid` setzen kann,
-- braucht keine Zahlung mehr.
drop policy if exists "orders select" on public.orders;
create policy "orders select" on public.orders
  for select to authenticated using (user_id = auth.uid());

-- ── SUBSCRIPTIONS ─────────────────────────────────────────────────────────
-- Dasselbe, und aus demselben Grund. Geschrieben wird nur mit der
-- Service-Rolle, die RLS ohnehin umgeht.
drop policy if exists "subscriptions select" on public.subscriptions;
create policy "subscriptions select" on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

-- ── PAYMENT_EVENTS · PROMO_CODES ──────────────────────────────────────────
-- Keine Policy = kein Zugriff für anon/authenticated. Beides ist ausschliesslich
-- Sache der Service-Rolle. Bewusst leer gelassen, nicht vergessen.

-- ═══════════════════════ 8 · RECHTE ═══════════════════════════════════════

grant select                 on public.orders            to authenticated;
grant select                 on public.subscriptions     to authenticated;
grant select, insert, update on public.billing_customers to authenticated;
-- payment_events und promo_codes bekommen bewusst kein grant.

-- ═══════════════════════ 9 · KAMPAGNEN ════════════════════════════════════
-- Startgutschein. `on conflict do nothing`, damit ein erneuter Lauf einen
-- bereits angepassten oder abgelaufenen Code nicht wiederbelebt.

insert into public.promo_codes (code, label, percent_off, interval, periods, active)
values ('ATELIER20', 'Atelier-Start — 20 % im ersten Jahr', 20, 'yearly', 1, true)
on conflict (code) do nothing;
