# BodyCast — audit of Training Analytics and 3D Body Map

**Audit date:** 2026-09-24  
**Repository HEAD:** aaf6c7bcea1c87886ad83333a81b158f393ae439  
**Scope:** read-only repository, production call-path, research and 3D feasibility audit.  
**Changes:** documentation only. No application code, Prisma schema, production math, tests, migrations, commits or pushes were changed/run.

## Executive summary

BodyCast already has a substantial strength-training record: versioned programs, live and retrospective diary sessions, set-level repetitions/load/RIR, immutable exercise-name and muscle-map snapshots, one-to-one matching with imported workouts, session tonnage, and an existing V7 muscle-mapping/dose/exposure contract. A per-exercise history endpoint and general health history charts also exist.

It does **not** yet have user-facing period or muscle-group analytics, an analytics API, a direct measure of work sets, per-muscle hypertrophy/progress observations, a sufficiently granular muscle taxonomy, or a segmented 3D anatomy asset. Several V7 calculations are called from production write/sync flows but persist to isolated shadow tables. They are not a production muscle-growth measure and are not surfaced as Training Analytics.

The first analytics release can mostly read the existing durable data without a migration. It can report what the diary actually records—sets, reps, supported external load, schedule and exercise-specific performance—while exposing coverage and comparability. It must label mapped muscle counts as *logged set exposure*, keep direct and indirect counts separate, and avoid turning them into a muscle-quality or hypertrophy score. More specific muscle targets and an interactive 3D map need a finer, versioned exercise taxonomy plus an asset whose mesh segmentation and license are acceptable.

## Audit method and boundaries

I read the repository instructions, Prisma models, route handlers, training and health services/repositories, activity-energy path, training/history UI and chart helpers, muscle mapping and dose contracts, adaptation/calibration contracts, experimental-shadow services, test inventory, and the existing V7 research/claim documents.

The production energy path is used by the dynamic daily expenditure model. The V7 resistance-dose and mapping code is used by experimental shadow rebuilds and by a V7 runtime library. The separate persisted V7 range-rebuild service has no application route/job caller in the repository source inspected. The unified experimental-state service is rebuilt from training/health edits and from the forecast route, but the regular forecast calculation is called independently. The experimental shadow values are not a trustworthy product-facing muscle measurement.

This is a source-code audit, not a query against a production database. The actual number of workout rows, historical coverage, null mapping snapshots and data completeness cannot be reported from this checkout. Confirm those counts from the intended database before selecting launch windows or making completeness claims.

## A. Current architecture

| Area | What the code implements | Runtime and product boundary |
|---|---|---|
| Exercise catalog | Profile-scoped catalog with editable display name, active/archive state, optional stable key and optional JSON muscle-mapping column. A compiled registry currently has 13 canonical stable exercise keys. | The stable key—not the display name or serial ID—is used for the approved V7 exercise-to-muscle mapping. Custom exercises can have no stable key. The catalog JSON mapping field is not the source of the current approved registry. |
| Programs | Program template, immutable numbered versions, exercises, order, planned set count and resistance type. Updating a program creates a new version. | Previous program versions stay available for historical sessions. Planned reps, load and RIR targets are not stored. |
| Strength diary | ACTIVE, COMPLETED and CANCELLED sessions; LIVE or RETROSPECTIVE entry; snapshot exercise rows; ordered per-exercise set rows. | Completed and cancelled records are editable. Meaningful edits increment a source revision and invoke shadow rebuilds. Active sessions can be closed for inactivity. |
| Workout matching | A session can link to one imported Workout. LIVE sessions can be auto- or manually matched; retrospective backfill links directly to a pre-existing eligible strength Workout. Pending, matched, ambiguous and unmatched states and match provenance are stored. | A matched Workout supplies the retrospective event timestamp and optional duration, active energy and HR interval. Matching does not prove that the diary is complete. |
| Health workout history | Generic Workout rows hold source identity, type, start/end, optional duration, legacy energy, active energy, import protection/hidden tombstone state and optional diary link. Health sync reconciles rows by source identity. | Imported cardio and strength events share this model. The database type is a string, not a normalized cardio subtype enum. |
| Stepper | Manual stepper events use the same Workout table and are assigned the “Stair Climbing” type. Manual duration is required; active calories are null. Imported stair workouts are also represented as Workout rows. | There is no separate StepperWorkout Prisma model. Step-count intervals can provide bracketed stepper context to existing energy/physiology code; they are not a direct per-minute cadence stream. |
| Workout energy | Workout active energy, device active-energy provenance, a stepper mechanical/HR-calibrated estimator when source evidence permits, and a strength-duration MET fallback are resolved in the production activity model. | This estimates energy expenditure. It is not muscle load, hypertrophy, training quality or a strength score. The old Workout energy field is explicitly not guaranteed to mean active-only. |
| Tonnage | Session DTOs calculate ordinary external-weight tonnage through a stable-key load-accounting registry. The supported catalog defines per-implement/per-side ×2 cases and excludes unsupported, band and bodyweight load. | This is a unit-consistent log summary for recognized entries. It is not a universal measure of muscle stimulus. |
| Muscle mapping and stimulus | Versioned categorical stable-key registry; immutable map snapshot on session exercises; V7 mapped recorded-set dose and local-date exposure-history contracts. Mapping distinguishes direct and indirect roles without numerical muscle credits. | V7 classifies RIR 0 and 1 as observed hard-set evidence; other reported RIR values remain unresolved because there is no approved threshold. Missing RIR is tagged “assumed near failure” by an explicit product assumption. These rules are not a validated per-user adaptation model. |
| Adaptation and recovery | V7 qualitative adaptation response and a scientific calibration gate. Experimental local-hypertrophy, relative-muscle, detraining, water/glycogen and unified-state shadows are stored in separate tables. | The V7 calibration says the supported response level is qualitative constraints only; quantitative skeletal-muscle transition is unavailable. The model-recovery service repairs gaps in historical physiological state. It is not muscle-specific recovery/readiness. |
| Workout history UI | Training hub, saved programs, live session, editing/backfill, recent sessions, and a per-exercise history endpoint. General history shows daily metrics and workout duration over 7, 30, 90 days or all history. Existing charts use Recharts. | There is no period-report API, weekly/monthly analytics screen, muscle detail panel or Body Map route/component. Per-exercise history returns up to 20 completed sessions (the current UI uses a short recent list). |

