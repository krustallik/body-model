# Phase 13.1 — Missing Nutrition Gap Bridging

## Scope and evidence

This policy belongs to historical application integration. It does not alter any equation in
`src/model`. Missing scale weight remains a normal missing observation: the Weight Observation
Filter performs its prediction step without a measurement update. Missing intake is different
because calories and macros are required exogenous inputs to energy balance, TEF, glycogen, and
the subsequent state transition.

Longitudinal complete-case interruption discards later observed information. Modern missing-data
methods generally prefer likelihood or multiple-imputation approaches when the inferential model
can represent them. Multiple imputation represents uncertainty across several plausible completed
datasets; deterministic single imputation cannot do that and therefore understates uncertainty.
BodyCast uses a bounded deterministic bridge only as a product-reliability measure for retrospective
state advancement, not as a claim that the estimated intake is true.

Self-reported dietary intake also contains omission, portion, food-database, rounding, and systematic
under-reporting error even when a day is logged. Consequently, neither observed nor imputed intake
should be described as ground truth.

Primary references:

- Young & Johnson, *Handling Missing Values in Longitudinal Panel Data With Multiple Imputation*
  (2015): https://pmc.ncbi.nlm.nih.gov/articles/PMC4477955/
- He et al., *Missing Data Analysis Using Multiple Imputation* (2010):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2818781/
- Huque et al., comparison of multiple-imputation methods for longitudinal data (2018):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC6292063/
- McCrory et al., plausibility and measurement error in self-reported energy intake (2017):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC5622407/
- Kirkpatrick et al., systematic review of omissions and portion misestimation (2022):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC9776649/
- Burke et al., dietary self-monitoring and missing food records in weight management (2014):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC4149603/

## Deterministic policy

The frozen episode default is `maxBridgeDays = 2`. One or two consecutive incomplete nutrition
days may be bridged; three or more remain missing. This is a conservative engineering/product
policy, not a clinical constant. It bounds accumulated state error while covering short real-world
logging lapses. The database constrains the configurable value to 0–7.

For every bounded gap:

1. Identify complete **observed** nutrition days within seven calendar days of the gap.
2. Retain at most the three nearest observed days before and three nearest after the gap.
3. If at least two references exist, choose an actual joint donor. For a completely missing day,
   choose the donor nearest the reference-calorie median; date proximity and date provide stable
   tie-breaks. For a partially observed day, first minimize normalized disagreement with its
   observed fields, then use the robust calorie center and proximity tie-breaks.
4. Copy the donor's complete nutrition vector for wholly missing nutrition. For a partial day,
   preserve every observed value and fill only missing fields from the selected donor.
5. If local evidence is insufficient, use the episode's frozen joint fallback donor. That donor is
   an actual complete observed day selected near the robust multivariate center of the episode's
   maintenance window during initialization. It is never derived from imputed data.
6. If there is no usable fallback or the completed partial vector fails the broad consistency guard,
   the day remains missing.

This is donor-style imputation, not linear interpolation. A high/refeed day beside a gap therefore
does not force the missing day to the arithmetic midpoint. Recent symmetric context naturally takes
precedence over an older maintenance fallback, while a tail gap uses the same deterministic trailing
donors without consulting the wall clock.

## Calories and macros

Nutrition is handled jointly. Explicit zero remains observed zero; null never becomes zero.
The imputed vector must be finite and nonnegative. The broad application sanity check requires
`(4P + 9F + 4C) / calories` to remain between 0.5 and 1.5. This deliberately does not require exact
Atwater equality because fiber, alcohol, rounding, and food-database differences are common. The
bounds are an engineering pathology guard, not physiological confidence limits.

For partial logging, observed fields are constraints and are never overwritten. BodyCast does not
solve a missing macro directly from calorie arithmetic. A donor supplies only the absent fields. If
the resulting combination is pathological, the day is left missing rather than interpreted as a
severe deficit.

## Provenance and propagation

Every persisted day records:

- `nutritionSource`: `observed`, `imputed-local`, `imputed-fallback`, or `missing`;
- imputation method, reference-day count, and gap length;
- reference dates, observed/imputed fields, calorie median/MAD, and macro MAD;
- state dependency: `observed`, `imputed-direct`, or `imputed-downstream`;
- data quality: `observed`, `estimated`, `incomplete`, or `blocked`.

An imputed input changes latent physiology, so all later reconstructed states remain marked
`estimated` until the imputation is replaced by observed source data. This is intentionally
conservative: the current model has no statistically justified point where a later scale reading
fully removes uncertainty from fat, lean tissue, glycogen, and AT states.

## Calibration policy

Imputed nutrition may advance retrospective physiology, but it must not satisfy calibration gates as
if observed. Calibration uses only the contiguous fully observed prefix before the first imputed or
missing nutrition day. This excludes the direct gap and every downstream weight observation whose
predicted latent state depends on it, without changing the Phase 12/12.1 likelihood or gates.
Diagnostics persist eligible, imputed, missing, and excluded-dependent counts.

This policy sacrifices some calibration data in exchange for avoiding false precision. A future
uncertainty-aware implementation can use the stored donor-reference MAD diagnostics in multiple
trajectories or Monte Carlo propagation. Phase 13.1 does not implement stochastic imputation.

## Long gaps and recalculation

A gap longer than the frozen maximum is explicit `missing`; no zeros or unlimited repeated intake are
created. The simulator marks that day incomplete and later days blocked, preserving the existing
safe failure semantics.

When actual nutrition is later entered, normal full-episode recalculation changes provenance from
estimated to observed, replaces the imputed trajectory, recomputes all later states, and UPSERTs the
same `(episodeId, date)` rows. No cleanup or random resampling is needed, and unchanged source history
produces identical results.
