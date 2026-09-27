---
name: bodycast-design-system
description: Use when designing or reviewing BodyCast pages, components, data visualizations, responsive behavior, or the asset-agnostic 3D Body Map experience.
metadata:
  short-description: BodyCast product, design, and frontend rules grounded in the current application
---

# BodyCast Design System

Use this skill for BodyCast UI work. Treat source code and current contracts as evidence; keep proposed changes separate from approved behavior. This product is a personal training diary, health history, analytics, and forecasting application, not a generic fitness marketing site.

## Status vocabulary

- **CURRENT** means visible in the checked-in implementation.
- **APPROVED** means an explicit product contract recorded in code or the user's accepted requirements.
- **PROPOSED** means a suggestion that needs product review before becoming a requirement.
- **UNKNOWN** means not verified in code or the available browser context.

Do not turn PROPOSED or UNKNOWN items into product facts.

## Product and data rules

- **CURRENT:** Primary app navigation is Dashboard, History, Training, Forecast, Goal, Model status, and Profile. The app has Ukrainian and English copy.
- **APPROVED:** Body Map is 3D-first with one persistent full-body scene, 20 visual groups, hierarchy, deep anatomy, bilateral selection, camera/view navigation, and URL-backed selection state. Preserve shared training-exposure semantics and performance profiles. A 2D map is a fallback when 3D is unavailable.
- **APPROVED:** Bilateral selection highlights the represented left/right anatomy together. Side identity can remain internal; do not add user-facing Left/Right muscle selection. Existing `view=left/right` navigation is camera orientation.
- **CURRENT:** Training exposure distinguishes direct, indirect, no recorded mapped exposure, partial mapping, and unavailable. A count describes recorded sets, not a physiological dose or proof of inactivity.
- Never present demo fixtures as a person's data. Keep missing/unavailable separate from zero and preserve source coverage, provenance, uncertainty, and historical snapshots.
- Do not make medical, hypertrophy, energy, or forecast certainty claims that the data/model does not support. Preserve existing physiology, energy, Unified, forecast, and training contracts unless the task explicitly changes them.

## Visual language (CURRENT)

The source of truth is `src/app/globals.css`. The app is always dark in the current rollout.

- Canvas `--bg`: `#07090a`.
- Surfaces: `--surface-1 #111516`, `--surface-2 #171d1b`, `--elevated #1c2421`, inset `#0b0e0f`.
- Borders: `#2a3531` and strong `#384640`.
- Text: `#eef2f0`, secondary `#97a49d`, muted `#6f7d76`.
- Primary: `#4db890`, strong `#63c7a2`, pressed `#3f9f7c`; info `#4a9bab`; warning `#c49648`; danger `#c96b6b`; success `#45a87a`.
- Chart roles: history `#97a49d`, forecast `#4db890`, target `#d4a07a`; boundary/grid/axis use the corresponding global chart variables.
- Global motion token is `140ms ease`; shared press treatment is `translateY(1px)`. Reuse existing transitions and respect reduced-motion preferences for longer motion.
- Shared page shell uses max width `110rem` and gutter `clamp(1rem, 1.8vw, 1.75rem)`.
- **CURRENT:** Global body typography is Arial/Helvetica/sans-serif. Do not claim Geist is the app-wide font; the Body Map's isolated CSS has a separate font declaration.
- Use existing CSS variables and CSS Modules. The project has no adopted shadcn component system; the shadcn MCP is for reference/discovery only and does not authorize adding those components.
- Keep overlays, focus rings, disabled states, selected states, chart legends, and loading/error/empty states legible on the dark canvas. Do not encode status by color alone.

## Components and interaction

- Reuse shared `AppNav`, `HelpTip`, existing inputs/buttons/dialog patterns, and the route's CSS Module before introducing a new primitive.
- Keep labels visible and associated with fields. Prefer semantic buttons/links and native form controls. Provide keyboard focus states, keyboard operation, meaningful accessible names, and sufficiently large touch targets.
- Keep primary actions and destructive actions visually distinct. Preserve pending/disabled states and actionable errors; do not hide a failed request behind an empty card.
- At narrow widths, inspect the actual route behavior: shared navigation switches at 620px; major data/planning pages have route-specific breakpoints. Avoid horizontal page overflow; horizontally scroll genuinely wide tables within their own wrapper.
- For charts, preserve units, observed/history/forecast distinctions, target provenance, and uncertainty bands. A confidence interval or forecast range must retain its current meaning and not be relabeled as certainty.

## Frontend architecture

- **CURRENT:** Next.js App Router, Next 16.3.6, React 19.2.8, TypeScript, CSS Modules, Prisma/PostgreSQL. Keep server components as the default; put browser state, event handlers, WebGL, and browser storage in focused client components.
- Follow the versioned guides in `node_modules/next/dist/docs/` for this checkout before changing Next APIs. The installed Vercel React skill is supplementary and must not override the actual Next version's docs.
- Reuse the existing API schemas/services/repositories, i18n provider, date/timezone helpers, and request-race/abort patterns. Keep persistence out of presentation components.
- Avoid parallel sources of truth, serial request waterfalls, needless client JavaScript, repeated database lookups, stale cache assumptions, and state that can be derived from the URL or current response.
- **CURRENT:** `body-map-catalog-v2.ts` is BodyCast taxonomy/group semantics. Treat physical mesh IDs and source object labels as replaceable adapter data. Do not encode source-specific anatomy names/IDs into UI or this skill. A proposed BodyParts3D migration is not approved until separately reviewed.

## Safe visualization and Body Map

- Separate recorded exercise exposure from physiological response. Render incomplete mapping as partial/unavailable rather than filling unsupported anatomy with a score.
- Keep selected-state presentation and camera transitions synchronized with URL state; refresh and Back/Forward must restore the canonical selection.
- Preserve a persistent scene root, demand rendering, picking performance, quality profiles, bilateral highlight, deep selection, and useful loading/error behavior.
- Keep 2D fallback as a fallback; do not replace the approved normal experience with a schematic merely because an asset failed to load.
- **CURRENT:** The checked-in viewer lives at a development-only route, uses a clearly marked deterministic demo exposure fixture, and its manifest/asset APIs return 404 outside development. It is not production Body Map or user-specific training analytics.
- Do not bundle or redistribute anatomical geometry or source-derived manifests unless the exact asset's rights and notices are cleared. This skill is asset-agnostic and intentionally contains no source mesh IDs.

## Design workflow

For UI changes, review the existing route and neighboring components first; state which behavior/design is CURRENT, APPROVED, PROPOSED, or UNKNOWN; implement only the requested scope; then review desktop and mobile in a real browser when available. Check keyboard/focus, labels, contrast, reduced motion, loading/error/empty states, localization, and data provenance. Run targeted regression checks, then broader checks when their scope warrants it. Do not claim visual acceptance if screenshots or browser interaction were not actually performed.
