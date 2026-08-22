# Phase 4 research: energy balance and fat/FFM partition

## Decision

BodyCast defines daily energy balance as `intakeKcal - expenditureKcal`. Negative
values are deficits, positive values are surpluses, and zero is maintenance.

For a one-day imbalance, BodyCast uses the local Forbes relation as expressed in
the Hall/NIDDK dynamic model:

```text
dFFM / dFM = 10.4 kg / FM
rhoFM = 39.5 MJ/kg
rhoFFM = 7.6 MJ/kg
C = 10.4 kg * rhoFFM / rhoFM = 2.001012658... kg
p = C / (C + FM)
```

Here `p` is the fraction of the energy imbalance assigned to the fat-free-mass
compartment. It is distinct from the fraction of mass change that is FFM,
`10.4 / (10.4 + FM)`. The implementation then preserves energy exactly:

```text
FFM energy = p * energy balance
fat energy = energy balance - FFM energy
delta FFM = FFM energy / rhoFFM
delta fat = fat energy / rhoFM
```

The same local differential is used for a small one-day deficit or surplus.
This does not imply that long-term weight loss and gain are physiologically
symmetric. Diet composition, protein intake, resistance training, sex, age,
and the size and duration of weight change can alter observed partitioning.

Fat-free mass is a compartment containing body protein and associated water,
glycogen and water, organs, bone, and other non-fat mass. It is not synonymous
with skeletal muscle. This phase does not separately model glycogen or fluid
shifts and therefore does not predict an immediate scale-weight change.

`fatMassKg` must be known and greater than zero. No fallback body-composition
estimator or clamp is used. The zero-fat limit is not accepted because it is
physiologically impossible and the underlying logarithmic Forbes curve is not
defined there.

## Why not a fixed 7,700 kcal/kg rule?

A fixed energy-per-kilogram rule assumes a constant composition of weight
change. Forbes/Hall instead makes that composition depend on current fat mass
and uses different effective densities for fat and FFM. A leaner body assigns a
larger fraction of the energy imbalance to FFM, so energy per kilogram of total
mass change is not constant.

## Sources

- Hall et al., *Quantification of the effect of energy imbalance on bodyweight*,
  [NIDDK web appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf).
- Chow and Hall, *The Dynamics of Human Body Weight Change*,
  [International Journal of Obesity / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2266991/).
- Hall, *Body Fat and Fat-Free Mass Inter-relationships: Forbes's Theory
  Revisited*, [British Journal of Nutrition / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2376748/).
- Hall, *What is the Required Energy Deficit per unit Weight Loss?*,
  [International Journal of Obesity / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2376744/).
- Forbes, *Lean body mass-body fat interrelationships in humans*,
  [Nutrition Reviews / PubMed](https://pubmed.ncbi.nlm.nih.gov/3306482/).
