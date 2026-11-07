# syntax=docker/dockerfile:1
# Image de production de l'API, multi-architecture : linux/amd64 (PC, serveur) et linux/arm64
# (Raspberry Pi 4/5, mini-PC ARM).
#   docker buildx build --platform linux/amd64,linux/arm64 -t <registre>/jollof-api:<version> --push .
#
# Les dépendances de production sont 100 % JavaScript (bcryptjs, pg, socket.io…) : l'étape de
# construction tourne sur l'architecture de la machine qui construit ($BUILDPLATFORM, rapide, sans
# émulation) et ses node_modules servent tels quels sur l'autre. Un garde-fou refuse tout module
# natif (.node) qui rendrait l'image dépendante d'une architecture.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && if find node_modules -name '*.node' | grep -q .; then \
      echo 'Module natif dans les dépendances : construire sans --platform=$BUILDPLATFORM' >&2; exit 1; \
    fi \
 # README, historiques, cartes de sources et déclarations TypeScript : inutiles à l'exécution
 # (les licences restent).
 && find node_modules -type f \( -iname 'readme*' -o -iname 'changelog*' -o -iname 'history.md' -o -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \) -delete \
 && find dist -name '*.map' -delete

FROM node:22-alpine
ENV NODE_ENV=production PORT=3100
# npm, npx, corepack et yarn ne servent pas à l'exécution : autant d'outils en moins dans l'image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
WORKDIR /app
# Code et dépendances appartiennent à root, en lecture seule pour l'utilisateur `node` qui fait
# tourner l'API (et le système de fichiers est en lecture seule dans docker-compose).
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null || exit 1
# Les migrations en attente passent au démarrage (migrationsRun).
CMD ["node", "dist/main.js"]
