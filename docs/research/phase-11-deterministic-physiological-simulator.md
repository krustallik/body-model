# Phase 11 — Deterministic multi-day physiological simulator

## Scope and sources

This phase connects existing pure one-day primitives. It does not persist state,
fit personal parameters, expose a forecast, or use a measured scale weight as a
physiological compartment.

Primary references:

- Hall KD, Sacks G, Chandramohan D, et al. *Quantification of the effect of
  energy imbalance on bodyweight*, peer-reviewed Lancet web appendix:
  https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf
- Hall KD. *Predicting metabolic adaptation, body weight change, and energy
  intake in humans*. Am J Physiol Endocrinol Metab. 2010;298:E449–E466:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/
- Chow CC, Hall KD. *The dynamics of human body weight change*. PLoS Comput
  Biol. 2008;4:e1000045:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2266991/
- Hall KD. *Mathematical modelling of energy expenditure during tissue
  deposition*. Br J Nutr. 2010;104:4–7:
  https://doi.org/10.1017/S0007114510000206

The Hall model is a continuous system of differential equations. Chow and Hall
explain that its slow variables and intake/expenditure rates can be interpreted
as daily averages after averaging out fast within-day dynamics. Phase 11 uses a
documented one-day operator over those daily-average inputs rather than silently
mixing start- and end-state values.

## Discrete-time convention and sequencing

For the interval `[start of day t, start of day t+1)`:

1. Clone and validate the start state. Reconstruct its latent physiological
   weight from Fat, LeanTissue, glycogen plus derived glycogen water, and ECF.
2. Solve the exact one-day AT transition for today's constant intake and compute
   its exact interval mean.
3. Calculate ordinary expenditure from start-of-day Fat/LeanTissue and latent
   weight, today's macros/activity behavior, and mean AT.
4. Solve the exact one-day glycogen transition from start glycogen and today's
   carbohydrate input. Its chemical storage energy participates once in the
   same day's energy balance.
5. Compute `intake - ordinary expenditure`, subtract glycogen storage once, and
   solve the closed remodeling-aware Fat/LeanTissue partition using start-of-day
   FatMass for the local Forbes relation.
6. Evaluate ECF according to the caller's explicit policy. ECF is a parallel
   mass/water transition and does not enter chemical-energy accounting.
7. Construct a new end state from new Fat, LeanTissue, glycogen, ECF, and end AT.
   This state determines the next day's RMR and activity cost.
8. Center the Kalman prediction on physiological end weight, then optionally
   apply the measured-weight observation. Store its posterior only in the
   separate filter state.

Today's RMR never uses today's end tissue. Activity never uses measured weight
and receives no additional future/initial weight multiplier.

## Adaptive thermogenesis timing

The Hall equation for constant daily intake is:

```text
tau * dAT/dt = target - AT
target = beta * (current intake - baseline intake)
```

The exact end value over interval `Delta` is already used by BodyCast:

```text
ATend = target + (ATstart - target) * exp(-Delta/tau)
```

Using either `ATstart` or `ATend` as all-day expenditure biases the integral.
Phase 11 therefore uses the analytic interval mean:

```text
ATmean = target
  + (ATstart - target)
    * tau/Delta
    * (1 - exp(-Delta/tau))
```

`ATmean` enters today's ordinary expenditure. `ATend` enters tomorrow's state.
`expm1` is used for numerical stability, and zero elapsed time returns ATstart.

## Frozen episode parameters

The caller supplies one immutable episode configuration containing:

- Dynamic RMR calibration parameters;
- baseline energy intake;
- glycogen parameters, including baseline carbohydrate intake and reference
  glycogen;
- AT beta and time constant;
- filter process and measurement noise.

These values are never recomputed from simulated days. Starting a new baseline
means explicitly constructing a new episode configuration. Baseline ECF remains
part of the physiological state and is not rolled forward or re-estimated.

## ECF and missing sodium

The caller must choose one of three policies; there is no default:

- `full`: evaluate Hall ECF and require today's sodium change;
- `assume-unchanged-sodium`: explicitly use `deltaNaDiet=0` while retaining the
  carbohydrate response;
- `hold-ecf`: do not evaluate the ECF equation and keep ECF unchanged.