### Data-flow relationships

1. Program edits create a new ProgramVersion.
2. Starting a live session or creating a retrospective entry copies planned exercise data to StrengthSessionExercise and freezes its exercise name and approved map snapshot.
3. Logging a set creates a StrengthSet record. Later matching can attach the corresponding imported Workout and its event time/context.
4. Training edits, completion and health sync can rebuild experimental strength, mapping, local-hypertrophy and unified-state shadow records. The training flow catches shadow failures so the diary write remains independent.
5. The production energy model consumes workout duration/active-energy evidence for daily energy accounting. It does not consume “muscle progress.”
6. General History combines daily health fields, workouts and diary presentation. It does not query a per-period muscle-analytics aggregate.

Relevant implementation locations include prisma/schema.prisma; src/modules/training/training.service.ts and training.repository.ts; src/modules/health/health.repository.ts and health.service.ts; src/model/activity/workout-energy.ts; src/model/dynamic-daily-expenditure.ts; src/model/physiology-v7/exercise-muscle-mapping-v7.ts; src/model/physiology-v7/qualified-resistance-training-dose-v7.ts; and src/model/physiology-v7/resistance-training-exposure-history-v7.ts.

## B. Available data

“History exists” below means the schema and application support persisted history. It does not assert a live database contains records for every date or field. Required/optional refers to stored schema or write contract, not evidence quality.

