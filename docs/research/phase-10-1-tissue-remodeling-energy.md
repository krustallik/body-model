# Phase 10.1 — Tissue remodeling energy and closed energy balance

## Scope

This phase closes the one-day Fat/LeanTissue energy system. It does not advance
state across dates and does not add personalization, forecasting, persistence,
or UI behavior.

## Scientific sources

- Hall KD, Sacks G, Chandramohan D, et al. *Quantification of the effect of
  energy imbalance on bodyweight*, peer-reviewed Lancet web appendix:
  https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf
- Hall KD. *Mathematical modelling of energy expenditure during tissue
  deposition*. Br J Nutr. 2010;104:4–7:
  https://doi.org/10.1017/S0007114510000206
- Hall KD. *Predicting metabolic adaptation, body weight change, and energy
  intake in humans*. Am J Physiol Endocrinol Metab. 2010;298:E449–E466:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2838532/
- Hall KD. *What is the required energy deficit per unit weight loss?* Int J
  Obes. 2008;32:573–576:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2376744/

## Hall energy terms and constants

Hall writes tissue-dependent expenditure as:

```text
EE = ordinary expenditure + etaF * dF/dt + etaL * dL/dt
```

The NIDDK appendix specifies:

```text
rhoF  = 39.5 MJ/kg       stored chemical energy of body fat change
rhoL  =  7.6 MJ/kg       stored chemical energy of lean-tissue change
etaF  = 750 kJ/kg        biochemical synthesis energy for fat
etaL  = 960 kJ/kg        biochemical synthesis energy for lean tissue
```

Using the repository's exact `1 kcal = 4.184 kJ` conversion:

```text
etaF = 750 / 4.184 = 179.25430210325048 kcal/kg
etaL = 960 / 4.184 = 229.4455066921606 kcal/kg
```

Hall identifies eta as ATP costs associated with TAG and protein synthesis.
The rho values are separately used on the left side of the energy-balance
equation as energy stored or released by tissue. Hall's equation contains both
`rho*dMass` and `eta*dMass`, and his theoretical deposition efficiencies are:

```text
kF = rhoF / (rhoF + etaF)
kL = rhoL / (rhoL + etaL)
```

Therefore rho does not already include eta. Omitting eta ignores synthesis
energy; adding eta separately is required and is not double counting. Baseline
turnover costs remain part of ordinary expenditure/RMR, while eta times net
tissue change represents the incremental remodeling term.

## Implicit system and closed-form derivation

Let energy remaining after ordinary expenditure and glycogen be `R`:

```text
R = energyIntake - baseModelExpenditure - glycogenStorageEnergy
```

Let `B` be energy chemically stored in Fat and LeanTissue after remodeling, and
let the existing Forbes/Hall energy partition be:

```text
p = C / (C + FatMass)

dF = (1-p) * B / rhoF
dL = p * B / rhoL
```

The remodeling term is:

```text
Eremodel = etaF*dF + etaL*dL
```

Energy closure requires `R = B + Eremodel`. Substitution gives:

```text
R = B * [1 + etaF*(1-p)/rhoF + etaL*p/rhoL]

B = R / [1 + etaF*(1-p)/rhoF + etaL*p/rhoL]
```

This is the same algebraic structure obtained when the NIDDK appendix
substitutes the tissue differential equations into expenditure and solves the
implicit equation. Computing tissue change first and adding eta afterward would
change total expenditure without feeding that change back into the available
energy and would violate conservation.

## Sign interpretation

The Hall tissue-deposition paper states that this formulation is valid for both
signs of tissue change. BodyCast therefore preserves the algebraic sign:

- surplus: `dF`, `dL`, and remodeling energy are positive; synthesis increases
  expenditure and leaves less energy stored than the original surplus;
- deficit: `dF`, `dL`, and remodeling energy are negative; reduced synthesis /
  net mobilization reduces this expenditure term, so the magnitude of stored
  tissue energy is smaller than the original deficit;
- zero: all storage, mass-change, and remodeling terms are canonical zero.

No absolute value or nonnegative clamp is applied. A negative value is called a
remodeling energy term, not a positive cost.

## Worked surplus and deficit

For `FatMass=20 kg`, the existing local Forbes relation gives:

```text
p = 0.09095093436435607
denominator = 1.0287489643744823
```

For `R=+500 kcal`:

```text
B                    = +486.0272207457518 kcal
fat storage          = +441.8225908924145 kcal
lean-tissue storage  =  +44.2046298533373 kcal
dF                   =   +0.0467996384885 kg
dL                   =   +0.0243358120140 kg
fat remodeling       =   +8.3890365359319 kcal
lean remodeling      =   +5.5837427183163 kcal
total remodeling     =  +13.9727792542482 kcal
closure              = +500 kcal
```

For `R=-500 kcal`, every storage, mass-change, and remodeling value above has
the opposite sign; `p` and the denominator are unchanged. Thus:

```text
-441.8225908924145 - 44.2046298533373 - 13.9727792542482 = -500 kcal
```

The previous eta-free implementation assigned the full `±500 kcal` to stored
tissue. The new implementation assigns `±486.0272 kcal` to stored tissue and
`±13.9728 kcal` to remodeling, documenting the intentional behavioral change.

## Glycogen and full-system conservation

Ordering remains:

```text
intake - base model expenditure
  -> glycogen storage/release
  -> remodeling-aware Fat/LeanTissue partition
```

Example surplus:

```text
total energy balance       = +600 kcal
glycogen storage           = +100 kcal
R before tissue            = +500 kcal
tissue storage             = +486.0272207457518 kcal
tissue remodeling          =  +13.9727792542482 kcal
full closure               = +600 kcal
```

For glycogen depletion, a negative glycogen-storage term releases chemical
energy before the tissue partition. It is subtracted exactly once. Glycogen-
associated water and ECF carry mass but no chemical energy in this accounting
and never appear in the closure equation.

## API decision and limitations

`partitionEnergyBalance` remains the single public Fat/LeanTissue partition
primitive, but its input is now explicitly `availableEnergyKcal` and its result
exposes stored-energy and remodeling components. The glycogen-aware wrapper
calls this complete primitive. There is no second public eta-free function whose
meaning could be confused with the Hall-consistent result.

This is still an aggregate adult model. Lean tissue is treated as protein plus
associated intracellular water for the eta approximation; heterogeneous organ
and skeletal-muscle synthesis is not resolved. The use of one-day finite
changes approximates the continuous differential equation, and no multi-day
state transition is implemented here.
