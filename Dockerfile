# syntax=docker/dockerfile:1
FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS development
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

FROM dependencies AS migrator
WORKDIR /app
ENV NODE_ENV=production
COPY prisma ./prisma
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-alpine AS production
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
