# Phase 7: extracellular-fluid dynamics

## Scientific equation and units

BodyCast implements the simplified extracellular-fluid (ECF) equation from the
Hall/NIDDK body-weight model:

```text
dECF/dt = (DeltaNa - xiNa * (ECF - ECFbaseline)
           - xiCI * (1 - CI / CIbaseline)) / sodiumConcentration
```

The state and every constant have explicit dimensional meaning:

- `ECF` and `ECFbaseline`: L;
- `DeltaNa`: current dietary sodium minus baseline dietary sodium, mg/day;
- `xiNa = 3000`: mg/(L day);
- `xiCI = 4000`: mg/day;
- `sodiumConcentration = 3.22 mg/mL = 3220 mg/L`;
- `CI` and `CIbaseline`: g/day, used only as a dimensionless ratio.

The carbohydrate term is negative below baseline intake and positive above it.
The sodium term is positive for sodium above baseline and negative below it.
These directions reproduce the published equation.

## State architecture and one-day solution

The model stores:

```text
absolute ECF = baselineExtracellularFluidLiters
             + extracellularFluidDeviationLiters
```

This prevents an absolute ECF volume from being confused with the Hall equation's
signed change from baseline. For constant daily inputs, BodyCast uses the exact
analytic one-day transition rather than an Euler approximation. If `x` is the
ECF deviation:

```text
forcing = DeltaNa - xiCI * (1 - CI / CIbaseline)
xEquilibrium = forcing / xiNa
lambda = xiNa / sodiumConcentration
xTomorrow = xEquilibrium + (xToday - xEquilibrium) * exp(-lambda * 1 day)
```

The result exposes both liters and the associated mass change. Water density is
explicitly fixed at `1 kg/L`; ECF never contributes energy to fat, lean-tissue,
or glycogen energy accounting.

## Initial ECF estimate

Initial volume uses the externally validated healthy-adult equation reported by
Tabibzadeh et al. (2022):

```text
ECFV(L) = sexIntercept + 0.1393 * weightKg
        + 0.0455 * heightCm + 0.0125 * ageYears
male intercept = -2.6631 L
female intercept = -3.3407 L
```

This equation was selected over older equations because the validation study
reported comparatively low bias and good agreement in an independent healthy
adult cohort, and it needs only profile inputs BodyCast already defines. It is
still a population estimate, not a direct fluid measurement. BodyCast therefore
labels its method and keeps the estimate separate from later dynamic deviation.

## Missing sodium policy and Apple Health

The transition requires both carbohydrate intake and sodium change. `null` or
`undefined` for either returns an explicitly unavailable result. Missing sodium
is never converted to zero; zero means an observed or deliberately assumed
unchanged sodium intake relative to baseline. The same distinction applies to
carbohydrate intake, where explicit zero remains a real observation.

Apple Health exposes `dietarySodium` as a cumulative mass quantity. A later
integration may import it, but only when food logging is sufficiently complete
to distinguish a true daily total from missing data. Phase 7 intentionally does
not change sync, persistence, API, or UI behavior.

## Model boundaries

ECF is distinct from glycogen-associated intracellular water (`2.7 kg water` per
kg glycogen). Body mass reconstruction is:

```text
BW = fat + lean tissue + glycogen + glycogen water + rhoWater * ECF
```

No ECF energy is added or subtracted. This phase is a pure one-day deterministic
transition and does not implement state estimation, smoothing, forecasting, or
multi-day simulation.

## Sources

- Hall et al., *Quantification of the effect of energy imbalance on bodyweight*,
  [NIDDK/Lancet web appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf).
- Tabibzadeh et al., *New equations for estimating extracellular fluid volume in
  healthy adults*, [Clinical Kidney Journal / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9039904/).
- Apple, HealthKit `dietarySodium`,
  [official documentation](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/dietarysodium).
