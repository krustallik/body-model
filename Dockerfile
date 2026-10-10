# syntax=mirror.gcr.io/docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM public.ecr.aws/docker/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM public.ecr.aws/docker/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS development
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM dependencies AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    npm run prisma:generate && \
    npx next build

FROM dependencies AS unified-rollout-tooling
WORKDIR /app
COPY src ./src
COPY scripts/unified-v3-postflight.ts scripts/unified-v4-activate-replay.ts scripts/unified-v4-traffic-check.ts ./scripts/
COPY tsconfig.json ./tsconfig.json
RUN mkdir -p /app/dist && \
    ./node_modules/.bin/esbuild scripts/unified-v3-postflight.ts --bundle --platform=node --format=esm --packages=external --tsconfig=tsconfig.json --outfile=/app/dist/unified-v3-postflight.mjs && \
    ./node_modules/.bin/esbuild scripts/unified-v4-activate-replay.ts --bundle --platform=node --format=esm --packages=external --tsconfig=tsconfig.json --outfile=/app/dist/unified-v4-activate-replay.mjs && \
    ./node_modules/.bin/esbuild scripts/unified-v4-traffic-check.ts --bundle --platform=node --format=esm --packages=external --tsconfig=tsconfig.json --outfile=/app/dist/unified-v4-traffic-check.mjs

FROM dependencies AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY prisma ./prisma
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate --schema prisma/schema.prisma
COPY scripts/production-migration-*.mjs ./scripts/
COPY scripts/production-migration-verification-keys.json ./scripts/
COPY scripts/production-migration-preflight.mjs ./scripts/
COPY scripts/production-migration-manifests.mjs ./scripts/
COPY scripts/production-migration-integrity.mjs ./scripts/
COPY scripts/production-migration-authorization.mjs ./scripts/
COPY scripts/github-owner-identity.mjs scripts/postgres-database-identity.mjs ./scripts/
COPY scripts/production-migration-release.mjs ./scripts/
COPY scripts/production-writer-drain.mjs ./scripts/
COPY scripts/production-forward-resume.mjs scripts/production-release-marker.mjs ./scripts/
COPY scripts/production-db-preflight.mjs ./scripts/
COPY scripts/production-db-preflight.sql ./scripts/
COPY scripts/run-prisma-migrate-with-lock-timeout.mjs ./scripts/
COPY --from=unified-rollout-tooling /app/dist/unified-v3-postflight.mjs ./scripts/
COPY --from=unified-rollout-tooling /app/dist/unified-v4-activate-replay.mjs ./scripts/
COPY --from=unified-rollout-tooling /app/dist/unified-v4-traffic-check.mjs ./scripts/
USER node
CMD ["node", "scripts/run-prisma-migrate-with-lock-timeout.mjs"]

FROM public.ecr.aws/docker/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS production
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
USER nextjs
EXPOSE 3000
CMD ["sh", "-c", ": \"${DATABASE_URL:?DATABASE_URL is required}\"; : \"${IOS_SHORTCUT_API_KEY:?IOS_SHORTCUT_API_KEY is required}\"; exec node server.js"]
