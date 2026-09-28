# BodyCast full-site UI redesign — plan and progress

## Scope and safety

- Worktree: C:/Users/wowan/.codex/worktrees/dashboard-history-redesign/body-model
- Branch: feat/ui-dashboard-history-exploration
- Approved visual baseline: 47654005f945228af9f38d301ba67d428efc027c
- Latest checked remote main: 00798cb8eff76593a12d1f486e68ee5b65cf09da
- After the final main fetch and before the final-audit commit: feature was 9 commits ahead and 0 behind `origin/main` (`00798cb8eff76593a12d1f486e68ee5b65cf09da`). No merge or rebase was performed.
- The feature worktree started clean. The main worktree also checked clean. A separate Body Map branch has uncommitted work in its own worktree; it remains untouched.
- Do not push, open a PR, merge, deploy, change APIs, schema, data, calculations, training semantics, or production infrastructure.
- Use only the feature worktree. Do not overwrite changes from parallel worktrees.

## Route and surface inventory

Verified from App Router page files. These are the 18 UI page entries (the root entry redirects):

1. / — root redirect
2. /dashboard
3. /history
4. /training
5. /training/session
6. /training/programs/new
7. /training/programs/[id]
8. /training/sessions/[id]
9. /training/sessions/[id]/edit
10. /training/backfill
11. /training/backfill/from/[workoutId]
12. /training/workouts/[id]/stepper-diagnostic
13. /body-map
14. /dev/body-map — development route
15. /forecast
16. /goal
17. /diagnostics
18. /settings/profile

No auth/login page route was found. API route handlers are outside this visual redesign.

Shared UI includes AppNav, HelpTip, DemoDataBadge, ModelStateSource, and BodyMapExperience. Dashboard and History each have route-specific client/chart components and modules. Training routes share a large training module with route-local functional panes, dialogs, and controls. ForecastChart is reused by Goal. Most form, dialog, table, chart, loading, empty, and error treatments remain route-specific; add shared primitives only when an actual repeated pattern can be extracted without changing behavior.

## Approved design contract

Balanced Premium Health Analytics is the approved visual reference, specifically the accepted Dashboard and History at 4765400. Preserve their dark canvas, current category colors, hierarchy, tonal surfaces, chart/table treatment, motion and focus patterns, responsive behavior, and navigation character. Reuse existing global tokens in src/app/globals.css and CSS Modules. Do not mechanically copy Dashboard composition to workflow screens. Preserve semantic distinctions between observed, estimated, forecast, unavailable, and missing values.

Existing reference captures are in artifacts/ui-exploration/final-polish-after:
- dashboard-1280.png, dashboard-390.png
- history-1280.png, history-390.png, history-table-1280.png, history-mobile-table-390.png
- dashboard-hover-row.png, dashboard-hover-sync.png, history-hover-chart.png, history-hover-row.png

Keep these unchanged as the regression baseline. Save new screenshots under artifacts/ui-redesign/full-site/<stage>/; use populated states where available.

## Implementation sequence

### Stage 1 — Design system and shared interface
Status: COMPLETE — canonical visual contract documented; no app CSS/JS changes were needed.

- Canonical contract: .agents/skills/bodycast-design-system/SKILL.md.
- Keep the approved global tokens and shell behavior stable. Document the accepted visual reference and usage rules; don't introduce a new component framework or unnecessary abstractions.
- Shared controls/navigation can be adjusted only when the adjustment does not alter destination, function, or approved Dashboard/History visuals.
- Verify baseline pages at 1280, 768, 390, 360, and 619/620/621 widths; compare to the accepted screenshots, and check keyboard focus, reduced motion, hover/touch, and overflow.
- Acceptance: the canonical design-system contract agrees with the approved screenshots; Dashboard/History remain visually unchanged.

### Stage 2 — Profile
Status: COMPLETE — presentation update only; profile API and save behavior unchanged.

- Route: /settings/profile.
- Refine form hierarchy, field surfaces, help/error/success/loading states, equipment assignment history, and narrow-screen layout.
- Preserve profile API, validation, save behavior, and equipment assignment behavior.
- Verify empty and populated profiles, validation errors, pending/save feedback, keyboard, touch, and responsive screenshots.
- Acceptance: all existing profile actions work and the presentation follows the approved tokens with no narrow-screen overflow.

### Stage 3 — Training diary
Status: COMPLETE

Checkpoints, each browser-reviewed before proceeding:
1. /training — diary and session list.
2. /training/session — active session, fast set entry, exercise selection, timers.
3. /training/sessions/[id] — completed workout details.
4. /training/sessions/[id]/edit — edit workflow.

