# Local fullsite QA preview

This preview uses a dedicated Docker PostgreSQL container, a named volume, and host port `127.0.0.1:55434`. Its database and user are both `bodycast_qa`. The seed refuses to run unless the process is in QA mode and the `DATABASE_URL` matches that exact local target; it also checks `current_database()` and `current_user` before clearing data.

The ignored worktree-local file `.env.fullsite-qa.local` holds the random local password, connection URL, deterministic QA clock, and a development-only API key. Do not copy it into Git or use it with another database. The seed preserves Prisma migration history and the migration-provided exercise catalog, then truncates the other tables in this isolated database and rebuilds the fixture.

## Start or refresh the preview

Run these commands in PowerShell from the BodyCast worktree:

```powershell
docker start bodycast-fullsite-qa-20260928
Get-Content .env.fullsite-qa.local | ForEach-Object {
  if ($_ -match '^(.*?)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
npm run qa:fullsite-preview
npm run env:check
npx next dev --hostname 127.0.0.1 --port 3001
```

The seed sets a fixed QA clock at `2026-09-28T10:00:00Z`, creates 120 completed historical days plus a partial current day, calculates the real 60-day model episode, and rebuilds Unified Experimental Physiology State and persisted v7 snapshots through the existing application services. It does not insert model outputs directly. Missing source values stay `null`; selected older gaps are placed before the model calibration window so the active model can use a complete observation interval. Sleep stages overlap the overnight in-bed interval and vary across days.

Set `BODYCAST_FULLSITE_PREVIEW=1` in the ignored local env file before loading it. That selects `.next-fullsite-preview` so Next can run this preview beside the existing dev server without sharing its lock or build output. Open [http://127.0.0.1:3001/dashboard](http://127.0.0.1:3001/dashboard). This server uses `BODYCAST_DEMO_MODE=0` and the isolated QA database. The existing app on port `3000` is not changed by this setup.

In a second terminal with the preview server running, capture current desktop/mobile screenshots and repeat the Forecast horizons:

```powershell
npm run qa:capture-fullsite-preview
```

The helper saves screenshots and a route/API/overflow report under the ignored `artifacts/ui-qa/fullsite-preview/` directory.

The server and database are intentionally left running for product review. To stop them later, stop the development-server terminal and run `docker stop bodycast-fullsite-qa-20260928`.
