# Marken-Connectors — Govee, SwitchBot, Tuya, Alexa, Lockin

Alle fünf Marken erscheinen im Digital Twin (Connectors-Ansicht). Standard ist
die **authentische Simulation** deiner realen Geräteflotte — sofort nutzbar,
offline. Für **echte physische Steuerung** gibt es drei Wege:

## 1. Govee — direkt über die offizielle Cloud (Live)

1. Govee Home App → Profil → „Über uns" → „Apply for API Key" → Key kommt per
   Mail.
2. Browser blockieren Vendor-APIs ohne CORS-Header → einmalig das Relay
   deployen (unten) und beides in der App eintragen (Connectors → Karte
   „Hersteller-Clouds"): **API-Key + Relay-URL** → „Live verbinden".
3. Danach schalten Toggles/Szenen deine Govee-Lichter physisch (an/aus,
   heller/dunkler, Farbe, Farbtemperatur).

## 2. SwitchBot — direkt über die offizielle Cloud (Live)

1. SwitchBot App → Profil → Einstellungen → 10× auf „App-Version" tippen →
   „Entwickleroptionen" → **Token + Client Secret** (API v1.1).
2. Token + Secret + Relay-URL in der Karte „Hersteller-Clouds" eintragen →
   „Live verbinden". Die App signiert jede Anfrage lokal (HMAC-SHA256).
3. Bots, Locks, Curtains, Plugs und Meter erscheinen und sind steuerbar.

## 3. Tuya / Smart Life — direkt über die Tuya-Cloud (Live, inkl. Sauger)

Deckt Smart-Life-/Tuya-Geräte inklusive **Saug-/Wischroboter** ab. Einmalige
Einrichtung auf der Tuya IoT Platform:

1. [iot.tuya.com](https://iot.tuya.com) → Cloud → **Cloud-Projekt erstellen**
   (Development). Danach hast du **Access ID (Client ID)** + **Access Secret**.
2. Im Projekt → **Devices → Link App Account → Add App Account**: QR-Code mit
   der **Smart Life App** scannen. Danach erscheint deine **UID** (User-ID) —
   die brauchst du unten.
3. Projekt → **Service API**: „IoT Core" (und ggf. „Device Control") dem Projekt
   hinzufügen, sonst liefert die API keine Geräte.
4. In OMEGA (Connectors → „Hersteller-Clouds"): **Access ID, Access Secret,
   UID, Region** eintragen + Relay-URL → „Live verbinden". Die App signiert
   jede Anfrage lokal (HMAC-SHA256, Tuya v2). Sauger erscheinen mit
   Start/Stopp/Zur-Basis, Lichter/Steckdosen mit An-Aus/Dimmen/Verbrauch.

**Region** muss zum Rechenzentrum deines Smart-Life-Kontos passen (meist
Europa/Central). Roborock läuft NICHT über Tuya — dafür der HA-Weg.

**Saugroboter-Details (Kategorie `sd`).** OMEGA liest den Live-Zustand aus dem
`status`-Datenpunkt (`cleaning`/`zone_clean`/… → reinigt, `goto_charge`/
`chargego` → fährt zur Basis, `charging`/`charge_done` → an der Basis,
`standby`/`paused` → pausiert). Fehlt `status`, wird `power_go` (Start/Pause)
und ersatzweise der `mode`-DP älterer Geräte ausgewertet; `battery_percentage`
liefert den Akkustand. Gesteuert wird kanonisch: **Start** = `power_go: true`,
**Pause** = `power_go: false`, **Zur Basis** = `mode: chargego`. Meldet dein
Modell abweichende DP-Codes, siehst du sie auf iot.tuya.com unter
**Device → Debug Device → DP Instruction**.

## 3b. Alexa & Lockin — live über Home Assistant

Beide haben keine browsertaugliche Steuer-API. Der Live-Weg ist die
**Home-Assistant-Verbindung** (Karte „Echte Verbindung" oben): HA integriert
sie offiziell. Die Marken-Karten in OMEGA simulieren zusätzlich die reale
Flotte, damit Planung + Demo ohne Zugangsdaten funktionieren.

## Das CORS-Relay (einmalig, ~2 Minuten)

Die Datei liegt im Repo: `supabase/functions/vendor-relay/index.ts`.
Es speichert nichts und fügt keine Credentials hinzu — es reicht nur die
Browser-Anfragen samt deiner Header an die Hersteller-API weiter und ergänzt
CORS.

```bash
supabase link --project-ref <PROJECT-REF>
supabase functions deploy vendor-relay --no-verify-jwt
```

Relay-URL für die App:
`https://<PROJECT-REF>.supabase.co/functions/v1/vendor-relay`

## Sicherheit

- API-Keys/Token/Secret bleiben **nur im Browser** (localStorage) und gehen
  ausschließlich an die jeweilige Hersteller-API (durch dein eigenes Relay).
- Das Relay lässt nur die von Govee/SwitchBot benötigten Header durch.


## 4. ONVIF / PTZ-Kameras — Arenti und andere ONVIF-Geräte

OMEGA enthält einen generischen ONVIF-Connector. Er ist nicht an Arenti gekoppelt:
Kamera-Discovery/Media/PTZ werden über ONVIF angesprochen, während die Domain nur
die neutrale `Camera`-Capability sieht.

Wichtig: Der Browser spricht ONVIF nicht direkt. Dafür läuft ein kleiner lokaler
Bridge-Prozess auf einem Rechner im selben LAN wie die Kamera:

```bash
cd tools/onvif-bridge
npm install
OMEGA_ONVIF_BRIDGE_TOKEN="change-this" node server.mjs
```

Standard-Bridge: `http://127.0.0.1:8787`.

In OMEGA → Connectors → Echte Verbindung → ONVIF Kamera:

- Bridge-URL
- Kamera-IP
- ONVIF-Port
- ONVIF-Benutzer
- ONVIF-Passwort

Das Kamera-Passwort wird vom UI nicht in `localStorage` gespeichert.

Der Connector unterstützt:

- ONVIF-Geräteinitialisierung
- Media-Profile
- von ONVIF gelieferte RTSP-URI
- Snapshot-Fähigkeit
- PTZ ContinuousMove
- PTZ Stop
- PTZ Status
- Presets
- GotoPreset
- Home Position

PTZ wird als neutraler `Camera`-Command an den bestehenden Twin geroutet;
der Core benötigt dadurch keine Hersteller-/ONVIF-Sonderlogik.

Für den Arenti-Test wird als Startwert `192.168.0.107` und Benutzer `admin`
verwendet. Den tatsächlichen ONVIF-Port bitte aus der Kamera-App übernehmen.
