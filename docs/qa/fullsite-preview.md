# Local full-site QA preview

The preview uses synthetic health and training history in an isolated PostgreSQL database. It never needs production credentials or production data.

## Safety boundary

`scripts/qa/fullsite-preview-seed.ts` refuses to run unless all of the following are true:

- `NODE_ENV` is not `production`;
- `BODYCAST_QA_MODE=1` and `BODYCAST_DEMO_MODE=0`;
- `DATABASE_URL` targets `bodycast_qa` as role `bodycast_qa` on `127.0.0.1:55434`;
- the connected database reports that exact name and role.

The seed clears preview rows and rebuilds its fixture. It retains Prisma migration history, Profile 1, the synthetic User row, and the migration-seeded exercise catalog/configuration so their foreign-key relationships remain valid. Never weaken these identity checks or point the script at a database containing personal records.

## Fresh database prerequisite

The current Auth migration intentionally requires a pre-existing Profile 1. A bare `prisma migrate deploy` against an empty database therefore stops at `20261027120000_auth_multiuser`.

The PostgreSQL integration job in [CI](../../.github/workflows/ci.yml) documents the supported order: apply the 74-migration legacy schema from baseline commit `0f93f37dd6a4208cfc74331a0fb4c063c542c6bd`, insert a synthetic legacy Profile 1, then apply the current migration tree. Use that order only against a disposable local database. Do not try a production URL.

Example disposable database container (no named or persistent volume):

```bash
docker run -d \
  --name bodycast-fullsite-preview-db-local \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=800m \
  -e POSTGRES_DB=bodycast_qa \
  -e POSTGRES_USER=bodycast_qa \
  -e POSTGRES_PASSWORD=local-preview-only \
  -p 127.0.0.1:55434:5432 \
  postgres:17-alpine
```

Choose a unique container name if that one already exists. Set a local connection URL for the commands in this guide:

```bash
export DATABASE_URL='postgresql://bodycast_qa:local-preview-only@127.0.0.1:55434/bodycast_qa'
npm run prisma:generate
```

Prepare the legacy baseline, insert a synthetic Profile 1 row, and apply the remaining migrations by following the `Apply legacy baseline and Auth migration precondition` step in the CI workflow. The workflow pins the baseline commit and uses an isolated test database; mirror its migration order, not its test credentials.

## Seed synthetic records

Run the existing guarded seed:

```bash
export NODE_ENV=development
export BODYCAST_QA_MODE=1
export BODYCAST_DEMO_MODE=0
export BODYCAST_QA_NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
npm run qa:fullsite-preview
```

The seed creates 120 completed history days plus a partial day, synthetic health samples, Stepper and strength workouts, training programs, matched strength sessions, a model episode, and persisted V7 output. It calls the normal application model services; it does not insert precomputed model results. The deterministic seed is repeatable in the same disposable database.

## Run the app locally

Set local-only Auth and API values in the process environment or an ignored local `.env` file. Use a test mailbox with a non-production email provider. The authenticated pages require a valid local session; no production session cookies should be copied into this environment.

```bash
export BODYCAST_FULLSITE_PREVIEW=1
npx next dev --hostname 127.0.0.1 --port 3001
```

Open <http://127.0.0.1:3001/dashboard>. `BODYCAST_FULLSITE_PREVIEW=1` gives Next a separate `.next-fullsite-preview` directory so this instance does not share build state with a port-3000 dev server.

## Current preview limitations

- The seed creates V7 outputs but does not publish Unified V4. A fresh seed alone therefore leaves Forecast and Goal without a current upstream state. The README forecast capture was generated only after publishing synthetic V4 output in the disposable local QA database.
- `scripts/qa/capture-fullsite-preview.ts` performs API preflight requests without forwarding a session cookie. It is not currently compatible with the session-protected API routes until its auth handling is updated.
- The checked-in README screenshots were captured from this synthetic database using a transient local test session and an in-memory OTP mail stub. No real email was sent and no production account was used.
- The seed sets the Profile 1 preview locale to English and uses English names for its synthetic training programs and exercise snapshots.

To stop the disposable database, stop only the container created for this preview:

```bash
docker stop bodycast-fullsite-preview-db-local
```

Because its data directory is a `tmpfs`, stopping that container discards the temporary database. The app server should be stopped from its own terminal.