- Preserve set CRUD, RIR, timers, exercise ordering, finish/cancel behavior, and training semantics.
- Preserve quick entry and mobile reachability; do not make display-only surfaces look like buttons.
- Verify populated/empty/error states and all existing interactions at 1280, 768, 390, 360, plus the 619/620/621 navigation boundary. Capture screenshots at each checkpoint.
- Acceptance: no behavior/data contract changes; core daily recording and editing flows work on touch and keyboard.
- Applied route-local four-column mobile AppNav sizing with 40 px targets, dedicated tablet wrapping, and restrained color/shadow hover states for noninteractive panels and cards. All treatments are touch-safe and reduced-motion aware; shared AppNav and Dashboard/History styles remain untouched.
- Browser QA covered populated Hub, active session, matched retrospective completion, and edit states at 1280, 768, 390, 360, and 619/620/621. No horizontal overflow or page exceptions. Verified the active-session redirect, set submission with weight 32 kg / 8 reps / RIR 2 through a mocked API, refreshed set count, next-exercise paging, touch navigation, visible keyboard focus, and reduced-motion transition duration (0s). The hovered panel border changed while its box geometry stayed identical.
- Screenshots: `artifacts/ui-redesign/full-site/stage-3/before/` and `artifacts/ui-redesign/full-site/stage-3/after/` include Hub, active/completed/edit desktop and mobile captures plus Hub panel/card hover examples. Browser-only training fixtures did not write to any database.
- Tests: five existing focused suites passed (50 tests): Training Hub UI, live session UI, session edit pager, session UX, and session routes.

### Stage 4 — Programs and historical training
Status: COMPLETE

- Routes: /training/programs/new, /training/programs/[id], /training/backfill, /training/backfill/from/[workoutId], /training/workouts/[id]/stepper-diagnostic.
- Refine program editors, selection, forms, historical workout views, Garmin matching, reconciliation states, and diagnostic information.
- Preserve immutable snapshots, matching/reconciliation rules, and all existing actions.
- Verify new/edit programs, matched/unmatched historical workouts, form errors, loading/empty states, and mobile layouts using isolated QA data only.
- Acceptance: existing editing and historical actions pass targeted tests and browser interaction review.
- Program editing, backfill, and history routes reuse the stage-3 shared Training surfaces. Added only a local hover for ordered exercise/form rows. Stepper diagnostics now use the same responsive AppNav treatment, restrained analytical-surface hover/focus styling, reduced-motion handling, and a single-line energy-range presentation; sources, availability, readings, and formulas are unchanged.
- Browser QA covered new/edit program, historical list with missing/partial/already-linked records, single-workout backfill, and populated stepper diagnostics at 1280, 768, 390, 360, and 619/620/621. No horizontal overflow or page exceptions. Verified exercise add/reorder and payload order, bulk filter/selection and mocked payload, single-workout create-to-edit navigation, diagnostic range grouping, visible keyboard ring after focus transition, 40 px touch nav target at 768, reduced-motion transition duration (0s), and stable panel/exercise-row bounds during hover.
- Screenshots: `artifacts/ui-redesign/full-site/stage-4/before/` and `artifacts/ui-redesign/full-site/stage-4/after/` contain desktop/mobile states for all five routes plus diagnostic and program-row hover examples. All write routes were intercepted in-browser; no application database was written.
- Tests: seven existing suites passed (37 tests) for program routes/reconciliation, backfill, snapshot mapping, and stepper UI/diagnostics. ESLint passed for the adjusted diagnostic client.

### Stage 5 — Forecast, Goal, and Diagnostics
Status: COMPLETE — route-local presentation changes; all calculations, results, payloads, and APIs remain unchanged.

- Routes: /forecast, /goal, /diagnostics.
- Reuse ForecastChart and existing global chart roles. Improve reading order, filters/forms, provenance, dense diagnostics, and responsive chart/table surfaces.
- Preserve observations, historical estimates, forecast, uncertainty, coverage, sources, units, all calculations, scenarios, horizons, results, and payloads.
- Use the existing isolated forecast fixture where applicable; exercise observed/estimated/forecast/unavailable coverage variants.
- Acceptance: chart meanings remain clear, no missing value becomes zero, and all calculation and route interactions remain unchanged.
- Added a consistent four-column route-local AppNav layout and 40 px link targets on tablet/phone widths for Forecast, Goal, and Diagnostics. Added restrained fine-pointer hover surfaces and hover states for scenario/metric controls, while keeping information surfaces noninteractive in appearance. Focus rings and reduced-motion behavior remain available; no global styles or shared navigation implementation changed.
- Browser QA used intercepted, read-only response fixtures for `/forecast`, `/goal`, and `/diagnostics`; every POST was intercepted, so no application database was written. It covered populated state with measured weights, historical model estimates, forward forecast quantile bands, provenance and missing-coverage distinctions, solver output with a target chart, partial-calibration gates, technical diagnostics, and mobile disclosure states. Forecast metric and scenario selection emitted the expected fixed-mode request; Goal submitted one scenario and rendered its target chart; Diagnostics technical details opened. Tablet/phone taps worked; visible keyboard focus rings and reduced-motion `0s` transitions were checked. Hover color/shadow changed with stable geometry. At 1280, 768, 390, 360, and 619/620/621, there were no page exceptions or horizontal overflow. Measured cumulative layout shift peaked at 0.00078 during forecast chart initialization.
- Before captures: `artifacts/ui-redesign/full-site/stage-5/before/{forecast,goal,diagnostics}-{1280,390}.png`. After captures at 1280, 768, 390, and 360 are under `artifacts/ui-redesign/full-site/stage-5/after/`; included result, fixed-scenario, graph-hover, card-hover, and expanded-diagnostics examples. All captures use browser-only mock data and omit the Next development indicator.
- Tests: 14 focused suites passed (101 tests), covering Forecast/Goal/Diagnostics client rendering, interactions, chart tooltip/data, UI helpers, and route behavior.

