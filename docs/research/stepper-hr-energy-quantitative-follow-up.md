# Stepper HR energy: quantitative follow-up

Date: 2026-09-24  
Scope: BodyCast's fixed DOMYOS MS100 configuration, step-interval attribution,
heart-rate samples, active-energy resolution, and daily energy integration.

## Decision

Do not apply a numerical HR correction to stepper kcal yet. BodyCast has HR
samples, body mass, workout duration, and attributed steps, but it has no
same-person, same-MS100 HR–VO2 calibration measured against indirect
calorimetry. HR is therefore retained as workout context and a sampling-quality
signal. It does not change the mechanical estimate or its parameter-sensitivity
range. The current `context-only` label means precisely that; it is not a
calibrated measure of energy-estimate accuracy.

The mechanical MS100 result remains an experimental engineering estimate. The
v7 runtime currently selects it when its inputs are available because that is
BodyCast's product policy, not because the estimate has been validated as more
accurate than Garmin. Garmin active kcal stays a separate device estimate and
fallback; it is not a criterion reference.

## Reproducing the reported 180 kcal

The local PostgreSQL currently contains no stair-climbing workout, no timed
activity intervals, and one HR sample. It therefore cannot establish whether
the reported 180-vs-356 kcal pair came from a real workout, nor verify that
workout's step timing or HR coverage. The 1,200-step, 80-kg input below is an
illustrative regression case, not a recovered personal session.

With the estimator's fixed engineering priors:

```text
attributed steps N       = 1,200
body mass m              = 80 kg
effective step rise h    = 0.16 m (engineering prior)
net efficiency η         = 0.20 (engineering prior)
mechanical work W = m·g·h·N
                       = 150,630.144 J
active energy = W / η / 4,184
                       = 180.007 kcal
```

If those 1,200 steps span 20 minutes, cadence is 60 steps/minute. Once the
count is known, duration/cadence do not directly enter this mechanical kcal
equation; they describe the rate and become relevant to HR calibration and
protocol checks. The point estimate is about half of 356 kcal (Garmin is
1.98× higher; difference 175.99 kcal). The model's engineering parameter
envelope for this example is approximately 96–413 active kcal, so 356 lies
inside the envelope. This envelope is sensitivity to assumed height and
efficiency, not a statistical confidence interval or probability range.

The calculation has active/net semantics: it does not add resting calories
during the workout. A Garmin value stored as active energy has matching labels,
but remains another device estimate. Neither value is ground truth.

An earlier user-provided diagnostic snapshot contains one detailed 29-minute
session (23 Sep): observed interval steps 2,196.119, estimated steps 2,198.646,
step coverage 99.9%, and derived cadence 75.815 steps/min. Its HR sample mean
was 139.933 bpm, maximum 152 bpm, with the first-to-last sample span from
18:06 to 18:34 (about 96.6% of workout duration); that span does not prove
there were no internal sampling gaps. The page showed 362 BodyCast kcal
(mechanical range 194–829) and 356 device active kcal. HR did not numerically
change the selected result because no calibration is registered. These figures
are transcribed from the screenshot, not re-read from the currently connected
local DB. A separate 12-minute workout was visible in the training list with
154 device kcal, but its steps/HR/mechanical result were not present in the
supplied diagnostics, so it cannot support a like-for-like comparison. The
180-vs-356 pair cannot be tied to either displayed session without its workout
row and timed step data.

## What the equation captures and omits

The current equation is `m × g × h × attributed steps ÷ efficiency ÷ 4,184`.
Its vertical-work form is physically interpretable for raising body mass, and
stair-climbing studies give broad plausibility context for efficiencies around
this magnitude. It is not calibrated to the MS100. The device is a stationary
reciprocating mini-stepper: a repetition is not a measured net ascent in
height. The assumed 16 cm per counter step is not a verified body-center-of-
mass rise or machine stroke measurement, and the 20% efficiency is not a
personal/device measurement. The formula also has no sensor for hydraulic
resistance, force, pedal work, co-contraction, upper-body stabilization, or
handrail support. Those omissions can explain disagreement in either
direction; the available data cannot allocate the 176 kcal difference among
them.

