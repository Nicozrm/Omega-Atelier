# OMEGA Atelier 2.0 -- Container-Image fuer Starlight Hyperlift
#
# Stage 1 baut das Vite-Bundle, Stage 2 liefert es ueber nginx aus.
# Hyperlift erwartet, dass der Container auf ${PORT} (Default 8080) hoert;
# EXPOSE wird bewusst weggelassen (siehe Hyperlift-Doku).
#
# Supabase-Zugangsdaten werden NICHT einkompiliert: der Build setzt
# Platzhalter, die beim Containerstart aus den Hyperlift-Umgebungs-
# variablen ersetzt werden. Damit reicht ein Neustart statt eines
# Rebuilds, wenn sich URL oder Anon-Key aendern.

# -- Stage 1: Build ----------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV CI=true \
    npm_config_update_notifier=false \
        npm_config_fund=false \
            npm_config_audit=false \
                NODE_OPTIONS=--max-old-space-size=896
                
                COPY package.json package-lock.json ./
                RUN npm ci
                
                COPY . .
                
                ENV VITE_SUPABASE_URL=__OMEGA_SUPABASE_URL__ \
                    VITE_SUPABASE_ANON_KEY=__OMEGA_SUPABASE_ANON_KEY__
                    
                    RUN npx vite build --sourcemap false \
                     && find dist -name '*.map' -delete
                     
                     # -- Stage 2: Runtime ---------------------------------------------------------
                     FROM nginx:1.27-alpine AS runtime
                     
                     ENV PORT=8080 \
                         VITE_SUPABASE_URL="" \
                             VITE_SUPABASE_ANON_KEY=""
                             
                             RUN sed -i '/^types {/a\    application/manifest+json              webmanifest;\n    model/gltf-binary                      glb;\n    model/gltf+json                        gltf;' /etc/nginx/mime.types
                             
                             COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
                             
                             COPY deploy/25-omega-runtime-env.sh /docker-entrypoint.d/25-omega-runtime-env.sh
                             RUN chmod +x /docker-entrypoint.d/25-omega-runtime-env.sh
                             
                             COPY --from=build /app/dist /usr/share/nginx/html
                             
                             HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
                               CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