| Field | Source and storage | History | Required? | Comparable use | Missing data or caveat |
|---|---|---|---|---|---|
| Training/event date | Workout start/end plus parent DailyHealthData.date; live diary webStartedAt/webEndedAt; retrospective occurrence from its matched Workout. Health sync snapshots preserve date/timezone/received time. | Yes. | Workout start/end required; workout local date comes from sync day. Live timestamps are nullable in schema; retrospective sessions do not fake live times. | Yes, by the source event date and an explicitly selected local timezone. Use DailyHealthData.date for imported workout grouping and linked Workout.startAt for event order. | Do not use diary createdAt or default set-entry time as a backfill occurrence date. Do not silently derive date from UTC when a profile-local date is available. |
| Workout type | Workout.type string; imports normalize known workout labels. Manual stepper writes “Stair Climbing.” | Yes. | Nonblank string on create. | Same source type can be grouped; canonical activity-energy classification recognizes Traditional Strength Training and Stair Climbing. | Running, cycling, walking, swimming, Mixed Cardio, etc. may be retained but are not all first-class analytic types in the energy classifier. No strength/cardio/combined enum exists on a diary session. |
| Session entry/status | StrengthDiarySession entryMode/status/match fields. | Yes, while the diary row remains; deleting a diary session removes its exercises/sets but retains the Workout. | Status and entryMode have defaults. | Use to filter completed, cancelled/partial and live records. | A cancelled session may still have valid logged sets; status alone must not discard or label its rows as zero work. |
| Duration | Workout.durationMinutes; otherwise event start/end; live webEndedAt−webStartedAt; manual stepper requires duration. DailyHealthData also has strengthTrainingMinutes. | Yes where supplied/derived. | Imported Workout duration optional; manual stepper duration required. | Compare within same source/event class and note elapsed vs device duration. | Session wall time includes rest, transitions and pauses; start/end-derived time is not active lifting time. Imported device duration may differ in semantics. |
| Exercise identity | ExerciseCatalog.id/stableKey; StrengthSessionExercise.sourceExerciseCatalogId, snapshotExerciseName and muscleMappingSnapshot. | Yes for recorded diary sessions. | Session snapshot name/order/plannedSets/resistanceType required; stableKey can be null for custom/unregistered exercises. | Strongest comparison key is a stable exercise identity plus resistance type and any available variation details. | Do not merge exercises by a similar display name. Equipment configuration, range of motion and technique are not recorded. |
| Exercise category (compound/isolation, equipment, pattern) | No normalized category field. Registry rationale/roles provide limited qualitative hints. | No independent historical category. | None. | Only as a narrow derived presentation for reviewed stable keys. | New catalog metadata required for a complete category filter. “Direct/indirect” is not a general compound/isolation field. |
| Performed exercises | StrengthSessionExercise rows and their StrengthSet children. EXTRA exercises are supported. | Yes. | Exercise rows are snapshots; sets may be empty. | Yes for diary coverage and exercise frequency. | A health Workout with no diary can establish that a workout happened but cannot provide its exercises or sets. |
| Number of sets | Count of stored StrengthSet rows; plannedSets on the program/session exercise snapshot. | Yes. | A recorded row has a required set number; exercises can have no recorded sets. | Exact count of *logged rows* by session/exercise/mapping. | There is no set type/warm-up flag. The database cannot distinguish warm-up from working sets. “Hard set” is a separate V7 classification contract, not a stored truth. |
| Repetitions | StrengthSet.reps. | Yes. | Required for each stored set. | Compare for the same exercise and load/resistance semantics; derive total reps. | Cannot confirm range of motion, pauses, tempo, assistance or whether the set reached a particular technical standard. |
| Working weight/load | StrengthSet.weightKg or bandNominalResistanceKg, constrained by the exercise resistance type. | Yes when entered. | Optional/nullable. External weight, band nominal resistance and bodyweight are different semantics. | External load comparison is useful only for the same exercise, load-entry convention and variation. | No effective band tension, assistance/added bodyweight, machine setting or total system load. A null load is unavailable, not zero. |
| RIR / proximity to failure | StrengthSet.rir, optional integer 0–10. | Yes where the user entered it. | Optional. Null is explicitly not RIR 0. | Compare self-reports cautiously within the same exercise/user context; preserve exact values or distributions. | Self-report uncertainty; no app-validated individual accuracy calibration. Do not assume omitted RIR equals failure in the UI. |
| Tonnage | Derived at session DTO read via ordinaryExternalWeightTonnageKg and a stable-key accounting factor. | Re-derivable from the historical diary rows and versioned accounting semantics. | Not a stored set field; result may be null. | Period sum only for supported external-load semantics; best interpreted exercise by exercise. | Unsupported/custom loads, band and bodyweight rows are omitted. The supported factor may double dumbbell/per-side entry to total external load. Tonnage is not hypertrophy dose. |
| Set/exercise sequence | StrengthSessionExercise.sortOrder; StrengthSet.setNumber; optional completedAt/createdAt. | Yes, but editable. | sort order/set number required; completedAt may be null. | Within-exercise set order can be compared; exercise order can be a context variable. | No single immutable sequence across all sets. In retrospective entry, omitted completedAt defaults to entry time, not historical workout time. Exercise order can be edited after the session. |
| Planned versus performed | ProgramVersion/ProgramExercise planned sets; copied into each session exercise; logged row count; PLANNED/EXTRA origin; planCompletionPercent. | Yes. | Planned sets required. | Set-count completion only. | Planned target repetitions/load/RIR are absent. Completion percent can exceed 100% due to extra rows and does not measure quality. |
| Workout frequency | Distinct Diary session/workout event dates; workout feed observation per DailyHealthData.date. | Yes where diary/import coverage exists. | Workout-feed provenance optional for legacy day rows. | Derive sessions/week, mapped exposure days and regularity with coverage shown. | A missing/unobserved workout feed is not a verified rest day. Linked Workout and diary are one occurrence and must not double-count. |
| Heart rate | Timestamped HeartRateSample rows, source and date; daily and workout interval views. RestingHeartRateSample is separate. | Yes where synced. | Optional; no samples is a valid state. | Overlay within a known event interval; compare only with source/device and activity context. | HR alone is neither lifting load, muscle stimulus, progress nor local recovery. Multiple device/source and recording-coverage differences matter. |
| Steps | DailyHealthData.steps and timestamped HealthActivityInterval step intervals. | Yes where synced; HealthSyncSnapshot retains cumulative snapshots used in rebuilds. | Optional/nullable. | Daily step volume or source-bracketed stepper context. | Daily steps are not automatically attributable to a given workout; use interval overlap and preserve attribution uncertainty. |
| Cadence | No dedicated cadence model, payload field or supported metric mapping found. | No validated cadence series in the app data model. | Not present. | Not currently. | Requires cadence samples tied to an event with source/device and units. Do not infer cadence from steps or elapsed time unless the source explicitly supports that derivation and labels it. |
| Cardio distance/pace | Workout has no distance/pace columns. Daily walkingDistanceKm and averageWalkingSpeedKmh plus timestamped step/distance intervals exist. | Daily history exists; per-workout distance/pace does not. | Daily fields optional. | Daily walking metrics, not an arbitrary cardio workout’s distance. | To compare run/cycle/row/swim performance, ingest event-level distance, route/speed and modality units. |
| Activity duration/energy | Workout duration, activeEnergyKcal and legacy energyKcal; daily active energy and strength minutes; WorkInterval for occupational activity. | Yes, with source-dependent availability. | Most imported values optional; manual stepper duration required but energy absent. | Duration can be descriptive; active device energy can be compared with provenance and same modality/device. | Workout energy semantics differ. Do not sum overlapping activity/workout sources twice or treat kcal as lifting stimulus. |
| Sleep/resting-HR recovery context | SleepSegment intervals/state; resting-heart-rate samples; some heart-rate context. | Yes when synced. | Optional. | Contextual daily/longitudinal trends only. | No explicit HRV, soreness, fatigue, muscle-specific recovery, readiness survey or local recovery measurement in the normalized schema. A raw payload field is not a dependable typed analytics input. |
| Muscle stimulus/exposure | Snapshot JSON target groups/roles; qualified V7 dose; weekly V7 exposure history; isolated experimental shadow rows. | Historical diary snapshots exist; old/null snapshot prevalence is unknown until DB inventory. | Snapshot may be null for older/custom rows. | Categorical mapped set exposure, separated into direct/indirect counts, for covered keys. | No numeric per-muscle coefficient, actual muscle activation, local size outcome or approved set-to-growth model. Do not read shadow estimates as measured outcomes. |
| Program label/version | Session program/version IDs and version number; current program name is joined from TrainingProgram. | IDs/version history available. | Program relation/version required. | Compare plan versions by ID/version. | Program name is not copied into the session; renaming a template can change a historical display label even though exercise/sets/mapping snapshots remain stable. |

## C. Muscle mapping

The mapping is a code registry keyed by stable exercise identity. Current coverage is 13 registered canonical exercises and eight broad groups:

| Current group | What it covers now | Requested detail still missing |
|---|---|---|
| chest | Reviewed press/fly/push-up mappings. | Catalog-specific exercise breadth is small; no pectoral region or head split. |
| back | Row and pull-up patterns, with back as a broad direct target. | No latissimus vs upper/mid-back vs other back separation. |
| deltoids | Direct/indirect roles across overhead press, lateral raise and pressing patterns. | No anterior, middle and posterior head taxonomy. |
| biceps | Curl exercises direct; row/pull-up roles indirect. | No brachialis/brachioradialis or head split. |
| triceps | Extension and push-up direct roles; pressing assistance in selected entries. | No head split. |
| forearms | Wrist curl direct and selected grip/curl assistance roles. | No flexor/extensor/grip subdivisions. |
| spinal_extensors | Hyperextension. | Coverage is only for the listed canonical exercise. |
| hip_extensors | Hyperextension, described as a broad glute/hamstring complex. | Glutes and hamstrings cannot be separated. |

There is no supported individual mapping for quadriceps, hamstrings, glutes, calves or abdominal muscles in the current registry. The registry uses “direct” and “indirect” anatomical roles; it does not store numeric weights, fractional-set credits, an explicit exercise category or an exact compound/isolation taxonomy. It explicitly rejects coefficients/percentages/credits in the mapping.

