# Phase 6: glycogen and glycogen-associated water

## Selected scientific model

BodyCast uses the simplified early-weight-change equation from the Hall/NIDDK
Body Weight Planner appendix:

```text
rhoG * dG/dt = CI - kG * G^2
kG = CI_baseline / G_initial^2
```

Units in the implementation are:

- `G`: kg glycogen;
- `t`: day;
- `CI`: kcal/day of dietary carbohydrate;
- `rhoG`: `17.6 MJ/kg = 4206.500956... kcal/kg`;
- `kG`: kcal/(kg^2 day).

Apple Health carbohydrate grams are converted using the existing metabolizable
energy value `4 kcal/g`. At `CI = CI_baseline` and `G = G_initial`, influx and
quadratic outflow are equal, so `dG/dt = 0`. The quadratic term was selected by
Hall et al. so an approximately threefold carbohydrate intake produces roughly
1.8 times baseline glycogen at equilibrium, consistent with carbohydrate
overfeeding data.

This is a deliberately aggregated latent-state model. It does not separately
represent liver and muscle glycogen, glucose oxidation, gluconeogenesis, insulin,
lactate, or muscle-specific exercise depletion.

## Initial glycogen and baseline intake

Hall assumes about `0.5 kg` total body glycogen at baseline. Contemporary
reviews commonly describe about `100 g` liver glycogen and approximately
`350–700 g` muscle glycogen, with wide variation by body size, training, diet,
and recent exercise. BodyCast exposes `0.5 kg` as a configurable model default;
it is not presented as an Apple Health measurement or personalized estimate.

`baselineCarbIntakeG` is the typical daily intake that holds the configured
initial glycogen at equilibrium. It is supplied explicitly to the pure model.
Later, the application layer should estimate it from a stable recent diet
period. A practical policy is a robust/winsorized mean from at least 7 and
preferably 14 or more valid days in an approximately 28-day window. A mean is
appropriate to an energy flux, while robust treatment limits logging outliers.
These counts are engineering defaults, not validated physiological constants.

Missing carbohydrate remains unavailable. Explicit `0 g` is a true fasting/no-
carbohydrate input and follows the zero-input differential equation.

## Exact one-day integration

For constant daily `CI`, define:

```text
a = CI / rhoG
b = kG / rhoG
Q = sqrt(a / b) = sqrt(CI / kG)
z = ((G0 - Q) / (G0 + Q)) * exp(-2*b*Q*t)
G(t) = Q * (1 + z) / (1 - z)
```

BodyCast evaluates this analytic solution at `t = 1 day`. For `CI = 0`, its
well-defined limiting solution is used directly:

```text
G(t) = G0 / (1 + b*G0*t)
```

This avoids the negative values and step-size error possible with a one-day
Euler update and does not require arbitrary clamps or hidden substeps.

## Associated water and body mass

The Hall model uses the derived relationship:

```text
glycogenWaterKg = 2.7 * glycogenKg
glycogenAssociatedMassKg = 3.7 * glycogenKg
```

Thus `deltaG = -0.100 kg` produces `-0.270 kg` associated water and a total
`-0.370 kg` glycogen-system mass effect. Human experiments support an order of
about 3 g water per gram of glycogen but also show context-dependent variation;
`2.7` is therefore a model coefficient, not an exact individual measurement.
Water contributes mass but no stored chemical energy.

## Energy accounting

Glycogen chemical storage is:

```text
glycogenStorageEnergyKcal = deltaGlycogenKg * rhoG
partitionableEnergyKcal = totalEnergyBalanceKcal - glycogenStorageEnergyKcal
```

The remainder is passed to the existing fat/lean-tissue partition:

```text
totalEnergyBalance
  = glycogenStorageEnergy
  + fatEnergy
  + leanTissueEnergy
```

A positive glycogen change consumes storage energy and leaves less for fat and
lean tissue. A negative change releases energy, making the remaining balance
less negative. Glycogen-associated water is intentionally absent from this
energy equation.

## Activity limitations

Muscle glycogen use depends strongly on exercise intensity, duration, trained
muscle groups, pre-exercise stores, and carbohydrate availability. BodyCast has
only walking summaries and strength-training duration. Assigning a fixed
glycogen cost per minute would manufacture precision and risks double counting
activity already represented in total expenditure. The simplified Hall equation
therefore receives no separate walking or strength-depletion term in this phase.

## Sources

- Hall et al., *Quantification of the effect of energy imbalance on bodyweight*,
  [NIDDK/Lancet web appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf).
- Hall, *Predicting metabolic adaptation, body weight change, and energy intake
  in humans*, [American Journal of Physiology](https://doi.org/10.1152/ajpendo.00559.2009).
- Chow and Hall, *The Dynamics of Human Body Weight Change*,
  [PLOS Computational Biology / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2266991/).
- Murray and Rosenbloom, *Fundamentals of glycogen metabolism for coaches and
  athletes*, [Nutrition Reviews / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6019055/).
- Areta and Hopkins, *Skeletal muscle glycogen content at rest and during
  endurance exercise*, [PMC review](https://pmc.ncbi.nlm.nih.gov/articles/PMC5872716/).
- Fernández-Elías et al., *Relationship between muscle water and glycogen
  recovery*, [PubMed](https://pubmed.ncbi.nlm.nih.gov/25911631/).
