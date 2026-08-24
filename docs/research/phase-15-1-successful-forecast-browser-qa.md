# Phase 15.1 — Successful forecast browser QA

## Scope

This pass validates the populated forecast experience against an isolated real PostgreSQL database. It does not change the forecasting or recovery algorithms. Browser checks were performed in the in-app Chromium browser against the normal `/forecast` page and API routes.

The deterministic QA clock is `2026-10-20T10:00:00.000Z`. It is accepted only outside production and only when `BODYCAST_QA_MODE=1`. The fixture refuses to run unless the database name is exactly `bodycast_qa`.

## Reproduction

1. Create an isolated PostgreSQL database named `bodycast_qa` and apply the Prisma migrations.
2. Set `DATABASE_URL` to that database, `BODYCAST_QA_MODE=1`, and `BODYCAST_QA_NOW=2026-10-20T10:00:00.000Z`.
3. Seed the main happy path with `npm run qa:forecast-fixture -- deterministic`.
4. Start the application normally and open `/forecast`.

Additional fixture states are `limited-history`, `insufficient-donors`, `recovered`, `degraded`, `awaiting`, `degenerate`, and `stale`.

## Browser coverage

| Area | Result |
| --- | --- |
| Historical line, forecast boundary, median, 50% band, 90% band | Visible and readable |
| Horizons | 7, 30, 90, 180, and 365 days completed |
| Metrics | Weight, fat mass, lean tissue, and glycogen-associated water completed |
| Scenarios | Recent behavior, exact plan, and flexible plan completed |
| Exact-plan zeros | Zero strength and no occupational work remained explicit |
| Request race | A 365-day request followed immediately by 30 days retained only the 30-day result |
| DST boundary | Daily sequence remained consecutive across Europe/Bratislava DST on 2026-10-25 |
| Recovery states | Recovered and degraded rendered forecasts; awaiting and degenerate remained blocked |
| Stale recovery | The real recovery action refreshed the state without a client error |
| Donor fallback | Recent behavior explained the 14-day donor minimum; exact plan remained usable |
| Mobile | 390 × 844 viewport had no horizontal overflow; controls, chart, and tooltip remained usable |
| Tooltip | Selected metric, date, history/forecast context, intervals, and median remained readable in dark mode |
| Keyboard focus | Interactive controls and the native diagnostics summary have an explicit focus-visible outline |

The 30-day deterministic endpoint is 2026-11-18. The displayed weight summary rounds the raw endpoint median `80.9764405117 kg` to `81.0 kg`; the 50% range rounds to `80.9–81.1 kg` and the 90% range to `80.7–81.2 kg`. Percentile ordering held for every forecast day.

## Artifacts

- `artifacts/phase-15.1/forecast-desktop-1440x1000.png`
- `artifacts/phase-15.1/forecast-desktop-tooltip.png`
- `artifacts/phase-15.1/forecast-mobile-390x844.png`
- `artifacts/phase-15.1/forecast-mobile-tooltip.png`

## Outcome

The successful populated forecast path is usable on desktop and mobile. The pass also hardened tooltip contrast, mobile metric navigation, stale-result invalidation, overlapping-request handling, submitted-plan disclosure, limited-personalization messaging, historical glycogen unit semantics, and deterministic QA setup.
