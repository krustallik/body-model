# Production deployment operations

## Architecture (CURRENT)

- Controller: GitHub Actions only (`BodyCast production deploy`).
- Host: VPS over SSH (`appleboy/ssh-action`).
- Runtime: Docker Compose (`docker-compose.prod.yml`) — `app` + Postgres.
- Edge: Caddy (`gymbeam-caddy`) reverse proxy to `bodycast-app-prod:3000`.
- Ordinary release script: `scripts/deploy.sh` (exact `DEPLOY_SHA`, **no migrate**).
- Schema preflight: `scripts/deploy-preflight-schema.sh` (`prisma migrate status` only).
- Separate migrate script: `scripts/deploy-migrate.sh` (requires `CONFIRM_PRODUCTION_MIGRATE=migrate`; **not** wired to automatic deploy).

There are no Vercel/Netlify auto-deploy hooks for this app.

## Automatic deploy policy

1. Push/merge to `main` runs `BodyCast CI/CD`.
2. On **successful** main **push** CI, `workflow_run` starts production deploy.
3. Gate requires:
   - source repository match;
   - workflow name `BodyCast CI/CD`;
   - conclusion `success`;
   - event `push`;
   - branch `main`;
   - CI `head_sha` equals current `origin/main` tip (rejects stale runs).
4. Deploy checks out that exact SHA on the server and recreates the app container.
5. If production schema has pending migrations, deploy **blocks** (exit 2). Ordinary deploy never runs `prisma migrate deploy`.
6. Health: container readiness + `https://$APP_HOST/api/health`.

PR CI success never deploys. Feature pushes without PR never deploy.

## High-risk operations (separate authorization)

Not performed by automatic deploy:

- `prisma migrate deploy` / `migrate reset`
- historical replay / ModelEpisode regeneration
- selection-v1 activation / visibility migration
- physiology model version switch

Default remains `bodycast-physiology-v7` until separately authorized.
