# BodyCast

BodyCast — персональний full-stack застосунок на Next.js, PostgreSQL і Prisma. Поточна версія містить health endpoint та idempotent Apple Health synchronization API. Математична модель прогнозування ще не реалізована.

## Local Development

Вимоги: Docker Engine і Docker Compose v2. Для запуску поза Docker потрібен Node.js 24 LTS та npm.

```bash
cp .env.example .env
docker compose up --build
```

Development URL: <http://localhost:3000>

Зміни TypeScript/React підхоплюються через bind mount. Контейнерні `node_modules` і `.next` зберігаються в окремих volumes.

```bash
docker compose up
docker compose down
docker compose logs -f app
```

## Testing

```bash
npm ci
npm run prisma:generate
npm run lint
npm run typecheck
npm run test:unit
npm run test:coverage
```

Integration tests потребують окремої PostgreSQL database зі застосованими migrations:

```bash
npm run prisma:migrate:deploy
npm run test:integration
```

У development Compose їх можна запустити так:

```bash
docker compose exec app npm run test:integration
```

GitHub Actions використовує окремий PostgreSQL service container `bodycast_test`; production database у тестах не використовується. Coverage показує statements, branches, functions і lines. Global thresholds навмисно не встановлені на 100%.

## Apple Health API

```bash
curl -X POST http://localhost:3000/api/v1/health/sync \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "days": [{
      "Date": "2026-08-22",
      "Weightkg": "89.15",
      "Steps": "23",
      "Strengthtrainingminutes": "22. 8. 2026, 13:01 22. 8. 2026, 14:16"
    }]
  }'
```

`days` має містити рівно один запис — дані за сьогодні. Сервер сам обчислює
`strengthTrainingMinutes` з часу початку та завершення останнього тренування. Якщо
останнє тренування почалося не в дату цього денного запису, сервер зберігає `0`,
тобто сьогодні тренування не було. Повторний запит за ту саму дату оновлює наявний
daily record.

## Production Build

Next.js використовує standalone output. Production container запускається від непривілейованого користувача `nextjs` і не містить повного development source tree.

```bash
npm run build
docker build --target production -t bodycast-app:latest .
docker compose --env-file .env.production.example -f docker-compose.prod.yml config
```

Prisma CLI ізольований в окремому `migrator` image і не додається до runtime app image.

## Server Setup

BodyCast використовує вже наявні на сервері Docker, Caddy, wildcard DNS і external network `gymbeam-internal`. Другий Caddy та порти `80/443` не створюються. App і PostgreSQL не публікують host ports.

Одноразова підготовка:

```bash
sudo mkdir -p /srv/bodycast
sudo chown -R DEPLOY_USER:DEPLOY_USER /srv/bodycast
cd /srv
git clone git@github.com:OWNER/BODYCAST.git bodycast
cd /srv/bodycast
cp .env.production.example .env
chmod 600 .env
```

Заповніть `.env` реальними випадковими secrets. Password у `DATABASE_URL` має бути URL-encoded. Перевірте доступ сервера до repository:

```bash
git fetch origin main
docker network inspect gymbeam-internal
```

Production resources мають окремі назви: `bodycast-app-prod`, `bodycast-db-prod`, `bodycast-postgres-prod`, `bodycast-backend-prod`.

## GitHub Secrets

Створіть GitHub Environment `production` і додайте:

| Secret | Приклад/призначення |
| --- | --- |
| `SSH_HOST` | IP Ubuntu-сервера |
| `SSH_USER` | deployment user |
| `SSH_PRIVATE_KEY` | ключ GitHub Actions → server |
| `SSH_PORT` | SSH port, зазвичай `22` |
| `DEPLOY_PATH` | `/srv/bodycast` |
| `APP_HOST` | `bodycast.mapa-svietidiel.sk` |
| `CADDY_ROUTES_PATH` | `/srv/gymbeam/runtime/caddy-dynamic` |

SSH key дозволяє Actions зайти на сервер. Для private repository окремо перевірте, що сервер має deploy key/read access до BodyCast repository.

## First Deployment

Після server setup можна запустити workflow вручну або виконати:

```bash
cd /srv/bodycast
APP_HOST=bodycast.mapa-svietidiel.sk \
CADDY_ROUTES_PATH=/srv/gymbeam/runtime/caddy-dynamic \
bash scripts/deploy.sh
```

Deploy script:

1. перевіряє production Compose;
2. зберігає попередній app image для rollback;
3. збирає runtime і migrator images;
4. очікує healthy PostgreSQL;
5. запускає `prisma migrate deploy`;
6. оновлює тільки BodyCast app;
7. перевіряє container health;
8. atomically записує `bodycast.caddy`, validate/reload існуючого `gymbeam-caddy`;
9. перевіряє HTTPS `/api/health`.

Deployment workflow запускається лише для push у `main` після успішного CI job.

## Database Migrations

Production використовує тільки:

```bash
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
```

Ця команда виконує `prisma migrate deploy`. `prisma migrate dev` дозволений лише локально для створення нових migrations:

```bash
docker compose exec app npm run prisma:migrate -- --name describe_change
```

## Rollback

Якщо новий app не стає healthy, `scripts/deploy.sh` автоматично повертає `bodycast-app:rollback` і recreates app container. PostgreSQL volume не видаляється.

Database migrations автоматично назад не відкочуються. Production migrations мають бути backward-compatible; для destructive schema change потрібна окрема reviewed forward-fix migration.

Ручний rollback image:

```bash
docker image tag bodycast-app:rollback bodycast-app:latest
docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate app
```

## Logs

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs --tail=100 db
docker logs --tail=100 gymbeam-caddy
curl -fsS https://bodycast.mapa-svietidiel.sk/api/health
```

API keys і database passwords не логуються application code.

## Backup

Створити timestamped PostgreSQL backup на сервері:

```bash
mkdir -p /srv/bodycast/backups
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "/srv/bodycast/backups/bodycast-$(date +%Y%m%d-%H%M%S).dump"
```

Змінні shell можна завантажити без виводу secrets:

```bash
set -a
source .env
set +a
```

Регулярно копіюйте backups за межі цього сервера та періодично перевіряйте відновлення на окремій test database.
