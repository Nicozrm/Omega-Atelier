#!/bin/sh
# OMEGA Atelier 2.0 -- Laufzeit-Konfiguration.
#
# Vite kompiliert import.meta.env-Werte fest ins Bundle. Der Image-Build
# setzt daher Platzhalter, die hier beim Containerstart durch die echten
# Hyperlift-Umgebungsvariablen ersetzt werden. Fehlen sie, wird der
# Platzhalter zu einem leeren String -- die App laeuft dann im Local-Only-
# Modus (kein Login, keine Cloud-Speicherung), statt gegen eine kaputte URL
# zu laufen.
set -eu

ROOT="${OMEGA_WEB_ROOT:-/usr/share/nginx/html}"

replace() {
  placeholder="$1"
    value="$2"
      # / und & im Wert fuer sed maskieren.
        escaped=$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')
          find "$ROOT" -type f \( -name '*.js' -o -name '*.html' \) -exec \
              sed -i "s/${placeholder}/${escaped}/g" {} +
              }

              replace '__OMEGA_SUPABASE_URL__'      "${VITE_SUPABASE_URL:-}"
              replace '__OMEGA_SUPABASE_ANON_KEY__' "${VITE_SUPABASE_ANON_KEY:-}"

              if [ -n "${VITE_SUPABASE_URL:-}" ] && [ -n "${VITE_SUPABASE_ANON_KEY:-}" ]; then
                echo "[omega] Supabase konfiguriert: ${VITE_SUPABASE_URL}"
                else
                  echo "[omega] Supabase nicht konfiguriert - App laeuft im Local-Only-Modus."
                  fi
                  