Until reliable sodium sync exists, `hold-ecf` is the conservative recommended
default at the application boundary. `assume-unchanged-sodium` is available for
scenario analysis but is an explicit physiological assumption, not observed
data.

## Missing data and chronological processing

Missing is never converted to zero. A transition requires calories, complete
macros, glycogen carbohydrate input, explicit walking/strength/occupational
behavior, and sodium only under `full` ECF. Zero remains valid for calories,
macros, and explicit absence of activity, subject to downstream physical-state
validation. Measured weight is optional.

An incomplete one-day result contains its missing field names and no end state.
In a multi-day run, this day is marked `incomplete`; every later day is marked
`blocked` because no scientifically valid start state exists. The result array
still contains one result per supplied day.

Dates must be real `YYYY-MM-DD` calendar dates, strictly increasing, and
consecutive. Duplicate, out-of-order, or silently skipped dates are rejected;
the caller must represent a missing date explicitly so it becomes an incomplete
and blocking day. System date and server timezone are never consulted.

## Energy and mass closure

Every complete day enforces the Phase 10.1 identity:

```text
intake - ordinary expenditure
  = glycogen storage energy
  + fat storage energy
  + lean-tissue storage energy
  + tissue remodeling energy
```

Ordinary expenditure is Dynamic RMR + macro TEF + net Activity + mean AT.
Glycogen-associated water and ECF appear only in mass:

```text
weight = Fat + LeanTissue + Glycogen + 2.7*Glycogen + ECF mass
```

No 7,700 kcal/kg shortcut is introduced.

## Observation filter separation

After the physiological end weight is reconstructed, the scalar Kalman filter
performs prediction and an optional measurement update. Missing measured weight
means prediction-only. The posterior may differ from physiological weight, but
it cannot overwrite Fat, LeanTissue, glycogen, or ECF. This preserves chemical
and mass conservation while exposing a useful observation diagnostic.

## Three-day golden deficit

Inputs are fixed at 2,500 kcal, 150 g protein, 200 g carbohydrate, 70 g fat,
5 km walking at 5 km/h, 60 minutes strength, and four hours of occupational
activity. Glycogen and ECF begin and remain at their configured equilibria.

| Day | Start kg | RMR | TEF | Activity | Mean AT | Energy balance |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 76.850000 | 1600.000000 | 222.600000 | 1175.425000 | -2.431880 | -495.593120 |
| 2 | 76.779492 | 1599.320892 | 222.600000 | 1174.149353 | -7.070777 | -488.999468 |
| 3 | 76.709882 | 1598.649757 | 222.600000 | 1172.890140 | -11.389882 | -482.750015 |

| Day | dG kg | dFat kg | dLean kg | Remodeling kcal | dECF L | End kg |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | -0.046387 | -0.024121 | -13.849627 | 0 | 76.779492 |
| 2 | 0 | -0.045759 | -0.023850 | -13.674893 | 0 | 76.709882 |
| 3 | 0 | -0.045164 | -0.023594 | -13.509446 | 0 | 76.641124 |

Activity changes from the current latent mass and RMR. The full precision
values are asserted component-by-component in tests rather than hidden in a
snapshot.

## Equilibrium, water, and stability

True equilibrium requires all driving terms to agree, not merely constant
behavior: intake equals ordinary expenditure, intake equals frozen baseline for
AT, carbs equal glycogen/ECF baseline, sodium change is zero, glycogen begins at
its equilibrium, and ECF begins at equilibrium. The equilibrium golden test
then has zero energy balance, tissue change, glycogen change, ECF change, and
weight change.

One water regression increases carbohydrate, explicitly balances its glycogen
storage energy, and holds ECF. Fat/LeanTissue changes are zero while glycogen and
derived water increase scale weight. A second equilibrium-energy regression
changes sodium under `full` ECF: only ECF and scale weight change. Together they
demonstrate why weight change is not synonymous with fat change.

Deterministic 30-, 90-, and 365-day runs verify finite positive compartments,
daily energy/mass identities, and absence of numerical explosion. A 365-day run
is only a stability/performance regression, not a forecast product. On the local
test environment it completes in a few milliseconds, leaving ample headroom for
later scenario orchestration.
