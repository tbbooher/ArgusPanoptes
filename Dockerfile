FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts ./
COPY src ./src

# Build TypeScript and copy runtime YAML config next to compiled output.
RUN npm run build && mkdir -p dist/config && cp -R src/config/* dist/config/

FROM node:22-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Install Chromium + deps for Playwright (Cloudflare WAF bypass).
# Uses Debian packages — playwright-core connects via CHROMIUM_PATH env var.
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

COPY --from=build /app/dist ./dist

USER node

EXPOSE 3000

ENV PORT=3000

CMD ["node", "dist/node.js"]