### Stage 6 — Body Map
Status: BLOCKED — do not edit this phase until parallel work is reconciled.

- Routes: /body-map and /dev/body-map.
- Preserve a full Three.js experience, anatomy and assets, selection/highlighting, camera and URL history, touch, fallback, and attribution.
- Parallel branch bodycast/full-3d-development-20260926 is active in D:/body-model at 214e9ef23b3e218b537e38e0f8013eb283566855; it has 15 commits not in this feature and a substantially different Body Map architecture and asset/license decision. Its diff removes public Body Map payloads and adds a large development viewer. This is incompatible with a safe visual-only update here.
- Do not cherry-pick, merge, reimplement, or edit either Body Map route/assets, manifests, BodyMapExperience, or navigation behavior. Continue with independent stages and report this as requiring separate worktree synchronization/product direction.
- Acceptance once unblocked: reconcile the active implementation first; then verify real 3D loading, anatomy selection, highlighting, camera controls, URL refresh/back/forward, touch, responsive panels, fallback, and attribution without replacing the scene with 2D.

### Stage 7 — Cross-route regression and final audit
Status: COMPLETE FOR UNBLOCKED ROUTES — Body Map remains blocked under Stage 6.

- Revisit every available route and checkpoint, all shared navigation and repeated surfaces, localization, keyboard/focus/contrast, reduced motion, touch, loading/error/empty states, overflow, and visual consistency.
- Recheck Dashboard/History against their screenshots after shared styles. Capture final desktop/tablet/mobile states for every completed route.
- Run typecheck, lint, targeted unit/interaction tests, isolated PostgreSQL integration tests where needed, and production build. Do not connect to production data.
- Acceptance: all unblocked routes are browser-checked; all required technical checks pass or are individually documented as unavailable; final diff contains only authorized presentation/design documentation changes.
- Final Dashboard/History browser regression ran against `BODYCAST_DEMO_MODE=1` at 1280, 768, 390, 360, and 619/620/621 px (14 route/viewport combinations). No horizontal overflow or page exceptions. Touch navigation links measured 40 px at all touch widths, including the previously short 768 px and 621 px tablet targets; desktop links stayed 34 px. Touch taps worked at 768 and 621 px.
- History's desktop table remained visible above 820 px. At 820 px and below, the table was replaced by the existing mobile day-card layout. All eight chart cards loaded in the verified populated states. Fine-pointer hover changed the selected Dashboard/History surface while its bounds remained stable; hover captures are included.
- Final captures: `artifacts/ui-redesign/full-site/stage-7/before/` and `artifacts/ui-redesign/full-site/stage-7/after/` include Dashboard/History at 1280 and 390 px; `after/` also includes both hover states. Machine-readable viewport results are in `dashboard-history-final.json`. Approved baseline captures remain unchanged.
- `npm test`: 279 files passed, 2 skipped; 2,638 tests passed, 11 skipped. `npm run lint`, `npm run typecheck`, and production `npm run build` all passed. The build used temporary local-only environment values and did not connect to a database.
- PostgreSQL integration tests were not run: no isolated `DATABASE_URL` is configured in this worktree, and the relevant fixture/integration workflows write or delete database data. No production database or fixture data was touched.
- Final code change is limited to route-local CSS Modules for 40 px coarse-pointer tablet navigation targets on `/dashboard` and `/history`; no shared AppNav, data, API, calculations, behavior, or demo fixtures changed. The progress document records findings and the Stage 6 blocker.

## QA approach

