FROM node:24-bookworm-slim AS base

FROM base AS dependency-installer
WORKDIR /opt/norse/deps
COPY package*.json ./
RUN npm ci

FROM base AS builder
WORKDIR /opt/norse/build
COPY --from=dependency-installer /opt/norse/deps/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS runner
WORKDIR /opt/norse
RUN apt-get update \
  && apt-get install --no-install-recommends -y tini=0.19.0-1+b3 \
  && rm -rf /var/lib/apt/lists/* \
  && chown -R node:node /opt/norse
COPY --from=builder --chown=node:node /opt/norse/build/node_modules ./node_modules
COPY --from=builder --chown=node:node /opt/norse/build/dist ./dist
COPY --from=builder --chown=node:node /opt/norse/build/.env ./.env
USER node
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
ARG PORT=8080
ENV PORT=$PORT
EXPOSE $PORT
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node dist/main.js"]
