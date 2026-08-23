# Phase 9 — Adaptive thermogenesis

## Scope

Adaptive thermogenesis (AT) is represented here as a latent additive energy-
expenditure adjustment driven by a change in energy intake relative to baseline.
It is not an Apple Health measurement. This phase implements only a pure,
deterministic state transition and does not change TDEE, RMR, body composition,
the database, or the application.

## Scientific sources

- Hall KD, Sacks G, Chandramohan D, et al. *Quantification of the effect of
  energy imbalance on bodyweight*. Lancet. 2011;378:826–837, peer-reviewed
  dynamic-model appendix:
  https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf
- NIDDK. *Research Behind the Body Weight Planner*:
  https://www.niddk.nih.gov/research-funding/at-niddk/labs-branches/laboratory-biological-modeling/integrative-physiology-section/research/body-weight-planner
- Hall KD. *Predicting metabolic adaptation, body weight change, and energy
  intake in humans*. Am J Physiol Endocrinol Metab. 2010;298:E449–E466.
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/
- Hall KD, Jordan PN. *Modeling weight-loss maintenance to help prevent body
  weight regain*. Am J Clin Nutr. 2008;88:1495–1503.
  https://doi.org/10.3945/ajcn.2008.26333
- Nunes CL et al. *Does adaptive thermogenesis occur after weight loss in
  adults? A systematic review*. Br J Nutr. 2022;127:451–469.
  https://pubmed.ncbi.nlm.nih.gov/33762040/
- Müller MJ, Heymsfield SB, Bosy-Westphal A. *Are metabolic adaptations to
  weight changes an artefact?* Am J Clin Nutr. 2021;114:1386–1395.
  https://pubmed.ncbi.nlm.nih.gov/34134143/
- Westerterp KR. *Metabolic adaptations to over- and underfeeding—still a
  matter of debate?* Eur J Clin Nutr. 2013;67:443–445.
  https://pubmed.ncbi.nlm.nih.gov/23232582/

## Definition and separation from other expenditure

The Hall/NIDDK appendix defines AT as the intake-associated change in energy
expenditure over and above the change expected from body composition. It is
separate from:

- TEF: immediate digestion, absorption, and nutrient-processing cost;
- structural RMR: expenditure predicted by current Fat/LeanTissue and other
  body-composition changes;
- Activity: walking, strength, occupational, and other movement;
- glycogen/water/ECF: body-mass compartments, not expenditure corrections.

Modern evidence reinforces the need for this residual definition. Estimates are
sensitive to how fat-free-mass composition and energy balance are controlled.
The 2022 systematic review found substantial heterogeneity, smaller or
non-significant AT in higher-quality designs, and attenuation or absence after a
weight-stabilization/neutral-energy-balance period. Therefore Hall's coefficients
are retained as configurable model defaults, not universal physiology.

## Hall equation and sign convention

The verified Hall/NIDDK equation is:

```text
tauAT × dAT/dt = betaAT × deltaEI - AT

deltaEI = currentEnergyIntake - baselineEnergyIntake
```

Units:

```text
AT, deltaEI              kcal/day
betaAT                   dimensionless
tauAT                    days
dAT/dt                   kcal/day²
```

AT is added to energy expenditure. Consequently:

- restriction: `deltaEI < 0`, target AT is negative, expenditure is reduced;
- overfeeding: `deltaEI > 0`, target AT is positive, expenditure is increased;
- baseline intake: `deltaEI = 0`, target AT is zero.

The Hall model uses the same beta in both directions. Human overfeeding and
restriction responses are heterogeneous and may be asymmetric, but current
evidence does not provide a single robust direction-specific pair for BodyCast.
The parameter remains configurable per transition so later calibration can test
that question without changing the state equation.

## Exact transition

For constant intake over `dt` days:

```text
targetAT = betaAT × deltaEI
decay = exp(-dt / tauAT)
ATnext = targetAT + (ATcurrent - targetAT) × decay
```

This is the analytic solution, not an Euler approximation. It is time-step
consistent: one two-day transition equals two one-day transitions under the same
forcing, within floating-point precision.

## Default parameters and initialization

```text
betaAT = 0.14
tauAT = 14 days
initial AT = 0 kcal/day at baseline equilibrium
```

The appendix states that `betaAT=0.14` came from Hall and Jordan's steady-state
analysis of longitudinal weight-loss studies and that `tauAT=14 days` represents
the AT dynamics seen in the prior Hall models. The appendix states that AT
approaches `betaAT × deltaEI` after the first several weeks.

Initialization at zero is the equilibrium solution when current and baseline
intake match. The implementation does not invent prior adaptation.

## Baseline energy intake

Hall's baseline is the initial energy-balanced intake before the intervention;
the model constant is set by the initial energy-balance condition. It is not the
current restricted intake and should not drift toward a deficit merely because a
recent rolling window contains dieting days.

Later application-layer recommendation:

1. identify a sufficiently long maintenance/weight-stable period with complete
   nutrition observations;
2. derive typical intake using a robust statistic such as a median or trimmed
   mean, while checking agreement with estimated maintenance expenditure;
3. store the selected baseline and its provenance for the modeled episode;
4. return baseline unavailable when evidence is insufficient rather than treating
   missing nutrition as zero.

The exact window and selection logic require real longitudinal validation and are
deliberately not implemented in this pure module.

## Interaction with BodyCast macro TEF

Hall's expenditure equation contains separate TEF and AT terms. Its simplified
TEF is immediate (`betaTEF × deltaEI`), whereas AT follows the slower 14-day
state equation. BodyCast replaces the fixed-fraction TEF approximation with a
macro-specific TEF calculated from protein, carbohydrate, and fat. Keeping the AT
term does not structurally double count TEF because AT is the residual adaptation
beyond ordinary body composition and the separately modeled food-processing cost.

However, `betaAT=0.14` was estimated inside Hall's model assumptions, including
its TEF representation. It is therefore a defensible initial default rather than
a precisely identified personal constant. Later calibration must avoid fitting AT
to errors already explained by macro TEF, dynamic RMR, or Activity.

## Analytic examples

For baseline 2500 kcal/day, current intake 2000 kcal/day, AT initially zero,
`betaAT=0.14`, and `tauAT=14 days`:

```text
deltaEI = 2000 - 2500 = -500 kcal/day
targetAT = 0.14 × -500 = -70 kcal/day
decay = exp(-1/14) = 0.931062779704
AT day 1 = -70 + (0 - -70) × decay
         = -4.825605421 kcal/day
```

With the same constant deficit:

```text
day 7    -27.542853820 kcal/day
day 14   -44.248439118 kcal/day
day 42   -66.514905214 kcal/day
day 365  -69.9999999997 kcal/day
limit    -70 kcal/day
```

After 42 deficit days, returning to baseline makes the target zero:

```text
recovery day 1   -61.929552541 kcal/day
recovery day 14  -24.469466160 kcal/day
limit             0 kcal/day
```

AT therefore recovers gradually rather than resetting. If intake changes before
equilibrium, the next transition begins from the current AT and approaches the new
target; it never restarts from zero.

## Missing data and validation

Missing current or baseline intake returns `null`. Explicit current intake zero
is retained as a real, mathematically valid forcing. Negative intake, negative
beta, nonpositive tau, negative elapsed time, NaN, and Infinity are rejected. AT
is not clamped: empirical safety or personalization bounds would need separate
scientific justification.

Future expenditure composition may be:

```text
effectiveTdee = dynamicRmr + macroTef + Activity + AT + personalOffset
```

That integration and all personalization are outside Phase 9.