- BODYCAST_DEMO_MODE=1 is already supported for Dashboard and History; keep it read-only and test/development-only.
- For other routes, use the fixtures, route mocks, and isolated QA database paths already in the repo. Never repoint scripts at production. Browser mocks are for visual checks only; use isolated integration tests to confirm writes.
- Use real browser screenshots and interaction checks at 1280, 768, 390, 360, and widths 619/620/621 for navigation. Check hover and focus without changing layout, keyboard operation, touch controls, dialogs/forms, reduced motion, console/runtime errors, overflow, and layout shift.
- Do not claim a route/state is verified unless it was actually loaded and exercised.

## Progress log

### Initial audit — 2026-09-28
- Verified HEAD, branch, clean feature status, worktree list, fetched main ref, and main worktree status.
- Confirmed approved Dashboard/History captures exist.
- Confirmed 18 App Router page entries and no auth route.
- Found active Body Map and training-history parallel work; see stage 6 blocker and keep their overlapping files untouched.
- Stage 1 documented the approved sitewide visual contract and corrected stale Body Map route-status wording; application code and fixtures remain unchanged.
- Real-browser checks on /dashboard and /history returned HTTP 200 with demo data at 1280, 768, 390, 360, and 619/620/621 px; no horizontal overflow, browser console errors, or measured layout shift.
- Keyboard Tab showed the shared visible focus ring; the informational dashboard card changed surface color on hover without transform or geometry change. Reduced-motion and coarse-pointer touch emulation were active; navigation links measured 40 px tall.
- Screenshots: artifacts/ui-redesign/full-site/stage-1/dashboard-1280.png, dashboard-390.png, history-1280.png, history-390.png.
- Next: implement the Training Diary checkpoints, then continue with the independent route groups.
### Stage 1 — 2026-09-28
- Documented the approved sitewide visual reference in the canonical BodyCast design-system skill. Existing global tokens and shared shell already matched; no app CSS/JS changes were needed.
- Clarified feature-branch Body Map route status and recorded the active parallel implementation as a blocker. No Body Map runtime files were touched.
- Browser QA: Dashboard and History loaded HTTP 200 with demo data at 1280, 768, 390, 360, and 619/620/621 px. No horizontal overflow, console errors, or measured layout shift. Keyboard focus ring, informational-card hover without geometry change, reduced-motion emulation, and coarse-pointer touch navigation (40 px links) were checked.
- Captures: artifacts/ui-redesign/full-site/stage-1/dashboard-1280.png, dashboard-390.png, history-1280.png, history-390.png.
- Later final browser audit found the 621–820 px coarse-pointer nav links on these two routes fell below the 40 px target used on other redesigned pages; Stage 7 corrects that locally without changing desktop or narrow-mobile layout.
### Stage 2 — Profile — 2026-09-28
- Refined the centered profile shell, form surface, fields, checkbox treatment, validation/success feedback, and reduced-motion loading indicator using existing global tokens. Kept API, validation, data, and save behavior unchanged.
- Matched this route shell to the approved navigation sizing. Browser QA found and fixed a 768 px nav overflow and a checkbox inherited from the general text-input sizing rule; the label now wraps within the control.
- Browser QA used only mocked profile API responses. Empty, populated, pending, load-error, field-validation-error, save-success, keyboard, hover, touch checkbox, and reduced-motion states were exercised. No page exceptions, overflow, or measured CLS at 1280, 768, 390, 360, and 619/620/621 px. Hover changed the card border without geometry change; touch nav links were 40 px high.
- Screenshots include before/after empty state, populated desktop/mobile, validation error, and loading state in artifacts/ui-redesign/full-site/stage-2/.
- Tests: 15 relevant Profile client/schema tests passed; ESLint passed for profile-client.tsx. Error-state browser mocks intentionally returned HTTP 400/500; no uncaught page errors occurred. No database writes were made.

### Stage 7 — Final audit — 2026-09-28
- Rechecked Git/main/worktree state. `origin/main` remained `00798cb8eff76593a12d1f486e68ee5b65cf09da`; the main worktree at `D:/body-model/.worktrees/bodycast-safe-3d-publication` was clean. The active Body Map worktree at `D:/body-model` remains on `bodycast/full-3d-development-20260926` with pre-existing untracked `.agents/`, `.pnpm-store/`, `docs/audits/bodycast-application-and-design-system-audit-2026-09-26.md`, and `tests/node_modules/`; it was left untouched.
- Fixed coarse-pointer tablet navigation target height at 621–820 px in the Dashboard and History route modules only. The final 14-case real-browser matrix passed with demo data, no page errors, and no horizontal overflow. Touch taps worked at 768 and 621 px; hover changed the informational chart/metric surface without geometry shifts.
- History desktop table/mobile-card behavior and eight chart cards were verified in the populated captures. Final screenshots and JSON matrix are under `artifacts/ui-redesign/full-site/stage-7/`.
- Full unit suite, lint, typecheck, and production build passed. PostgreSQL integration checks remain unrun for the isolated-database reason recorded above.
