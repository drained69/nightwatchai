# NIGHTWATCH AI — multi-stage build.
#   Stage 1 builds the SPA (produces dist/).
#   Stage 2 is a slim Node image that serves the API and the static SPA together.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    NIGHTWATCH_DATA_DIR=/data

# System user + writable data volume
RUN addgroup -S nightwatch && adduser -S -G nightwatch nightwatch && mkdir -p /data && chown -R nightwatch:nightwatch /data \
    && apk add --no-cache su-exec

# Only what we actually need to run
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/dist ./dist

# Attach the built SPA as static routes on the API server via a tiny front-loader.
# We serve dist/ from the same origin so the SPA hits the same /research /news /prices routes.
COPY server/static-serve.mjs ./server/static-serve.mjs
COPY server/docker-entrypoint.sh ./server/docker-entrypoint.sh

# Runs as root only to chown the mounted /data volume (cloud volumes mount
# root-owned), then immediately drops to the unprivileged nightwatch user.
RUN chmod +x server/docker-entrypoint.sh
ENTRYPOINT ["./server/docker-entrypoint.sh"]
CMD ["node", "server/static-serve.mjs"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
