FROM node:24.14.1-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:24.14.1-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /var/lib/cravecart/uploads && chown node:node /var/lib/cravecart/uploads
USER node
EXPOSE 4000 4001 4002 4003 4004 4005 4006
CMD ["node", "services/auth/dist/index.js"]