Several registered exercises are unilateral or one-arm named patterns. The set schema has no side/limb field and no per-side completion flag. The external-load accounting registry assumes a ×2 total for some “both sides” movements, so it cannot tell whether a user recorded one side, both sides, or a different per-side convention.

### Snapshot reliability

Program exercise lists are versioned, and each diary exercise row freezes its exercise name, order, planned sets, resistance type, origin and a versioned muscle-map snapshot. The session’s stable map identity survives a later catalog display-name change. Existing non-null map snapshots are not rewritten by the available backfill helper. A dry-run-first backfill classifies old null snapshots only through the still-linked catalog stable key; it will not guess from a display name.

This protects supported historical maps from catalog/program edits. Remaining caveats:

- Null/JSON-null legacy snapshots and custom/unregistered exercises remain unavailable unless the stable identity can be established.
- Existing coarse historical snapshots cannot be split into future deltoid heads, lats, quadriceps, etc. by changing today’s registry.
- A future finer taxonomy needs a new mapping version and mesh IDs. Preserve old versions and show their original group granularity.
- Catalog name snapshots are present, but the program display name is a mutable join.

Reusing the existing snapshot/mapping system is preferable to creating a second physiological mapping. The new UI should expose mapping version/availability in diagnostic metadata and leave unmapped counts visible.

## D. Training metrics

Status meanings: **Already available** = field/calculation exists in the repository; **Derivable** = source rows exist but a new aggregation/product rule is needed; **Requires new data** = the necessary observation is not modeled; **Scientific blocker** = code can calculate a number, but the requested physiological interpretation lacks support.

| Metric | Status | What can be reported safely now | Limit |
|---|---|---|---|
| Logged sets per session/exercise | Already available | Count StrengthSet rows, plus planned row count and EXTRA rows. | These are logged rows, not known working sets; no warm-up flag. |
| Direct and indirect mapped sets | Already available | V7 keeps per-muscle direct and indirect mapped set counts for registry snapshots. | Categorical mapping count only; not equal effective stimulus. Not surfaced by an analytics route/UI. |
| “Hard/qualified” set count | Already available, with explicit contract | V7 tags missing RIR as product-assumption-qualified; RIR 0/1 are observed classifications; other supplied RIR values are unresolved. | Not a continuous RIR curve and not a validated claim that all diary rows were hard. Do not hide its assumption. |
| Weekly mapped exposure history | Already available in V7 code | Monday–Sunday engineering weeks, mapped/recorded/unmapped counts, source-coverage/no-exposure/unresolved/unobserved day kinds, and program contexts. | Library/shadow use, not an end-user analytics endpoint. Local-date input and legacy Workout assembly must be correct. |
| Weekly logged sets / reps / exercise count | Derivable | Aggregate stored set rows, repetition sums and unique snapshot exercises by event date. | Call these logged-volume measures; do not label all rows working sets. |
| Monthly/rolling-4-week volume | Derivable | Same raw rows over calendar month or exact rolling 28-day windows. | Must distinguish calendar vs rolling periods and incomplete boundaries. No current report UI. |
| Tonnage | Already available per session; period aggregate derivable | Existing ordinaryExternalWeightTonnageKg semantics for approved external-weight catalog entries. | Null for unsupported types/factors; band/bodyweight excluded. Volume load is not a universal hypertrophy measure. |
| Training frequency/regularity | Derivable; V7 weekly exposure contract exists | Count matched or diary events and distinct mapped exposure dates; derive distribution/gaps. | Include workout-feed coverage. Missing coverage must not become rest. |
| Days since last mapped training | Derivable | Latest event date by exact mapped muscle group. | It means “last recorded mapped exposure,” not physiologically recovered/not recovered. |
| Direct:indirect balance | Derivable from available roles | Show raw role counts and group comparison. | No scientifically established ideal ratio for each user/muscle. |
| Progress/volume delta across periods | Derivable | Compare raw counts, reps and supported external tonnage in clearly paired windows. | More logged volume is not proof of greater adaptation or better training. |
| Exercise-specific strength progression | Derivable | Same stable exercise/variation, resistance type and set-performance dimensions over time. | Requires comparability and sufficient repeated observations. |
| Estimated 1RM | Derivable only in a constrained domain | Could be offered as an explicitly labeled estimate for suitable external-load sets and a disclosed equation. | Exercise/repetition/RIR dependence and individual prediction error; not available for band/bodyweight or unlike movements. Not present now. |
| Recovery / readiness | Requires new data for local status; contextual signals already available | Show sleep interval summaries, resting HR and “days since recorded mapped training” as separate contextual series. | No muscle-specific recovery equation, soreness/fatigue entry or HRV stream. HR/sleep cannot become a muscle recovery percentage. |
| Hypertrophy/muscle growth by muscle | Scientific blocker with present inputs | No direct per-muscle size/volume observation exists. | Do not derive growth from sets, tonnage, RIR, HR, strength or general body-weight/body-fat changes. |
| Training Quality Score | Scientific blocker | None recommended. | No validated universal score or evidence-supported weights/thresholds. |

All period metrics must preserve three states: available numeric value, confirmed zero under observed coverage, and unavailable/partial. For example, “no mapped set” is not equivalent to “no training” if mapping is unavailable or the Workout feed was not observed.

## E. Progress and regression

### Keep three outcomes separate

1. **Strength performance:** how the same exercise is performed under comparable conditions.
2. **Recorded work/volume:** rows, repetitions, supported load and frequency in the log.
3. **Regularity:** observed event dates and gaps with source coverage.

More exercises/sets/repetitions may increase logged work. It does not automatically indicate greater muscle growth or better recovery.

### Exercise comparison rules

