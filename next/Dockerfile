# syntax=docker/dockerfile:1
FROM oven/bun:1.4.0-alpine AS base
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Install dependencies in a clean layer
FROM base AS dependencies
WORKDIR /app

COPY package.json bun.lock ./
COPY patches ./patches
COPY apps/server/package.json ./apps/server/

# Sibling dependencies if built alongside
COPY packages ./packages

RUN bun install --frozen-lockfile --production

# Build / runtime stage
FROM base AS runner
WORKDIR /app

# Non-root user
USER bun

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json ./package.json
COPY apps/server ./apps/server
COPY docs ./docs

EXPOSE 3000

ENV PORT=3000

CMD ["bun", "run", "apps/server/src/index.ts"]
