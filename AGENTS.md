<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# BodyCast agent instructions

Shared project instructions for Cursor, Codex, and other coding agents. Keep this file portable: repository-relative paths only; no machine-specific absolute paths.

## Architecture

- Next.js App Router, TypeScript, CSS Modules, Prisma/PostgreSQL.
- Prefer server components by default; confine browser state, WebGL, and storage to focused client components.
- Reuse existing API schemas, services, repositories, i18n, date/timezone helpers, and request-race patterns.
- Follow versioned Next docs under `node_modules/next/dist/docs/` for this checkout before changing Next APIs.

## Design system (authoritative)

- Canonical skill: `.agents/skills/bodycast-design-system/SKILL.md`.
- Visual tokens: `src/app/globals.css` (always-dark Training theme in the current rollout).
- The BodyCast Design System Skill is authoritative for product UI, provenance, Body Map, and data presentation.
- Generic design skills (`frontend-design`, `web-design-guidelines`, `vercel-react-best-practices`) may supplement hierarchy, accessibility, and performance. They never override the BodyCast Design System.
- Reuse shared components (`AppNav`, `HelpTip`, existing inputs/buttons/dialogs) before inventing primitives.
- Do not introduce generic AI dashboard aesthetics that conflict with BodyCast.

## UI/UX workflow

1. Inspect the target route, neighboring screens, spacing/hierarchy, and desktop/mobile behavior before editing.
2. State CURRENT / APPROVED / PROPOSED / UNKNOWN when changing design contracts.
3. Implement only the requested scope; no unsolicited global redesign.
4. For visual work, verify in a real browser at 360 / 390 / 768 / 1280 px. TypeScript/unit tests alone are not UI acceptance.
5. Check labels, contrast, focus, touch targets, reduced motion, loading/error/empty states, and localization.

## Physiological and scientific contracts

- Unavailable / unknown energy is not confirmed zero. Preserve provenance and uncertainty.
- Do not invent physiological mathematics or rewrite raw source observations.
- Preserve Garmin mechanical priority, manual MS100 priority, reconciliation, distance conservation, occupational deduplication, strength-estimate freshness, partial coverage, Unified uncertainty, and forecast donor filtering unless the task explicitly changes them.
- Default active model remains isolated from staged selection versions. Do not activate staged selection-v1 by default.
- Keep staged versus active visibility and exact activation rollback semantics intact.

## Data and Prisma safety

- Prefer isolated `*_test` databases on localhost for agent work.
- Never point MCP, scripts, or ad-hoc tools at production PostgreSQL.
- Do not send production credentials, personal health records, or `.env` secrets to external MCP/design services.

## Git and worktrees

- Respect Git worktree isolation. Do not modify `main`, other agents' occupied worktrees, or unfinished feature branches unless explicitly assigned.
- No force-push to main/master. No destructive git rewrites unless the user explicitly orders them.
- Unfinished BodyParts3D work is out of scope unless the user explicitly assigns that branch/worktree.

## Testing

- Prefer targeted unit/integration tests for the changed surface, then broader suites when risk warrants it.
- Prisma validate / migrate only against isolated test databases unless production operations are separately authorized.
- Browser interaction QA is required for UI acceptance when the task is visual.

## Production operations (separate authorization required)

The following require an explicit user order beyond ordinary code changes:

- production Prisma migrations;
- historical replay;
- selection activation / visibility promotion;
- production deployment.

Merge of source code to `main` is not authorization for those operations. Production deploy is manual (`workflow_dispatch` + confirmation) and must not run on pull requests.

## Tooling notes

See `docs/development/agent-tooling.md` for optional user-level tools (Context7, Playwright MCP, Figma MCP, IDE extensions) versus required project files.
