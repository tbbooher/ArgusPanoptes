# ═══════════════════════════════════════════════════════════════════════
# Combined Dockerfile: Hono backend + Next.js report site
# ═══════════════════════════════════════════════════════════════════════

# ── Stage 1: Build Hono backend ──────────────────────────────────────
FROM node:22-alpine AS hono-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts ./
COPY src ./src

RUN npm run build && mkdir -p dist/config && cp -R src/config/* dist/config/

# ── Stage 2: Build Next.js site ─────────────────────────────────────
FROM node:22-alpine AS site-build

WORKDIR /app

COPY site/package.json site/package-lock.json site/.npmrc ./
RUN npm ci

COPY site/tsconfig.json site/next.config.mjs site/tailwind.config.ts site/postcss.config.mjs ./
COPY site/src ./src
COPY site/public ./public

RUN npm run build

# ── Stage 3: Runtime ─────────────────────────────────────────────────
FROM node:22-slim AS runtime

ENV NODE_ENV=production

# Install Chromium for Playwright (Cloudflare WAF bypass)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libnss3 \
    libxkbcommon0 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium

# ── Hono backend ─────────────────────────────────────────────────────
WORKDIR /app/backend

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=hono-build /app/dist ./dist

# ── Next.js site ─────────────────────────────────────────────────────
WORKDIR /app/site

COPY --from=site-build /app/.next/standalone ./
COPY --from=site-build /app/.next/static ./.next/static
COPY --from=site-build /app/public ./public

# ── Startup script ───────────────────────────────────────────────────
WORKDIR /app

COPY start.sh ./
RUN chmod +x start.sh

USER node

EXPOSE 3000

CMD ["./start.sh"]