- Compare by stable exercise identity and resistance type, then expose relevant variation/accounting metadata. Do not combine a cable row with a pull-up, a dumbbell press with a machine press, or an assisted bodyweight movement with an external-weight movement merely because they map to “back” or “chest.”
- Prefer set-level comparisons: same exercise, same load convention, reps and reported RIR. Show set number/order and session context. A different number of sets should not make total tonnage the “best performance.”
- Compare top sets at a consistent set position where possible. Later sets can reflect accumulated fatigue; exercise order is stored but rests, tempo and range of motion are not.
- If exercise order, equipment, load convention or diary completeness changed, show the change and lower/disable comparability. For a custom exercise with no stable key, keep identity local to that catalog row or snapshot; do not infer aliases from names.
- Weight gain/weight loss may affect bodyweight movements, but current StrengthSet records do not capture added/assisted bodyweight. Treat those series as incomplete for load-adjusted comparison.
- A best set is a descriptive maximum among eligible logged sets, not a normalized performance score. A best set across two different movements is not comparable.

### Estimated 1RM

No 1RM field or calculation exists. A future estimate must disclose the equation and supported rep range and stay with one exercise variant. The rep-based equations were developed/cross-validated on specific movements and repetition-to-failure protocols; many app sets have unreported RIR or RIR well above failure. For a conservative first release, either omit e1RM or produce it only where the set and RIR domain is explicitly supported. Do not estimate e1RM for nominal band resistance, bodyweight rows, unknown external-load semantics, high-rep sets outside validation or between different exercises.

### Trend labels

The data supports recorded performance trend labels, not muscle growth/regression labels. A robust implementation should:

