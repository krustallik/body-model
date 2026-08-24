# Occupational activity energy model audit (Phase 13.1A)

## Question and prior behavior

BodyCast records a clock-time `WorkInterval`, reconstructs cumulative steps and
distance at its boundaries, and stores one category. The prior calculation used
the category's task MET for every interval hour:

```text
gross work = task MET * current body weight (kg) * interval hours
net work = gross work - current dynamic RMR / 24 * interval hours
```

Work distance was subtracted from daily distance, preventing outside-work
walking double counting, but it did not otherwise affect occupational kcal. The
concern arose when a heterogeneous eight-hour shift with about 12.9 km and
17,883 steps was represented as eight continuous hours of packing at 3.3 MET.

## Evidence reviewed

- Herrmann et al., *2024 Adult Compendium of Physical Activities: A third
  update of the energy costs of human activities*, J Sport Health Sci 2024,
  DOI 10.1016/j.jshs.2023.10.010
  ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10818145/)). The Compendium
  standardizes activity codes for questionnaires and multiplies a specific
  activity's MET by the duration that activity was reported. It explicitly
  warns that standard METs are a starting point, not precise individual EE.
- [2024 Compendium occupation table](https://pacompendium.com/occupation/):
  11600 standing light 1.8; 11475 general light manual 2.8; 11610 standing
  light/moderate including stocking/packing 3.3; 11476 general moderate manual
  4.5; 11791–11810 work walking (including light loads); 11860 warehouse
  loading/unloading boxes 2.3; 11862 warehouse moving about 5 kg boxes 4.3.
  Code 11490 uniquely says heavy moving is "only active time"; that qualifier
  makes the active-time limitation explicit, but its absence does not turn
  other task observations into full-shift averages.
- Byrne et al., *Metabolic equivalent: one size does not fit all*, J Appl
  Physiol 2005 ([PubMed](https://pubmed.ncbi.nlm.nih.gov/15831804/)). The
  conventional 1 kcal/kg/h rest value differs systematically from measured RMR;
  individual correction improves interpretation.
- [Compendium corrected-MET guidance](https://pacompendium.com/corrected-mets/)
  and Kozey et al., *Errors in MET estimates of physical activities using
  3.5 ml/kg/min as the baseline oxygen consumption*, J Phys Act Health 2010.
  Corrected relative MET changes the denominator; it does not change the
  activity's absolute standard-MET oxygen cost.
- Hills et al., *Assessment of physical activity and energy expenditure: an
  overview of objective measures* ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4428382/)).
  The Compendium was designed primarily for classification and population
  research rather than precise individual activity EE.
- Fukushima et al., manufacturing workers
  ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5985348/)): even blue-collar
  work time was heterogeneous (sedentary, light, and moderate/vigorous states),
  rather than one continuous task intensity.
- Chappel et al., nurses over 6.7–12.5 h shifts
  ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7932232/)): energy rate varied
  through shifts and strongly between people. This supports shift-average
  measurement when available; it does not validate assigning one observed task
  MET to all clock time.
- Hall et al. NIDDK body-weight model
  ([appendix](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf))
  preserves explicit RMR and activity accounting. It does not provide a
  warehouse task decomposition or a replacement occupational constant.

## Answers to the audit questions

### Meaning and long-duration use

A Compendium MET is the average rate while the described activity is being
performed for the reported duration. A broad "general" occupation code may be
used as a rough self-report category, but the table does not establish that a
specific packing, walking-with-load, or lifting rate is the mean of any user's
entire 8–12 hour shift. Full shifts contain walking, standing, handling, waiting,
pauses, and sometimes sitting. Applying a task MET to every clock hour is only
valid when the user truly means that it was the interval-average intensity.

### Available walking information

BodyCast has immutable cumulative distance and step snapshots. It reconstructs
each interval boundary by exact match, interpolation, or nearest snapshot under
the existing 45-minute maximum gap. It has no timestamped walking bouts, no
work-specific pace, no heart rate, no processed accelerometer intensity, and no
load weights. `averageWalkingSpeedKmh` is a daily aggregate. Therefore:

- distance is useful directly;
- steps remain diagnostic and are never converted with kcal/step;
- daily-average speed may be used only as a labeled duration proxy;
- the model cannot determine what fraction of walking carried a box.

### Simultaneous activity

Adding full work MET plus work walking is invalid because their clock time
overlaps. Assigning a loaded-walking MET also requires load and loaded-walking
duration that BodyCast does not have. The chosen model partitions time into
mutually exclusive walking and non-walking states. Occasional carrying during
walking remains unmodeled uncertainty; it is not fabricated as a second full
manual-work term.

### MET and resting accounting

Standard MET is an absolute mass-normalized convention. Thus
`standard MET * kg * h` estimates gross kcal. Subtracting the person's dynamic
RMR for exactly the same duration produces net-above-personal-rest activity and
prevents RMR being counted twice in TDEE. This is dimensionally coherent.

Algebraically, a corrected relative MET equals the standard absolute activity
rate divided by personal RMR. Multiplying that corrected MET back by personal
RMR recovers the same gross activity rate. BodyCast therefore keeps the current
gross standard-MET calculation and personal dynamic-RMR subtraction. It does
not multiply a standard MET directly by personal RMR as though the standard MET
were already a personal ratio.

## Design alternatives

