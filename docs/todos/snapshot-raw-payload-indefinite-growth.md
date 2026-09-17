# TODO: HealthSyncSnapshot.rawPayload indefinite growth

**Status:** open (do not optimize yet)  
**ID:** `snapshot-raw-payload-indefinite-growth`  
**Opened:** 2026-09-17 (durable-source retention stage)

## Context

`HealthSyncSnapshot` is now a **durable** canonical source because cumulative
`steps` / `walkingDistanceKm` (+ timestamps) are required for identical rebuild
of work-walking partition and stair-overlap subtraction.

Every successful Shortcut sync **appends** a snapshot, including full
`rawPayload` JSON. Overlapping same-day syncs therefore accumulate large
payloads indefinitely.

## Why not HR first

Raw HR (~720 samples/day) is sizable but relatively bounded. Snapshot
`rawPayload` may become the larger per-profile storage consumer under frequent
re-sync, even for a single user.

## Correctness stance (current)

Do **not** strip, compress, or prune `rawPayload` yet. Single-user correctness /
rebuildability outranks storage size.

## Future options (when scale demands)

1. Retain reconstruction columns forever; TTL or externalize `rawPayload` only.
2. Store a compact sync fingerprint instead of full Shortcut body after N days.
3. Cap snapshots per day after day closure (keep boundary points needed for rebuild).

Any change must preserve `inputsBeforeCleanup == inputsAfterCleanup` for
work-interval + stair days.

## Code anchors

- `src/modules/health/health-retention.ts` (TODO comment)
- `prisma/schema.prisma` → `HealthSyncSnapshot`
- Provenance: durable Variant A decision in durable-source stage
