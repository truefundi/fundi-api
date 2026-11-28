# ─── Stage 1: Install full dependencies & build TypeScript ──────────────────
FROM node:22.14.0-bookworm AS builder

ENV npm_config_cache=/tmp/.npm

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci && npx prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src/

RUN npm run build \
  && npm prune --omit=dev \
  && chmod -R a+rX /app \
  && rm -rf /tmp/.npm

# ─── Stage 2: Production runtime (non-root, openssl & ca-certificates built-in)
FROM node:22.14.0-bookworm AS runner

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["sh", "-c", "if [ \"${SKIP_PRISMA_MIGRATE:-false}\" != \"true\" ]; then ./node_modules/.bin/prisma migrate deploy; fi && exec node dist/src/main"]