- group repeated eligible observations for one exact exercise/variant;
- require multiple dated comparable sessions over a predeclared span;
- estimate the trend with a method that accounts for ordinary set/day variation and display the observations behind it;
- use **insufficient data** when the history is short, incomplete or incomparable;
- use **stable/plateau** only when enough comparable observations support a near-flat range under the selected method;
- use **positive**/**negative performance trend** only when a multi-session trend exceeds a predeclared tolerance;
- never call one bad session, a missed recording or an unobserved feed “regression.”

An example minimum such as three comparable sessions across several weeks is an engineering rule to validate against actual logging noise; it is not a scientific threshold for strength adaptation. A group-level Body Map can summarize only those exercise-performance observations that map to that group and should say “mapped exercise performance,” not “muscle is growing.”

## F. Scientific evidence

The repository already contains a detailed V7 evidence review (cutoff 2026-09-17), an independent audit, parameter contracts, a testable-claims manifest and a research-only decision on quantitative muscle prediction. The local research review distinguishes direct evidence from proxies and says the current whole-body muscle response is limited to Level 1 qualitative constraints. It rejects converting strength, local measurements, acute MPS, HR/HRV, tonnage or sets to whole-body muscle kilograms.

| Evidence source | Metric/decision it supports | Limits relevant to BodyCast |
|---|---|---|
| Schoenfeld, Ogborn & Krieger (2017), systematic review/meta-analysis, DOI 10.1080/02640414.2016.1210197, PMID 27433992. [PubMed](https://pubmed.ncbi.nlm.nih.gov/27433992/) | A population-level positive association between weekly resistance-training set volume and local muscle-size outcomes. | Older, heterogeneous study-level analysis. Its reported per-set slope is not an individual “kg gained per set” coefficient; outcomes are mostly local size proxies. |
| Pelland et al. (2026), multilevel meta-regressions, DOI 10.1007/s40279-025-02344-w, PMID 41343037. [PubMed](https://pubmed.ncbi.nlm.nih.gov/41343037/) | Weekly volume associates with hypertrophy and strength with diminishing returns; direct/indirect set distinctions matter in dose models. Frequency effects differ for strength vs hypertrophy. | A cohort/meta-regression descriptor, not an individual forecast. Fractional 0.5 indirect sets were a model specification, not a validated exact coefficient for every BodyCast exercise/muscle. Study populations/outcomes remain limited. |
| Refalo et al. (2023), systematic review/meta-analysis on proximity to failure, DOI 10.1007/s40279-022-01784-y, PMID 36334240. [PubMed](https://pubmed.ncbi.nlm.nih.gov/36334240/) | Failure is not necessary to observe hypertrophy; set-failure vs non-failure effects were small and definitions varied. | Does not validate BodyCast’s threshold or prove all logged sets are sufficiently hard. |
| Robinson et al. (2024), meta-regressions on estimated proximity to failure, DOI 10.1007/s40279-024-02069-2, PMID 38970765. [DOI](https://doi.org/10.1007/s40279-024-02069-2) | RIR is a relevant research variable; the analysis reports a possible proximity relationship for hypertrophy. | RIR was estimated from intervention descriptions, not self-reported per-set app data. The authors describe the analysis as exploratory. It does not support a precise per-user RIR-to-stimulus curve. |
| Carvalho et al. (2022), load/volume-matched training systematic review/meta-analysis, PMID 35015560. [PubMed](https://pubmed.ncbi.nlm.nih.gov/35015560/) | Muscle hypertrophy can be similar across broad load magnitudes under sufficiently hard, volume-matched protocols. | A reminder that kg×reps “tonnage” is not an interchangeable cross-protocol measure of hypertrophy or muscle stimulus. |
| ACSM 2026 overview of 137 systematic reviews, PMID 41843416. [PubMed](https://pubmed.ncbi.nlm.nih.gov/41843416/) | Progressive resistance training improves strength and size in healthy adults; prescription variables have outcome-specific effects. | Population recommendations do not classify an individual diary trend or reveal individual muscle hypertrophy. |
| Whisenant et al. on repetition-maximum-based 1RM estimation, PMID 16937972. [PubMed](https://pubmed.ncbi.nlm.nih.gov/16937972/) and the 2025 cross-validation of 18 repetition-to-failure equations for bench press and leg extension, PMID 39495260. [PubMed](https://pubmed.ncbi.nlm.nih.gov/39495260/) | Supports estimated 1RM as an equation-based, movement-specific performance estimate in a defined domain. | A prediction equation is not a directly tested maximum; movement, repetitions, RIR and set conditions affect error. Do not compare estimates across movements. |
| BodyCast V7 research review and quantitative-muscle rescue decision. [Evidence review](../research/workout-physiology-v7-evidence.md), [decision](../research/stage-7-slice-5c-quantitative-muscle-forecast-rescue.md) | Explicit source/proxy separation; weekly mapped dose is an exposure descriptor, not a muscle-kilogram transition. | The documents are research/contracts, not evidence that shadow-only calculation is a deployed user feature. |

### Scientific interpretation

- Weekly counts are supportable as descriptive training-dose data; any mapping of a multi-joint movement to each muscle is a reviewed categorical estimate, not measured activation.
- The 2026 fractional-set model suggests that counting indirect work may improve cohort-level models. It does not establish a universal half-set contribution for every indirect movement/person. Keep BodyCast’s raw direct and indirect counts separate before considering an explicitly labeled fractional estimate.
- Training frequency describes when mapped exercise exposure occurred. With weekly volume equated, evidence does not justify an extra universal hypertrophy multiplier for more days.
- RIR/proximity can be displayed as user-reported effort data and stratify comparability. Do not interpret unknown RIR as failure. The V7 null-RIR fallback is an engineering assumption and must remain labeled if reused.
- Strength gain is a performance outcome influenced by neural skill, task specificity, learning, fatigue, exercise variation and muscle change. It is not a direct muscle-size measurement.
- Tonnage, calories, HR and steps answer different questions; they cannot replace work-set, exercise-specific or muscle-size measurements.
- No universal set cutoff, fatigue/recovery score, muscle-quality score or one-day regression rule is established for this product’s user logs.

## G. 3D Body Map feasibility

| Question | Repository finding and consequence |
|---|---|
| Current rendering stack | Next.js 16.3.2, React 19.2.8 and Recharts 3.10.1 are present. No Three.js, React Three Fiber or model-loader dependency is declared. Recharts already covers 2D time-series charts. |
| Existing asset | No GLB/GLTF/anatomy mesh was found in public assets. Current images are exercise illustrations/photos and app icons; they cannot be used for individual muscle selection. |
| Suitable rendering option | Three.js GLTFLoader loads glTF assets. React Three Fiber is a React renderer; its current docs pair major version 9 with React 19. That fits the app’s React major version, but it adds a sizeable WebGL client bundle and new runtime dependency. [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [R3F introduction](https://r3f.docs.pmnd.rs/). |
| Next.js integration | Keep the atlas in a client boundary and load it on demand. Current Next docs support a client-only dynamic import with SSR disabled for browser-only libraries. [Lazy loading](https://nextjs.org/docs/app/guides/lazy-loading), [client components](https://nextjs.org/docs/app/getting-started/server-and-client-components). |
| Selection and highlighting | Use semantically named individual muscle meshes or stable mesh IDs mapped to versioned BodyCast taxonomy IDs. Rotation/zoom/front-back controls are routine. Hover/click must resolve to a meaningful muscle ID, not only a material/color region. |
| Anatomical granularity | The current eight BodyCast groups are too broad for several user-requested labels. The asset’s mesh names, paired sides and anatomical segmentation must map to those same groups. Do not invent a distinct latissimus/deltoid-head/quadriceps/hamstring value from an unsplit surface. |
| License | Z-Anatomy’s official model repository states CC BY-SA 4.0, attribution and same-license distribution for derivatives; it attributes underlying BodyParts3D CC BY-SA 2.1 Japan. A 2026 maintainer reply says embedding the model in an app implies sharing app code under that license. That is the asset owner’s stated interpretation, not a legal ruling. Review the exact asset files and embedded third-party models: Z-Anatomy also lists some sources with non-commercial terms. [Z-Anatomy license](https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/master/License.txt), [maintainer licensing reply](https://github.com/Z-Anatomy/Models-of-human-anatomy/issues/8), [BodyParts3D license](https://github.com/Kevin-Mattheus-Moerman/BodyParts3D/blob/main/README.md). For a closed/proprietary distribution, this is a material adoption blocker unless rights are clarified or a compatible asset is selected/commissioned. |
| Mobile/performance | Use one optimized GLB with mesh/material count reduced, lazy route loading, bounded DPR, touch orbit controls and a small set of highlight materials. Monitor initial asset transfer, memory and frame behavior on low-end phones. Avoid loading anatomy while the user is browsing unrelated routes. |
| WebGL fallback | Current Three.js WebGLRenderer requires WebGL 2. Unsupported context or render failure needs a real 2D front/back SVG/data-list fallback. Keep muscle selection, metric color legend and numeric detail usable there. Three.js documents its renderer and WebGL 2 requirement. [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html). |

### Can current data power each Body Map mode?

| Mode | Feasibility from current data | Honest color/label |
|---|---|---|
| Training Load | Coarse and partial, after building a report endpoint. | Raw logged-set count or separate direct/indirect mapped-set counts for the selected period. Gray/unavailable where mapping/coverage is unknown. Not “muscle stimulus intensity.” |
| Progress | Partial at exercise level; group roll-up is only a summary of mapped exercises. | Positive/stable/negative *comparable exercise performance* with number of observations. Do not call it muscle growth. |
| Regression | Same as Progress, requiring repeated comparable evidence. | Negative multi-session performance trend; never one bad workout. |
| Training Balance | Derivable for the eight current broad groups. | Counts or ratios of mapped recorded sets, with direct and indirect separate and mapping coverage visible. Not a balance/quality grade. |
| Recovery / Last trained | Last recorded mapped exposure date is derivable. | Time since last mapped log and separate available sleep/resting-HR context. No local “recovered” status or readiness percentage. |
| Per-muscle detail | Only for available current groups. | Sets, mapped exercises, logged loads/reps, exercise-performance history and periods. “Unavailable” is distinct from zero. |

## H. Proposed architecture

### Read path and domain services

1. **Analytics source repository:** load StrengthDiarySession, session snapshots, sets, matched/unmatched Workout events, DailyHealthData observation coverage, HR/resting HR/sleep and activity intervals over one requested local-date range. Keep raw event sources and provenance.
2. **Event normalization/deduplication:** one analytic occurrence per workout/diary relationship. Use occurrence time, stable Workout identity and match link. Do not add the same event once as a Garmin Workout and again as its matched diary. Preserve unmatched strength Workouts as an occurrence with “exercise detail unavailable.”
3. **WorkoutAnalyticsService:** pure aggregation for one workout, calendar week, calendar month, exact rolling 28 days, arbitrary inclusive range and all history. Return numeric fields plus availability/completeness, local boundaries, source counts and excluded/unmapped counts.
4. **ExerciseProgressService:** group only comparable records by stable exercise identity/resistance semantics; build per-session top-set and load/repetition series. Keep e1RM optional and isolated behind an explicit domain/method.
5. **MuscleGroupAnalyticsService:** read the immutable per-session map snapshot; return recorded/direct/indirect counts and coverage by map version. Reuse the existing taxonomy/snapshots. If exposing the existing V7 qualified-dose output, label its null-RIR assumption and unresolved reported RIR; do not create a second hypertrophy equation.
6. **TrainingReportsService:** period aggregation/comparison. Return both numerator and coverage/completeness. Store fixed calendar-week/month and rolling-window definitions in the API response.
7. **BodyMap client:** a semantic mesh-ID-to-taxonomy adapter, metric palette/legend, selection/detail panel and accessible 2D fallback. Keep 3D asset loading client-only and on demand.

Possible routes (names are proposals, not existing endpoints): GET /api/v1/training/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD, GET /api/v1/training/exercises/{stableKey}/progress, GET /api/v1/training/muscle-groups/{groupId}/history. The existing session/exercise history endpoint remains useful for a small recent-history view but is not sufficient for these ranges.

### Database and dependency decision

- **First stage:** no new Prisma model or migration is required for raw workout/set counts, period aggregation, current-map direct/indirect counts, frequency, last mapped exposure or supported tonnage. Existing rows contain these values; implement a server-side query/aggregation and API first.
- Existing weekly V7 aggregation can be reused only with its exact documented semantics. It uses a Monday–Sunday engineering week and preserves observed/unresolved/unobserved days. It is not currently a report endpoint.
- Do not read mutable ExerciseCatalog/Program labels to reclassify old workouts. Historical snapshots and their map versions are the source of truth.
- Do not persist a new analytics aggregate until query performance requires it. If materialization is needed later, key it by date range/contract version and existing session revision/source fingerprints so backfill/edit invalidation is explicit.
- **Likely later capture improvements:** set type (warm-up/work set), optional target reps/load/RIR, loaded/assisted bodyweight semantics, equipment/variant detail for custom movements, unilateral side or per-side completion, program-name snapshot, and event-level cardio distance/pace/cadence. Add only those needed by validated product questions.
- **Taxonomy expansion:** a new versioned mapping contract and snapshots are needed before claiming groups that do not exist today. Preserve coarse/old snapshots as coarse. A new GLB mesh registry should map asset mesh IDs to taxonomy IDs separately from exercise-to-muscle roles.
- **Frontend dependencies:** add Three.js plus R3F only after asset license/segmentation is approved. R3F 9 is the compatible major for the present React 19 line. Use current Recharts for line charts and new 3D only for the atlas.

## I. Implementation roadmap

1. **Data semantics and coverage report.** Before trend thresholds, query the target database for date spans, workout-feed coverage, completed/partial/cancelled diary counts, null/missing mapping snapshots, unmapped sets, RIR/load completeness and exercise-key frequency. Define event-local date and partial-period rules.
2. **MVP Workout Analytics without migration.** Add a period-query service and API; one-workout detail, week, calendar month, rolling 4 weeks, arbitrary period and all history. Show logged exercise/set/repetition/load/tonnage/frequency values, matched-vs-unmatched source counts, planned-set completion and missingness. Distinguish logged sets from working sets.
3. **Exercise Progress and comparisons.** Add exact stable-key series, session best set, period best, comparable last-session comparison and multi-session trend labels. Keep e1RM behind a validated exercise/rep/RIR domain. Add numerical aggregation tests before exposing colored progression state.
4. **Coarse Muscle Group Analytics.** Expose the eight existing groups with raw direct and indirect counts, last mapped date, volume by period and mapping coverage/version. Keep old custom/exercise rows visibly unmapped. Do not include a muscle growth estimate.
5. **Functional Body Map UI.** Build group selection, metric legend, front/back orientation, numeric history panel and 2D fallback against the exact analytics API. This validates group IDs and colors independently of the model asset.
6. **Asset rights and anatomical coverage gate.** Select, commission or obtain a model with reviewed redistribution rights, distinct clickable meshes for every displayed target and a maintained mesh-to-taxonomy manifest. Do not begin decorative rendering before these checks pass.
7. **3D and advanced modes.** Add lazy-loaded GLB, rotate/zoom/touch interaction, mesh selection/highlighting, front/back controls, WebGL failure fallback and mobile performance budgets. Enable Progress/Regression/Recovery color modes only where their evidence and availability contracts support the displayed metric.
8. **Taxonomy/data capture expansion.** Add more specific muscle groups, custom movement mapping workflow and missing set/load/cardio fields with migration only after requirements and historical migration behavior are agreed. Old coarse snapshots stay coarse.

## J. Blockers

### Engineering blockers

- There is no analytics aggregation service, period-report endpoint or muscle-detail route/UI.
- No segmented 3D model exists in the repository and no 3D dependency is installed.
- Existing custom exercises and historical null snapshots can have no mapping; real coverage counts need the database.
- No warm-up/working-set flag means exact work-set volume cannot be identified.
- Per-workout cardio distance, pace and cadence are not stored. Daily walking distance is not a substitute.
- No bodyweight assistance/added-load or per-limb field; equipment details are incomplete.
- Retrospective set timestamps default to entry time if omitted, so they are not historical set-occurrence times.
- Program display name is mutable even though exercise and plan-version content are snapshotted.
- Asset rights must be compatible with the intended application distribution.

### Missing data

- Actual source record history span and completeness are unknown from static audit.
- Planned repetitions, load and RIR targets are absent; only planned set count is available.
- Many rows may have missing RIR/load, null map snapshot, partial exercise coverage or only a generic imported Workout.
- User-reported RIR does not record validation/calibration or whether the set was a warm-up.
- Sleep/resting HR are optional; no normalized HRV, soreness, local measurements or objective muscle-size observations exist.

### Scientific blockers

- No defensible coefficient turns BodyCast’s mapped sets or tonnage into local hypertrophy or kilograms of muscle.
- Current map categories are coarse and cannot support requested individual muscle heads/groups.
- Direct/indirect categories do not justify an exact effective-set credit for each movement. Fractional-set research is a population modeling method, not an individual measurement.
- RIR is subjective; the research does not justify a precise individual threshold/curve for BodyCast’s entries.
- General sleep, resting HR or HR cannot yield local muscle recovery/readiness.
- A strength change, volume increase or visual model color is not a measured muscle-size change.

## K. Future tests

### Existing relevant coverage

The repository already has tests for catalog/program/session routes and reconciliation, LIVE/RETROSPECTIVE/backfill, session editing/history, set RIR validation, set tonnage, stable-key exercise/muscle mapping, immutable map snapshots/null-snapshot backfill, qualified dose, weekly exposure history and source assembly, health sync/workout reconciliation, workout energy, activity overlap, history charts and scientific-contract claims. Examples include:

- tests/training-service.test.ts, tests/training-retrospective.test.ts, tests/training-session-routes.test.ts, tests/training-backfill-ui.test.tsx
- tests/training-set-tonnage.test.ts, tests/strength-set-rir.test.ts, tests/exercise-muscle-mapping-v7.test.ts
- tests/exercise-mapping-snapshot-backfill.test.ts, tests/qualified-resistance-training-dose-v7.test.ts, tests/resistance-training-exposure-history-v7.test.ts
- tests/integration/exercise-muscle-mapping-snapshot.integration.test.ts, tests/integration/training-retrospective.integration.test.ts
- tests/history-chart-data.test.ts, tests/workout-energy.test.ts, tests/health-sync-training-workouts.test.ts
- tests/scientific-v7/scientific-contract.test.ts and the scientific-claims manifest/rejection/blocker tests.

These protect existing behavior but do not provide a BodyCast period analytics API, progress classifier, body-map color contract or 3D asset/mobile test.

### Required future numerical and integration tests

| Area | Test cases that should exercise real semantics |
|---|---|
| Workout source aggregation | Matched Workout+diary counts once; unmatched legacy strength remains one event with no exercise dose; extra workouts/day remain separate; hidden/deleted tombstones and sync-protected rows behave correctly. |
| Date/period boundaries | Local date vs UTC crossing midnight; exact inclusive from/to; Monday–Sunday; calendar month; exact rolling 28 days; adjacent non-overlapping comparison windows; partial current week/month labels. |
| Coverage and zero | Observed feed plus no workout is zero exposure; false/null coverage stays unavailable; unresolved legacy strength does not become rest; missing muscle map is unavailable, not zero. |
| Volume | One row counts once for each mapped role; direct/indirect remain separate; no implicit fractional coefficient; reps sum, sets count, extra rows and plan completion behave as specified. Explicitly demonstrate that no field distinguishes warm-up from work set. |
| Tonnage/load | Approved ×1/×2 load accounting; null weight; unsupported stable key; resistance-band nominal load; bodyweight; invalid/zero load; no accidental combining of load types or exercise totals into a hypertrophy score. |
| RIR | Null remains unknown plus optional assumption provenance; 0, 1 and 2 preserve the existing V7 semantics; higher values remain unresolved; do not turn missing into 0. |
| Exercise comparability | Stable key survives display rename; different stable key/equipment/type is not merged; same exercise with changed order/sets is reported with context; removed catalog relation retains snapshot identity where possible. |
| Progress and e1RM | Weight-up/reps-up at matched RIR; same load and repetitions with different RIR; different set number/order; eligible equation bounds; out-of-domain rep count, missing/unknown load or non-supported resistance returns unavailable. |
| Trend classification | Repeated upward, flat, downward and noisy synthetic series; one poor day cannot yield regression; too few points, incomplete history and incomparable exercise changes return insufficient data. |
| Period comparison | Previous analogous workout, week/week, rolling-28/previous-28 and month/month; missing/partial windows; zero baseline percentage undefined; program-version change visible. |
| Backfill/edit/rebuild | Event date comes from source occurrence, not createdAt/default completedAt; set/program edits change revision and analytics; linked event remains deduplicated; set reorder changes only the intended sequence context. |
| Map aggregation/color | Each mesh maps to one versioned group; unknown mesh is unavailable; zero is visually distinct from missing; selected group opens matching counts/series; indirect/direct palette labels match the legend. |
| 3D/mobile | Front/back orientation, left/right mesh IDs, hover/click/touch selection, keyboard/accessibility alternatives, narrow viewport, low DPR, lazy loading, asset-load failure and WebGL 2 unavailable fallback. |

Run future numeric tests against known input rows and exact expected numbers, not only UI snapshots. Mobile rendering and asset-load fallback need browser/device verification in addition to unit tests.

## References and official technical documentation

- BodyCast research reviewed through 2026-09-18: docs/research/workout-physiology-v7-evidence.md; docs/research/workout-physiology-v7-independent-audit.md; docs/research/workout-physiology-v7-testable-claims.md; docs/research/workout-physiology-v7-scientific-test-spec.md; docs/research/stage-7-slice-5c-quantitative-muscle-forecast-rescue.md.
- Three.js: [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html).
- React Three Fiber: [Introduction and React-major compatibility](https://r3f.docs.pmnd.rs/).
- Next.js: [Lazy loading and browser-only Client Components](https://nextjs.org/docs/app/guides/lazy-loading), [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
- Asset licenses: [Z-Anatomy model license](https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/master/License.txt), [license-holder issue reply](https://github.com/Z-Anatomy/Models-of-human-anatomy/issues/8), [BodyParts3D repository license](https://github.com/Kevin-Mattheus-Moerman/BodyParts3D/blob/main/README.md).
