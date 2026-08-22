# Phase 5 research: initialization from noisy BIA observations

## Measurement model

A consumer smart scale measures body weight directly with load cells. For body
composition it passes a small alternating current through part or all of the
body, measures impedance, and uses assumptions about tissue conductivity,
fat-free-mass hydration, body geometry, population characteristics, and often a
proprietary prediction equation. Its body-fat percentage is therefore an
**observation-derived estimate**, not a direct measurement of fat mass and not
the latent body-composition state.

Validation results are device- and population-specific. A study of three home
smart scales found median weight errors around 0–0.3 kg but median fat-mass
errors of several kilograms. Other consumer devices have performed better, but
agreement and systematic bias vary substantially between models. Strong
population correlation does not establish individual agreement.

Hydration and fluid distribution, recent food and drink, exercise, bladder
status, posture, time of day, ambient and skin temperature, electrode contact,
and device/software version can alter impedance or the prediction derived from
it. Controlled studies find high repeatability under standardized conditions,
but also demonstrate day-to-day biological variation and systematic differences
from DXA. Repeating measurements can reduce random observation noise; it cannot
remove a persistent device-specific bias.

## Initialization decision

BodyCast uses the median of recent valid BIA percentage observations. Median is
a simple robust location statistic with a 50% breakdown point: a single extreme
reading cannot dominate a set containing a majority of consistent readings.
The accompanying spread is the unscaled median absolute deviation (MAD), in
body-fat percentage points:

```text
estimate = median(bodyFatPercent observations)
spread = median(abs(observation - estimate))
```

MAD is descriptive measurement dispersion, not a clinical confidence score and
not a correction for systematic bias. With one observation MAD is zero only
because dispersion is unobservable; it does not imply certainty.

No valid observation returns `null`. BodyCast does not use a BMI/age/sex
anthropometric fallback because such equations add population-level model error
and would present a weak estimate as person-specific knowledge.

One observation is sufficient for a provisional initialization while retaining
`observationCount = 1`. Prefer at least three standardized observations. The
model intentionally does not invent qualitative labels such as low/high
confidence.

## Recency and weight-pairing recommendation

The application layer should use the pure selector to obtain up to the last
seven complete, valid weight/BIA pairs within the 14 calendar days preceding an
explicitly supplied reference date.
This is a transparent engineering default, not a clinically validated cutoff:
the short calendar window limits contamination by real composition change,
while up to seven values give the median useful robustness. The selection policy
remains separate from the estimator and does not consult the system clock. Both
limits are overridable inputs rather than hidden constraints.

Use the same scale/device and software version under repeatable conditions,
ideally at a similar time of day, before food and strenuous exercise, after
normal hydration and bladder emptying. For initialization weight, use the median
of weights recorded alongside those same selected BIA observations. Do not pair
an old BIA estimate with a substantially different current weight.

## Initial state equations

Given a paired robust weight and the median BIA estimate:

```text
fatFraction = estimatedBodyFatPercent / 100
observedFatMassKg = weightKg * fatFraction
observedFatFreeMassKg = weightKg - observedFatMassKg
```

Raw BIA aggregation accepts 0% and 100% as mathematical observation boundaries
so storage/diagnostics can preserve device output without imposing an arbitrary
clinical range. Latent-state initialization is intentionally stricter and
requires `0 < estimatedBodyFatPercent < 100`: both observed fat mass and FFM must be
strictly positive, and the resulting fat mass must be consumable by the
downstream Forbes/Hall partition model.

New daily BIA observations must **never directly overwrite** latent fat mass or
lean tissue. Observed FFM includes glycogen and fluid compartments and is not a
latent Hall lean-tissue state. A later observation model may use BIA as noisy
evidence for state updating or validation. That filtering/update mechanism is
out of scope for this phase.

## Sources

- Prado et al., *Methodological standards for body composition assessment—an
  expert-endorsed guide*, [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13197919/).
- Gagnon et al., *Accuracy of Smart Scales on Weight and Body Composition*,
  [JMIR / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8122302/).
- Bosy-Westphal et al., *Accuracy of Bioelectrical Impedance Consumer Devices*,
  [Obesity Facts / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6452160/).
- Looney et al., *Reliability, biological variability, and accuracy of
  multi-frequency BIA*, [PubMed](https://pubmed.ncbi.nlm.nih.gov/39691170/).
- Gualdi-Russo and Toselli, *Influence of various factors on the measurement of
  multifrequency bioimpedance*, [PubMed](https://pubmed.ncbi.nlm.nih.gov/12365353/).
- Slinde and Rossander-Hulthén, *Bioelectrical impedance: effect of 3 identical
  meals on diurnal impedance variation*,
  [PubMed](https://pubmed.ncbi.nlm.nih.gov/11566645/).
- Thompson et al., *Effects of hydration and dehydration on body composition
  analysis*, [PubMed](https://pubmed.ncbi.nlm.nih.gov/1806735/).
