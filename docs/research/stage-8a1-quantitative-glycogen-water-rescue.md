# Stage 8A.1 — quantitative glycogen/water forecast rescue research

Status: research only, 2026-09-18. This memo changes no production code,
scientific claim, Prisma schema/migration, persistence, or response contract.
It does not authorize Stage 8B implementation.

## Decision

**Highest supportable level: Level 1 (directional, uncertainty-bearing
constraints).** Human physiology supports glycogen varying with carbohydrate
availability and exercise, glycogen-associated water co-varying positively,
and short-term scale mass moving with those stores. It does **not** support an
individualized, quantitative forecast (Level 2) from current BodyCast inputs.

The limiting problem is identifiability. Exercise depletion is measured locally
or in selected muscles, but the product has no muscle/liver glycogen
observation, individual capacity, recruited-muscle mass, fasting/meal timing,
or validated mapping from strength/stepper records to whole-body grams. A
latent model cannot make those quantities known by assigning a prior.

The future scientific target is a **split muscle/liver latent model** that
returns unavailable unless its calibration and inputs exist. Current aggregate
`glycogenKg` remains an accounting placeholder, not a measured or personally
calibrated pool.

## Evidence and limits

| Mechanism | Direct human evidence | Establishes | Does not establish for BodyCast |
|---|---|---|---|
| Liver baseline | In healthy people, serial carbon-13 MRS after a mixed meal found liver glycogen rose 207 ± 22 to 316 ± 19 mmol/L; mean net synthesis was 28.3 ± 3.7 g. [Krssak et al., 1996](https://pmc.ncbi.nlm.nih.gov/articles/PMC507070/) | Liver is a separately measurable, meal-sensitive store. | A universal fasting baseline/capacity or a personal liver amount from body weight or lean mass. |
| Endurance depletion | In 12 well-trained male cyclists, 7T MRS found muscle 159 ± 32 to 56 ± 19 mmol/L (−64%) and liver 166 ± 40 to 110 ± 44 mmol/L (−34%) after a glycogen-depleting protocol. [Fuchs et al., 2025](https://pubmed.ncbi.nlm.nih.gov/40836481/) | Both stores can decline differently in one defined protocol. | A generic workout, resistance, steps, HR, device-energy, or individual whole-body kg translation. |
| Resistance depletion | The approved Hamidvand synthesis reports mainly vastus-lateralis biopsies: pooled local change −104.3 mmol/kg dry mass, with a wide prediction interval/high heterogeneity. [Hamidvand et al., 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12495730/) | Recruited local muscle can deplete. | A hard-set, tonnage, RIR, HR, or mapped-muscle conversion to aggregate kg. |
| Repletion | In Fuchs, 10 g carbohydrate/kg over 12 h restored liver above pre-exercise by 6 h while muscle remained 69% of pre-exercise at 12 h. [Fuchs et al., 2025](https://pubmed.ncbi.nlm.nih.gov/40836481/) | Muscle and liver recovery kinetics differ materially. | A daily-`carbsG`-only repletion rate; timing, depletion, food form and fasting matter. |
| Water/mass | Nineteen people switching from depletion to carbohydrate-rich feeding gained 2.4 kg body mass and 2.2 L total body water; estimated glycogen storage was at least 500 g, giving an inferred 3–4 g water/g glycogen. [Olsson & Saltin, 1970](https://onlinelibrary.wiley.com/doi/pdf/10.1111/j.1748-1716.1970.tb04764.x) | Positive glycogen/water co-variation can materially alter scale mass. | A fixed/personal ratio, time kernel, or ECF residual. Aggregate glycogen was estimated. |

The paired 7T MRS result is most rescue-relevant but is a small homogeneous
well-trained male-cyclist protocol, not a consumer-exercise calibration set.

### Concentration and protocol detail

Do not mix wet and dry units. The Fuchs muscle MRS concentration is mmol/L;
their biopsy comparison reported 269 ± 90, 418 ± 78 and 523 ± 92 mmol/kg dry
mass immediately postexercise, 6 h and 12 h respectively. The resistance
meta-analysis is mainly vastus-lateralis biopsy in 168 men and 12 women across
20 studies/28 effects; its −104.3 mmol/kg dry-mass mean has a 95% CI of
−137.6 to −71.0 and prediction interval −244.4 to +35.7. These figures are
local concentration evidence, not total skeletal-muscle pool estimates.

The approved record also includes 10 elite male lifters with local
vastus-lateralis depletion of 38% after squat/deadlift/split-squat work, and
eight fasted untrained men after about 45 minutes resistance work with fiber
changes of 23 ± 6% (type I), 40 ± 7% (IIa), and 44 ± 7% (IIx). Different
sampled muscles, protocols, training state, fiber mix and pre-exercise stores
make a regional fraction model unidentifiable from BodyCast's muscle mapping;
the mapping is useful to preserve *which* muscles were exposed, not to assign
unobserved mass weights.

For liver, the MRS evidence is explicitly meal/fasting and exercise dependent:
the mixed-meal study began at 207 ± 22 mmol/L and the cyclist protocol began
at 166 ± 40 mmol/L. Neither is a capacity estimate for a broad consumer
population. Descriptive whole-body estimates often cite roughly 500 g muscle
and 80 g liver glycogen, but their reported spans (about 300–700 g and
0–160 g) depend on assumed muscle mass and state. They are contextual ranges,
not priors or defaults.

### Stepper/endurance and daily-carbohydrate resolution

No direct human stair/stepper glycogen-depletion measurement suitable for a
whole-body conversion was identified in the reviewed evidence. Direct stair
work can characterize intensity/energy demand; cycling and other aerobic work
can establish that carbohydrate substrate is used, but transferring either to
stepper glycogen kg would add an unvalidated coefficient. Duration, step rate,
HR context, body mass and Garmin active-energy estimates can be retained as
covariates for a future study; Garmin energy remains a device estimate, not
physiological ground truth.

For repletion, the approved Craven meta-analysis (29 trials, n=246, mostly
biopsy outcomes within 8 h) found carbohydrate/non-nutrition exposure averaging
1.02 ± 0.4 g/kg/h increased local synthesis by 23.5 mmol/kg dry mass/h
(95% CI 19.0–27.9; I² 66.8%). CHO+protein versus carbohydrate alone differed
by 0.4 mmol/kg dry mass/h (−2.7 to 3.4) when energy was matched. Ivy's delayed
feeding result and the Fuchs paired-MRS result both show timing and compartment
matter. Daily `carbsG` can support a day-level input with wide uncertainty, but
loses dose timing, food form, fasting and within-day exercise ordering; it
cannot identify `Rm` and `Rl` separately.

### Water, transient water, and ECF

Olsson/Saltin is a useful body-mass validation anchor, not a ratio policy. The
approved water record also notes that repletion conditions can yield markedly
different apparent ratios (about 3 g/g with restricted fluid versus much
larger apparent water change under full rehydration). Thus `rho` may be a
future positive, context-conditioned random variable, but no human
product-applicable distribution is presently calibrated. It must not be fixed
at legacy 2.7, 3, or 4 kg/kg.

The reviewed resistance-water studies are local: in 10 untrained men, local
muscle cross-sectional area rose about 13–16% and local water about 6–8% at
4/52 h after exercise. A trained-men study varied back training volume
(7/14/21 sets) and assessed local effects at 24 h. These are evidence that
transient local water is plausible, but they provide no validated whole-body
kg magnitude, onset/decay kernel, or mapping from BodyCast training records.
`TEx` therefore remains unavailable quantitatively.

No durable sodium, fluid-intake, hydration, illness, or extracellular-fluid
measure is available. A signed ECF transition is therefore blocked and must
never absorb model residuals.

## Pool choice

An aggregate pool hides the different dynamics above. A muscle-only pool omits
hepatic changes and cannot represent whole-body mass. **Separate pools are the
scientifically preferred structure:** `Gm` (muscle glycogen) and `Gl` (liver
glycogen), each with capacity `Cm` and `Cl`, all kg glucose equivalents.

They are not currently implementable: the source contract lacks their
observations/capacities, meal timing/fasted state, substrate use, recruited
muscle volume and individual calibration. Do not manufacture a split from
aggregate glycogen, body weight, v6 lean tissue, or nullable `skeletalMuscleKg`.

If future work has calibrated priors and observations, derive aggregate `Gm +
Gl` with provenance rather than the reverse.

## Candidate models

| Candidate | Definition | Disposition |
|---|---|---|
| A. Qualitative state | Eligible exercise may lower a relevant store; carbs may raise it; glycogen water positively co-varies; missing critical inputs produce unavailable. | **Supported now, Level 1.** Matches approved H1/I1. |
| B. Aggregate probabilistic pool | One latent `G`, stochastic capacity and exercise/repletion transitions. | **Not for product use.** It merges non-equivalent compartments and needs unsupported whole-body mappings. |
| C. Separate probabilistic pools | Latent `Gm`, `Gl`, compartment-specific capacity/transitions. | **Preferred structure, blocked.** Structure is justified; personalized inputs/parameters are not. |
| D. Calibrated latent state-space | Model C updated from timed carbs, controlled exercise and serial glycogen/weight observations. | **Research program only.** Could become Level 2 after external calibration/validation. |

## Exact candidate equations (research notation only)

Mass is kg glucose equivalents; time is days. `clip(x;0,C)` constrains a known
state to `[0,C]`; it must never conceal missing inputs by choosing a default
capacity.

Aggregate Model B (not approved):

`G[t+1] = clip(G[t] - D[t] + R[t]; 0, C)`

`Wg[t] = rho[t] * G[t]`

`Mshort[t] = Mfixed[t] + G[t] + Wg[t] + ECF[t] + TEx[t]`

Split Model C/D (preferred notation):

`Gm[t+1] = clip(Gm[t] - Dm[t] + Rm[t]; 0, Cm)`

`Gl[t+1] = clip(Gl[t] - Dl[t] + Rl[t]; 0, Cl)`

`G[t] = Gm[t] + Gl[t]`

`Wg[t] = rho_m[t] * Gm[t] + rho_l[t] * Gl[t]`

`Mshort[t] = Mfixed[t] + Gm[t] + Gl[t] + Wg[t] + ECF[t] + TEx[t]`

`D* ~ P_deplete(exercise protocol, duration, intensity, fed state, prior stores, person)`

`R* ~ P_replete(carbohydrate dose and timing, prior depletion, food form, fasting, person)`

`rho* ~ P_water(hydration/fluid/sodium context, compartment, person)`

`D`/`R` are kg/day; `C`, `G`, `Wg`, `ECF`, `TEx`, and `Mshort` are kg; `rho`
is kg water/kg glycogen. `ECF` is independently signed; `TEx` independently
nonnegative. Neither is a glycogen-water residual. Current daily `carbsG`,
strength and stepper records omit several displayed conditioning variables;
dropping them is unsupported simplification.

## Parameter/distribution and source requirements

| Parameter | Units | Required distribution and population | Current status |
|---|---:|---|---|
| `Gm0`, `Gl0` | kg | Joint posterior conditional on measured baseline; people with diet/exercise standardization and muscle/liver measurement | Missing. No descriptive aggregate midpoint/default. |
| `Cm`, `Cl` | kg | Calibrated hierarchical positive distribution in diverse adults with repeated MRS/body-composition context | Missing. No universal capacity. |
| `Dm`, `Dl` | kg/day | Protocol-specific posterior from paired muscle/liver MRS, ideally tissue volume | Endurance narrow; resistance local biopsy; no direct stepper evidence. |
| `Rm`, `Rl` | kg/day | Conditional posterior including carbs **and timing**, prior depletion/meal context | Paired evidence proves non-equivalence but cannot calibrate consumer totals. |
| `rho_m`, `rho_l` | kg/kg | Positive context-conditioned distribution with hydration data | Positive association only; never fixed 3–4. |
| `ECF`, `TEx` | kg | Separate fluid-state/event distributions from serial compartmental water data | Missing; local edema cannot yield a whole-body kernel. |
| observation noise | kg | Instrument-specific likelihoods for MRS, scale and intake logging | Missing for product use. |

Study values above are evidence descriptors only—not defaults, clamps, priors,
or personal parameter distributions. Any distribution needs primary source data
or a declared calibration dataset.

## Current input audit and mechanism decisions

| Requirement | Current source | Decision |
|---|---|---|
| Daily carbohydrate grams | Nullable `carbsG`, observed/imputed/unavailable provenance | Correct input dimension, but daily total lacks timing. Missing is unknown—not zero or calorie-derived. |
| Scale mass | Nullable weight | Validation signal only; cannot identify glycogen versus water/gut/fluid effects. |
| Strength | Hard sets, mapped muscles, optional RIR, sometimes duration; HR contextual, tonnage excluded | Exposure label only; no local-to-whole-body numeric depletion. |
| Stepper/endurance | Duration, bracketed steps/rate, optional HR/body mass, Garmin active energy as device estimate | Event context only. No direct stair/stepper glycogen measurement; Garmin is not truth. |
| Capacity/stores, timed meals, hydration/sodium/ECF | Absent | Initialization, personalized updates and water quantification blocked. |

1. **Baseline/capacity:** unavailable without an externally justified supplied
   prior and stated population. Never infer it from weight, generic lean tissue,
   consumer scale muscle, calories, or nullable skeletal muscle.
2. **Exercise depletion:** resistance is local; stepper lacks direct evidence.
   Retain eligibility/direction only, no numeric transition.
3. **Repletion:** `carbsG` can support a qualitative monotonic relation only;
   no kg/day rule from daily totals.
4. **Associated water:** retain positive uncertain co-variation only; no fixed
   ratio/distribution and no ECF double count.
5. **Scale mass:** do not back-solve glycogen from weight or convert unexplained
residual into ECF.

## Forecast implications, uncertainty, and remaining blockers

A valid glycogen/water model could improve interpretation of short-term scale
movement: before any future tissue allocation, an analysis would compare
observed body-weight change with modeled change in glycogen, associated water,
and separately modeled transient water. That comparison can reduce the risk of
calling rapid water/store movement fat or lean-tissue change. It does **not**
justify allocating the remaining residual to fat mass: gut contents, fluid,
sweat, sodium, measurement timing and unmodeled compartments remain. No fat
residual allocation is proposed or implemented here, and glycogen modeling
must not infer skeletal-muscle growth or alter Stage-7 carry-forward, RIR, or
legacy-workout-unresolved semantics.

The appropriate uncertainty representation differs by model:

| Model | Inputs and uncertainty | Complexity/pseudoprecision risk | Forecast value now |
|---|---|---|---|
| A | Event/nutrition provenance and explicit unavailable state; directional uncertainty only | Low | Honest explanation/guardrail; no numeric forecast. |
| B | Needs aggregate baseline/capacity, depletion, repletion, water and observation distributions | High: hidden muscle/liver split can look precise | None until validated aggregate mapping exists. |
| C | Needs joint priors and transitions for both stores, plus water/fluid uncertainty | High but physiologically transparent | Best eventual structure; unavailable currently. |
| D | Needs C plus timed inputs and serial independent observations; posterior must propagate parameter, process and measurement uncertainty | Highest; data assimilation can falsely turn scale noise into glycogen | Research-only calibration target. |

The remaining blockers are personal baseline/capacity; whole-body resistance
mapping; direct stepper mapping; timed nutrition; hydration/ECF observation;
whole-body transient-water calibration; and a product-matched, held-out human
calibration/validation dataset. These blockers are why Level 2 is not rescued.

## Future Level-2 acceptance gate

All are required: durable/provenanced inputs and propagated missingness;
explicit units/population; primary human source or calibration set for every
numeric distribution; separate pools or validated aggregation; validated
protocol-specific mapping for strength/stepper/HR/device energy; constraints
`0 <= Gm <= Cm`, `0 <= Gl <= Cl` with nonnegative glycogen/transient water and
signed separate ECF; uncertainty plus unavailable output; and held-out human
validation with paired glycogen measures, serial body mass/fluid measures,
interval coverage and exercise-type generalization.

The needed study is a preregistered repeated-measures cohort across sex, body
size and training status, recording carbohydrate dose/timing/food form,
hydration/sodium/fasting, controlled resistance and stepper/endurance exposure,
paired muscle/liver MRS where feasible, compartmental water, and consistent
scale timing. A local vastus biopsy cannot validate whole-body forecasts.

## Conclusion and non-actions

The highest defensible result is Level 1. Model C/D is the correct research
target, but all quantitative transitions remain blocked. This memo makes no
claim-status change; adds no implementation, Prisma change, response change or
test; and preserves Stage-7 constraints: no calories-to-carbs inference, no
Garmin-as-truth, no lean/muscle conversion, no ECF residual and no fixed
glycogen-water ratio. Stop before Stage 8B.