Decathlon describes the MS100 console as showing repetitions, duration,
frequency, and calories, but its support material does not document a
calorimetry-validated kcal algorithm or a stroke-work calibration
([official MS100 support](https://support.decathlon.co.uk/stepper-ms-100)). A
different office mini-stepper has been studied with indirect calorimetry, but
it is a Discovery hydraulic device, not the MS100
([Dutta et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC2658993/)). Results
cannot supply MS100 coefficients.

## HR evidence and applicability

* The HR method estimates VO2 only after establishing a relation between HR
  and VO2. That relation varies by person and exercise modality. A recent
  multi-workload study found the HR method's transfer between cycling,
  walking, and running depended on modality and calibration protocol; it did
  not validate a stair machine ([Olsson et al., 2022](https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/s12874-022-01524-w)).
* A stair-climbing study used treadmill-calibrated, participant-specific HR
  equations before estimating stair energy in 14 adults. This supports
  calibrated HR as a possible method for stair climbing, not raw BPM as a
  universal kcal rule and not direct transfer to an MS100
  ([Halsey et al., 2012](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0051213)).
* A study across indoor cardio machines observed meaningful modality
  differences in HR and energy expenditure even at the same perceived effort
  ([Zeni et al., 1996](https://pubmed.ncbi.nlm.nih.gov/8618368/)).
* HR–VO2 relationships vary within a person across days as well as between
  people ([McCrory et al., 1997](https://pubmed.ncbi.nlm.nih.gov/9209164/)).
  Cardiovascular drift, heat, hydration, fatigue, fitness, medication, and
  wrist-sensor motion error further weaken a generic point conversion.
* Wrist-device reviews find energy estimates less reliable than HR itself and
  substantially activity/device dependent ([Fuller et al., 2020](https://pubmed.ncbi.nlm.nih.gov/32897239/),
  [Chevance et al., 2022](https://pubmed.ncbi.nlm.nih.gov/35416777/)).

The available BodyCast record does not contain a measured VO2–HR curve, resting
VO2, or an MS100-specific calorimetry holdout set. A population HR equation
would add unsupported parameters and still be modality-mismatched. A higher
HR can indicate greater cardiovascular strain in a matched steady-state
protocol; it does not tell BodyCast how many extra kcal to apply for this
person and machine. HR alone also cannot identify fat-versus-carbohydrate
oxidation; that requires respiratory-gas evidence (not just BPM).

## Quality, uncertainty, and downstream accounting

The observed HR sample count and the fraction of workout time between the first
and last samples are legitimate descriptions of signal availability. The UI
already exposes those values and labels HR as context-only without personal
calibration. No scientifically supported sampling threshold is available for
the current data, so this report adds no arbitrary good/bad coverage cutoff.

HR must not currently change the numerical kcal uncertainty range. Doing so
would require a held-out relationship between HR/coverage and residual error
against indirect calorimetry. The mechanical lower/upper values only propagate
assumed step-rise and efficiency endpoints; they are not a measured residual
distribution. HR coverage may help a future calibrated estimate pass or fail
its validated data-quality rules, but cannot narrow or widen this current
range quantitatively.

BodyCast uses exactly one selected workout-energy source per event: a validated
HR–VO2 estimate would replace mechanical kcal; otherwise an available
mechanical estimate is selected; device kcal is only a fallback. Selected
workout energy enters the daily expenditure once. During this audit, a related
deduplication gap was fixed: v7's walking-distance overlap had been gated only
on device kcal, even when BodyCast had selected its own stepper estimate. It
now also recognizes available v7 bracketed-step evidence, preventing the same
stair interval's walking distance from being added as ordinary walking on top
of stepper kcal. Device/reference kcal remains non-additive in the Unified
ledger, and no separate EPOC/recovery kcal is added.

## Data and validation limits

The current local database has zero real MS100/stair workouts and zero activity
intervals; it has only one HR sample, outside a stepper workout. The screenshot
provides one detailed session, and the training-list image provides one more
duration/device-energy pair, but neither makes a multi-session comparison
possible. Unit/integration fixtures are not personal training data. The
reported 180/356 pair should be read as two competing estimates unless its
actual workout record and timed steps are made available in the local database.

To authorize numerical HR kcal, collect multiple MS100 sessions with measured
indirect calorimetry (VO2 and VCO2), synchronized HR, body mass, workout
timestamps, counter/interval steps, and workload/cadence. Measure a resting
baseline for net active energy. Fit the user's HR–VO2 relation on some sessions
and evaluate bias/limits of agreement on held-out sessions at different
cadences and durations. Separately measure the MS100 pedal force/displacement
or center-of-mass work before revising its mechanical coefficients. Garmin
can be compared as an estimate in that study, never used as the target label.
