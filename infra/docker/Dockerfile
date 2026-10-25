FROM node:24.14.1-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:24.14.1-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends gosu ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /var/lib/cravecart/uploads && chown node:node /var/lib/cravecart/uploads
COPY --chmod=755 infra/docker/entrypoint.sh /usr/local/bin/cravecart-entrypoint
ENTRYPOINT ["/usr/local/bin/cravecart-entrypoint"]
EXPOSE 4000 4001 4002 4003 4004 4005 4006
CMD ["node", "services/auth/dist/index.js"]
