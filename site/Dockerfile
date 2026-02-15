FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY tsconfig.json next.config.mjs tailwind.config.ts postcss.config.mjs ./
COPY src ./src
COPY public ./public

RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
