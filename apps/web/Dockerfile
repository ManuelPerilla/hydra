FROM node:24-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup -S hydra -g 1001 && adduser -S hydra -u 1001 -G hydra
COPY --from=build --chown=hydra:hydra /app/public ./public
COPY --from=build --chown=hydra:hydra /app/.next/standalone ./
COPY --from=build --chown=hydra:hydra /app/.next/static ./.next/static
USER hydra
EXPOSE 3000
CMD ["node", "server.js"]
