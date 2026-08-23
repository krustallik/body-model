# Phase 5.2: observed composition versus Hall model state

## Scientific state definitions

The Hall/NIDDK dynamic model does not use conventional two-compartment FFM as
its lean-tissue state when glycogen and fluid are explicit. Its relevant mass
compartments are:

- `F`: body fat mass;
- `L`: lean tissue mass, whose dynamic change is primarily body protein and its
  associated intracellular water;
- `G`: glycogen;
- glycogen-associated intracellular water, derived as `2.7 * G`;
- `ECF`: extracellular-fluid volume in liters; its mass contribution uses the
  explicit water-density conversion `rhoWater = 1 kg/L`.

The resulting mass identity is:

```text
BW = F + L + G + 2.7G + rhoWater * ECF
```

Accordingly, the NIDDK appendix initializes lean tissue as:

```text
L_initial = BW_initial - F_initial - ECF_initial - G_initial - 2.7G_initial
```

Glycogen-associated water is derived, not an independent unconstrained state.
The later ECF implementation stores a baseline volume plus a signed deviation;
their sum is the absolute ECF volume used in this identity.

## Observed FFM is not latent lean tissue

BIA-derived observed composition retains the two-compartment identity:

```text
observedFatMass = bodyWeight * estimatedBodyFatPercent / 100
observedFatFreeMass = bodyWeight - observedFatMass
bodyWeight = observedFatMass + observedFatFreeMass
```

Observed FFM contains all non-fat mass, including glycogen, associated water,
ECF, protein, bone, organs, and other non-fat components. It is therefore not
interchangeable with Hall `L` after glycogen and ECF become explicit.

**Never calculate body weight as observed fat mass + observed FFM + explicit
glycogen/water/ECF.** That double counts masses already contained in observed
FFM. Observed FFM must first be decomposed before it can initialize latent `L`.
That decomposition is intentionally deferred until the required compartments
can be initialized scientifically.

## Partition semantics

Hall partitions energy between fat `F` and lean tissue `L`, after accounting for
energy stored in glycogen:

```text
rhoF * dF/dt = (1-p) * partitionableEnergy
rhoL * dL/dt = p * partitionableEnergy
partitionableEnergy = EI - EE - rhoG * dG/dt
```

Before glycogen dynamics exist, `partitionableEnergy` equals ordinary energy
balance. The previous names `fatFreeMassEnergyKcal` and
`deltaFatFreeMassKg` were scientifically ambiguous and are replaced by
`leanTissueEnergyKcal` and `deltaLeanTissueKg`. The Forbes/Hall equations and
energy densities are unchanged.

## Reduced-model caveat

Chow and Hall also describe a reduced two-compartment model where `L = M - F`
and lean mass includes glycogen, associated intracellular water, ECF, and stable
inert mass. This reduction assumes glycogen is in quasi-equilibrium on longer
timescales. BodyCast uses the explicit-compartment terminology because future
phases intend to model short-term glycogen and fluid behavior.

## Sources

- Hall et al., *Quantification of the effect of energy imbalance on bodyweight*,
  [NIDDK/Lancet web appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf).
- Chow and Hall, *The Dynamics of Human Body Weight Change*,
  [PLOS Computational Biology / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2266991/).
- Hall, *Body Fat and Fat-Free Mass Inter-relationships: Forbes's Theory
  Revisited*, [British Journal of Nutrition / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC2376748/).