| Option | Evidence and bias | Overlap/data behavior | Decision |
| --- | --- | --- | --- |
| One task MET for the whole interval | Simple, but can overstate intermittent tasks and ignores known distance | No walking double count only because work walking is discarded from kcal | Rejected as primary |
| Walking plus residual non-walking work | Uses available distance; mutually exclusive time states are explainable | Needs a speed proxy; carrying overlap remains uncertain | Chosen |
| New whole-shift categories | Robust when walking reconstruction is absent, but literature does not supply universal shift-average values for these jobs | Cannot make known 12.9 km influence the result | Used only as labeled fallback |
| Loaded-walking/task diary or sensor model | Potentially stronger with load duration, work pace, HR, or accelerometry | Required information is absent; UI complexity is high | Rejected for this phase |

## Chosen algorithm

For interval `i`, with duration `H_i`, reconstructed distance `D_i`, daily
average speed proxy `V`, current predicted weight `W`, and dynamic RMR `R`:

```text
walkingHours_i = D_i / V
residualHours_i = H_i - walkingHours_i

net(grossMET, hours) = grossMET * W * hours - R / 24 * hours

workWalking_i = net(walkingMET(V), walkingHours_i)
residualWork_i = net(categoryResidualMET, residualHours_i)
work_i = workWalking_i + residualWork_i
```

The existing Compendium level-walking speed bands select `walkingMET(V)`. The
daily-average speed is not relabeled as work speed. A one-second tolerance
(`WALKING_DURATION_TOLERANCE_HOURS = 1/3600`) absorbs only floating-point and
boundary rounding. A larger implied-duration excess triggers fallback rather
than clamping or inventing a speed.

Categories now describe the non-walking remainder:

| Stored identifier | UI meaning | Residual MET/code | Category fallback MET/code |
| --- | --- | --- | --- |
| `standingLight` | light standing/waiting/hand tasks | 1.8 / 11600 | 1.8 / 11600 |
| `manualLight` | light handling/loading/unloading boxes | 2.3 / 11860 | 2.8 / 11475 |
| `standingLightModerate` | frequent active light manual work | 2.8 / 11475 | 3.3 / 11610 |
| `manualModerate` | sustained moderate manual work | 4.5 / 11476 | 4.5 / 11476 |

The residual values are literature-derived Compendium task rates. Mapping the
stable stored identifiers to the clarified meanings, using daily speed as a
duration proxy, and the one-second tolerance are engineering decisions.

### Double-counting proof

```text
work interval = walkingHours + residualHours
daily distance = work distance + outside-work distance

Activity = workWalking + residualWork
         + outsideWorkWalking
         + strength
```

`workWalking` consumes only work distance and its allocated time.
`outsideWorkWalking` consumes only `daily - work` distance. Residual work uses
only `interval - walking` time. Therefore work walking appears exactly once.

## Missing and fallback policy

| Case | Behavior |
| --- | --- |
| Reliable work distance and usable daily speed | Hybrid walking + residual estimate; boundary provenance remains available |
| Work interval but distance unavailable | Category-only estimate, reason `work-walking-unavailable`; daily total remains unavailable if outside distance cannot be separated |
| Counter decreases | Reconstruction remains `counter-decreased`; category fallback is labeled; no negative clamp |
| Boundary gap exceeds policy | Reconstruction remains `gap-too-large`; category fallback is labeled |
| Daily distance but no boundaries | No fabricated work/outside split; category fallback only and complete daily Activity is unavailable |
| Explicit zero work distance | Hybrid with zero walking hours and the entire interval as residual; no speed required |
| Positive distance but speed unavailable | Category fallback, reason `walking-speed-unavailable` |
| Implied walking time exceeds available active work | Category fallback, reason `walking-duration-exceeds-active-work-time` (Phase 13.1B) |
| No WorkInterval | No occupational term; all known daily walking remains outside work |

The UI diagnostics return method, distance, speed proxy, walking/residual hours,
both kcal components, total, and fallback reason. Historical `sourceQuality`
retains reconstruction results and issues; model version makes the equation set
auditable without new database columns.

## Breaks and user interpretation

This Phase 13.1A note originally treated the interval as clock time and advised
splitting around substantial breaks. Phase 13.1B supersedes that UX decision
with an explicit nullable break duration after a dedicated evidence review; see
[`work-breaks-and-occupational-ux.md`](work-breaks-and-occupational-ux.md).
The walking-plus-residual partition now uses active work time (`clock - break`),
while historical null breaks preserve the Phase 13.1A calculation and carry
`legacy-unreported` provenance.

For “on my feet, walked much of the shift, and periodically moved light boxes,
but no heavy lifting,” select **Light handling or boxes**. Do not select moderate
manual work merely because some boxes were moved. Carrying during some walking
is a limitation, not a hidden second calorie term.

## History, calibration, and limitations

Phase 13.1A changed the centralized version to `bodycast-physiology-v2`.
Phase 13.1B advances it to `bodycast-physiology-v3`; recalculation still
atomically rebuilds the complete history, refits the existing calibration from
defaults, and persists all daily rows under one version. Frozen initialization
and nutrition baseline remain unchanged.

This remains a deterministic estimate, not measured expenditure. Expected error
can be material because work pace is approximated by daily pace, category
selection is self-report, normal pauses are not measured, load and grade are
unknown, and individual activity cost varies. The algorithm deliberately avoids
false precision, Apple Active Energy as a primary source, kcal/step, heart-rate
inference, and new fitted physiological parameters.
