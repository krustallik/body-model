# BodyCast agent tooling

Portable guidance for coding agents and developers. Distinguishes required project files from optional user-level tools.

## Required project files

These live in Git and must work without any personal MCP/OAuth setup:

| Path | Purpose |
|---|---|
| `AGENTS.md` | Shared Cursor/Codex project instructions |
| `CLAUDE.md` | Points agents at `AGENTS.md` |
| `.agents/skills/bodycast-design-system/` | Canonical BodyCast Design System Skill |
| `.cursor/rules/bodycast-ui-design.mdc` | Thin Cursor adapter: UI files → Design System |
| `.cursor/rules/bodycast-dev-safety.mdc` | Always-on safety adapter (worktrees, DB, prod ops) |

The Design System skill is authoritative. Cursor rules must reference it; they must not become a second full copy that can drift.

## Optional user-level design skills

Install or link these at user scope (`~/.cursor/skills` or Codex skills). Do not vendor them into this repository unless license review explicitly allows redistribution.

| Skill | Role |
|---|---|
| `frontend-design` | Visual hierarchy, typography, composition |
| `web-design-guidelines` | Accessibility and UX review checklists |
| `vercel-react-best-practices` | React/Next performance patterns |

These skills supplement BodyCast. They never override `.agents/skills/bodycast-design-system/SKILL.md` or invent a new product theme.

## Optional IDE extensions

| Extension | Use |
|---|---|
| Prisma | Schema navigation and validation |
| ESLint | Inline lint |
| Prettier | Format on save |
| Error Lens | Surface diagnostics in-editor |
| GitLens | Blame / history |
| GitHub Actions | Workflow status in IDE |

## Optional MCP / browser tooling

| Tool | Status | Notes |
|---|---|---|
| Context7 | Optional | Up-to-date library docs. May require OAuth. Docs only — never production DB. |
| Playwright MCP / Playwright plugin | Optional | Browser QA at 360 / 390 / 768 / 1280. Preferred for visual acceptance. |
| Figma MCP | Optional | Use only when a real project Figma URL/file exists. App development must not depend on Figma being connected. |

### Authentication required

Context7 and Figma typically need user OAuth in Cursor Settings. Do not commit OAuth tokens, MCP secrets, or personal `mcp.json` into this repository.

### Local configuration (do not commit)

- User `~/.cursor/mcp.json`
- Personal browser profiles / Playwright auth storage with production cookies
- Production database URLs
- Absolute machine-specific paths in project files

## UI verification expectation

For visual UI tasks:

1. Inspect the existing route and neighbors before editing.
2. Capture before/after evidence when practical.
3. Exercise interactions (not screenshots alone).
4. Check reduced motion, keyboard focus, and narrow viewports.

Passing TypeScript and unit tests alone is not UI acceptance.
