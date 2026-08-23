# Phase 10 — Dynamic RMR and body-mass-dependent activity

## Scope

This phase supplies pure, deterministic primitives for one simulated day. It
does not advance body state, fit a personal residual, calibrate activity, or
read measured scale weight. The current latent body-composition state is the
only source of simulated body mass.

## Scientific sources

- Hall KD, Sacks G, Chandramohan D, et al. *Quantification of the effect of
  energy imbalance on bodyweight*. Lancet. 2011;378:826–837, peer-reviewed
  model appendix:
  https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf
- Hall KD, Jordan PN. *Modeling weight-loss maintenance to help prevent body
  weight regain*. Am J Clin Nutr. 2008;88:1495–1503:
  https://doi.org/10.3945/ajcn.2008.26333
- Hall KD. *Predicting metabolic adaptation, body weight change, and energy
  intake in humans*. Am J Physiol Endocrinol Metab. 2010;298:E449–E466:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/
- Nelson KM et al. *Prediction of resting energy expenditure from fat-free mass
  and fat mass*. Am J Clin Nutr. 1992;56:848–856:
  https://doi.org/10.1093/ajcn/56.5.848
- Herrmann SD et al. *2024 Adult Compendium of Physical Activities: A third
  update of the energy costs of human activities*. J Sport Health Sci.
  2024;13:6–12:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC10818145/

## Selected dynamic RMR equation

The Hall models separate a constant term from tissue-dependent resting costs.
Hall and Jordan report `gamma_FM = 3.2 kcal/(kg day)` and
`gamma_FFM = 22 kcal/(kg day)`. The later NIDDK appendix gives rounded SI
counterparts of 13 and 92 kJ/(kg day), respectively. Nelson et al. independently
supports the same qualitative structure: fat-free tissue has a much larger
coefficient than fat tissue.

BodyCast therefore uses:

```text
structuralRmr(F, L) = 3.2 F + 22 L

rmrCalibrationOffset =
  initialMifflinRmr - structuralRmr(initialF, initialL)

dynamicRmr =
  rmrCalibrationOffset + structuralRmr(currentF, currentL)
```

Equivalently:

```text
dynamicRmr = initialMifflinRmr
  + 3.2 * (currentF - initialF)
  + 22 * (currentL - initialL)
```

All masses are kg and the result is kcal/day. This relative-change form is the
scientifically cleaner role split for this product: Mifflin supplies the user's
baseline level, while the Hall tissue coefficients supply longitudinal change.
It exactly prevents a day-1 discontinuity.

The calibration constant is an alignment between two RMR formulations. It is
not the future `personalOffset`, which will represent residual error in total
expenditure and is deliberately absent here.

## Lean-compartment semantics

Hall's `L`/FFM compartment contains non-fat body material in the model's
composition accounting. BodyCast's state deliberately decomposes transient
glycogen, glycogen-associated water, and ECF from structural `leanTissueKg`.
Passing observed BIA FFM would add these explicit compartments back into the
structural term and make water changes look metabolically active. The dynamic
primitive therefore accepts only latent `fatMassKg` and `leanTissueKg`.

This is an engineering mapping of Hall's tissue coefficient onto BodyCast's
explicit-compartment state, not a claim that all lean organs and skeletal muscle
have identical metabolic rates. It preserves the existing state contract and
avoids obvious water-driven RMR artifacts.

## Glycogen, water, and ECF

Glycogen, its associated water, and ECF do not directly enter dynamic RMR.
Identical Fat/LeanTissue states therefore have identical RMR even when their
scale weights differ because of transient water. Glycogen and water still enter
reconstructed total body mass and can slightly change the gross cost of moving
that mass.

## Activity scaling and the double-scaling trap

Standard MET is a body-mass-normalized convention: approximately
`1 kcal/(kg hour)`. Existing BodyCast activity primitives already compute gross
cost as:

```text
gross activity kcal = MET * current predicted weightKg * durationHours
```

Consequently, multiplying that result again by `futureWeight / initialWeight`
would apply body-mass change twice. Phase 10 leaves the activity primitives
unchanged and changes orchestration only: every one-day calculation reconstructs
current latent weight and passes it directly to walking, strength, and
occupational MET calculations.

The scenario behavior remains independent of its energy cost. Five kilometers,
60 minutes, or four occupational hours remain the same inputs as weight changes.

Locomotion uses total predicted body weight:

```text
BW = Fat + LeanTissue + Glycogen + 2.7*Glycogen + ECF
```

This is appropriate for the mass being moved. Noisy observed scale weight is
not used. Strength and occupational expenditure retain linear total-mass MET
scaling as a transparent approximation because BodyCast does not know loads,
sets, repetitions, task-specific mechanics, heart rate, or measured oxygen
consumption.

## Dynamic RMR in net activity

The Compendium's standard 1-MET denominator is a population convention and is
not identical to an individual's predicted resting expenditure. BodyCast's
existing internally consistent net calculation is retained:

```text
grossActivity = MET * currentPredictedWeightKg * durationHours
restingDuringActivity = currentDynamicRmr / 24 * durationHours
netActivity = grossActivity - restingDuringActivity
```

Body composition thus affects net activity through two intentional paths:
current total mass changes gross MET cost, and current structural RMR changes
the resting energy that must not be double counted. There is no additional
weight ratio. Walking is explicitly named outside-work walking in the one-day
helper, preserving the Phase 7.1 occupational-overlap boundary.

## One-day composition and missing data

The complete pre-personalization result is:

```text
modelTdeeBeforePersonalization =
  dynamicRmr + macroBasedTef + netActivity + adaptiveThermogenesis
```

AT uses its existing sign: it can be negative during restriction. The helper
returns `null` for the complete result if TEF, any activity component, or AT is
unknown. Explicit zero macros, zero activity, and zero AT remain known zeros.
No database models, personal offset, activity calibration, or temporal state
transition are involved.

## Limitations

- The two tissue coefficients aggregate metabolically heterogeneous organs and
  tissues; they are not direct organ-level calorimetry.
- Mifflin and body-composition measurement both have individual prediction
  error. Calibration removes the initial equation discontinuity, not that error.
- MET tables estimate group-average costs. Strength and occupational work are
  especially uncertain without workload and physiological measurements.
- Standard MET values can misrepresent individual relative intensity; using
  individualized RMR for the rest subtraction improves internal accounting but
  does not turn the gross MET estimate into indirect calorimetry.
- This phase composes one day only and makes no claim about future behavior,
  state evolution, or personalized prediction accuracy.
