# Auth-Setup — Google, Apple & seriöse Bestätigungsmails

Der Code ist fertig verdrahtet (E-Mail/Passwort, Google, Apple, branded
Bestätigungsmail). Diese Schritte aktivieren die Dinge, die **nur im Dashboard
bzw. bei den Providern** konfiguriert werden können — Client-Secrets gehören
niemals ins Repo.

## 1. Redirect-URLs (Pflicht, sonst schlägt jeder Login fehl)

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: die Produktions-Origin, z. B.
  `https://nicozrmn.github.io/OmegaAtelier/`
- **Redirect URLs** (eine pro Zeile), passend zur App (sie leitet nach dem
  Login auf `…/plans` mit Deploy-Base):
  - `http://localhost:5173/plans`
  - `http://localhost:4173/plans`
  - `https://nicozrmn.github.io/OmegaAtelier/plans`

Dieselbe Liste steht in `supabase/config.toml` unter
`auth.additional_redirect_urls`, falls du per CLI deployst
(`supabase link` → `supabase config push`).

## 2. Google-Login

1. Google Cloud Console → **APIs & Services → Credentials → OAuth client ID →
   Web application**.
2. **Authorized redirect URI** =
   `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
   (findest du im Supabase-Dashboard unter Authentication → Providers → Google).
3. Client ID + Secret in Supabase → **Authentication → Providers → Google**
   eintragen und aktivieren.
4. OAuth-Consent-Screen veröffentlichen (sonst nur Testnutzer).

## 3. Apple-Login

1. Apple Developer → **Certificates, Identifiers & Profiles**:
   - **App ID** + einen **Services ID** anlegen (der Services-ID-Identifier ist
     die `client_id`).
   - **Sign in with Apple** aktivieren; als Return-URL
     `https://<PROJECT-REF>.supabase.co/auth/v1/callback` eintragen.
   - Einen **Key** für „Sign in with Apple" erzeugen → daraus das Client-Secret
     (JWT) bilden.
2. Services ID + Secret in Supabase → **Authentication → Providers → Apple**
   eintragen und aktivieren.

## 4. Seriöse Bestätigungsmail

Die Vorlagen liegen unter `supabase/templates/*.html` (Gold/Noir-Branding,
E-Mail-Client-sicher). Zwei Wege, sie live zu bekommen:

- **CLI:** `supabase link --project-ref <REF>` → `supabase config push`
  überträgt `config.toml` inkl. `content_path`-Vorlagen.
- **Dashboard:** Authentication → **Email Templates** → jeweils den Inhalt der
  passenden Datei einfügen (Confirmation ← `confirmation.html`, Magic Link ←
  `magic_link.html`, Reset ← `recovery.html`, Change ← `email_change.html`,
  Invite ← `invite.html`) und den Betreff aus `config.toml` übernehmen.

**Zustellbarkeit (wichtig für „seriös"):** Der Standard-SMTP von Supabase ist
nur für Tests. Für echte, nicht im Spam landende Mails ein eigenes SMTP
hinterlegen (Resend / Postmark / SES) unter Authentication → **SMTP Settings**
und die Absenderdomain per SPF/DKIM verifizieren.

## 5. Env-Werte der App

`.env.local` (siehe `.env.example`):

```
VITE_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
```

Danach: E-Mail/Passwort löst die Bestätigungsmail aus, Google/Apple öffnen den
Provider und kehren auf `…/plans` zurück.
