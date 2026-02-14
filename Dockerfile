FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts ./
COPY src ./src

# Build TypeScript and copy runtime YAML config next to compiled output.
RUN npm run build && mkdir -p dist/config && cp -R src/config/* dist/config/

FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node

EXPOSE 3000

ENV PORT=3000

CMD ["node", "dist/node.js"]

