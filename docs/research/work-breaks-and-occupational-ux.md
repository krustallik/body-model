# Work breaks and occupational activity UX (Phase 13.1B)

## Scope and accounting question

BodyCast already partitions a work interval into detected walking and the
selected non-walking work category. Phase 13.1B adds an explicit break duration
without changing measured work distance and without counting the same clock
time twice.

The important distinction is between total bodily expenditure and BodyCast's
occupational **net-above-rest** activity term. A seated break does not mean that
the body expends zero energy. Dynamic RMR continues to cover every hour of the
day, and TEF remains a separate daily component. The break contributes zero
additional occupational activity so that resting expenditure is not added a
second time.

## Evidence reviewed

- Herrmann et al., *2024 Adult Compendium of Physical Activities: A third
  update of the energy costs of human activities*, J Sport Health Sci 2024
  ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10818145/)). The Compendium is
  a standardized activity-classification resource; standard MET values are
  population estimates rather than individual calorimetry.
- [2024 Compendium inactivity table](https://pacompendium.com/inactivity/):
  sitting quietly/general is 1.0 MET (07021), standing quietly is 1.3 MET, and
  sitting while fidgeting is 1.5 MET. Break behavior can therefore differ, but
  quiet sitting is approximately the conventional resting reference.
- Newton et al., whole-room calorimetry of sedentary behaviors
  ([PubMed](https://pubmed.ncbi.nlm.nih.gov/23658805/)): seated reading, typing,
  and television were about 1.03–1.06 MET in that protocol.
- Mansoubi et al., indirect calorimetry of common sitting and standing tasks
  ([PubMed](https://pubmed.ncbi.nlm.nih.gov/26021449/)): task and posture affect
  observed sedentary rates, illustrating why an unobserved break should not be
  assigned a fabricated universal activity increment.
- Bailey and Locke, alternating sitting and standing at work
  ([PubMed](https://pubmed.ncbi.nlm.nih.gov/25872228/)): standing increased
  expenditure only modestly relative to sitting in that protocol. A user-entered
  break duration is more defensible than guessing its posture or activity.
- Westerterp, physical activity and energy expenditure
  ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC5081410/)), and Levine,
  non-exercise activity thermogenesis
  ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC524030/)): total expenditure
  separates basal/resting metabolism, thermic effect of food, and activity.
  This supports keeping break handling inside the activity component only.
- The Occupational Sitting and Physical Activity Questionnaire distinguishes
  sitting, standing, walking, and heavy labor at work
  ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7339490/)). Occupational time
  is heterogeneous; one task label is not a direct measurement of every minute.

## Options considered

| Option | Consequence | Decision |
| --- | --- | --- |
| Treat break as 0 kcal in total expenditure | Incorrectly removes resting metabolism and conflicts with the component model | Rejected |
| Assign every break 1.0 MET, then subtract personal RMR | Numerically close to zero net activity for some users, but still invents posture and mixes standard-MET and personal-rest assumptions | Rejected |
| Exclude break only from occupational activity | RMR still covers the time; TEF remains separate; no guessed break behavior | Chosen |
| Infer breaks automatically from steps | A low-step period can be standing, driving equipment, waiting, or handling in place; timestamps are insufficient | Rejected |

The chosen behavior is an engineering simplification, not a claim that all
breaks are motionless. It is transparent and conservative given the available
data.

## Chosen equations and invariants

For clock duration `H`, explicit break duration `B`, reconstructed work distance
`D`, speed proxy `V`, and selected residual work category:

```text
activeWorkHours = H - B
walkingHours = D / V
residualWorkHours = activeWorkHours - walkingHours

occupationalActivity = netWalking(D, V, walkingHours)
                     + netCategory(category, residualWorkHours)
```

Break duration does not reduce or reassign distance. Walking remains derived
from the cumulative distance snapshots and daily average walking-speed proxy;
it is never entered manually. The required invariant is:

```text
walkingHours + breakHours <= clockHours
```

An excess larger than the existing one-second numeric tolerance produces an
explicit category-only fallback with diagnostic
`walking-duration-exceeds-active-work-time`. The fallback applies the selected
category only to active work time, never to the break. No hidden clamp, negative
residual duration, or second walking component is allowed.

Break minutes are whole minutes, must be non-negative, and must be strictly less
than the interval duration. Zero is a valid explicit value. Whole minutes match
the clock UI and avoid implying second-level recall accuracy.

## Legacy compatibility and provenance

The database column is nullable. A historical `null` means
`legacy-unreported`, not 0 minutes and not the new 30-minute UI default. For
such an interval, BodyCast keeps the pre-13.1B calculation exactly: the complete
clock interval remains available to walking plus residual work. Diagnostics and
API output expose the legacy provenance so the compatibility behavior cannot be
mistaken for a user-reported zero break.

New intervals require an explicit break value. The editor defaults a new entry
to 30 minutes as a convenience only; this is not a scientific prior and is not
backfilled into existing rows. Editing a legacy interval preserves `null` until
the user enters a value. Once entered, 0 means the user explicitly reported no
break.

The migration adds the nullable column without a default, so existing rows stay
null on both populated and clean PostgreSQL databases. Database and application
validation enforce the same range invariant.

## UX model

The editor asks for one residual-work category: what best describes work
**between detected walking and the entered break**. Categories use examples and
qualitative intensity rather than exposing MET values:

| Category | Examples and boundary |
| --- | --- |
| Very light / mostly waiting | Supervising, scanning, checking, light hand tasks, little lifting |
| Light handling / packing | Packing, sorting, shelving light items, occasional light boxes |
| Active light manual work | Frequent stocking and more continuous whole-body light work |
| Moderate handling | Repeated lifting, pushing, or pulling moderately heavy items |

The summary card shows a clock-time flow: total shift, reported break, detected
walking distance and implied walking time, then remaining category time. It also
shows `Not reported (legacy)` where appropriate. This makes subtraction visible
without asking users to understand MET arithmetic.

No manual walking-duration selector is added. BodyCast already has a defensible
distance-derived walking path; a second user control would create contradictory
inputs and unclear precedence. When reconstruction is unavailable, the existing
labeled category-only fallback is safer than a fabricated split. A future
manual walking input would require a separate provenance type, conflict rules,
and evidence that users can report it reliably.

## Versioning and limitations

The equation semantics advance the centralized model version to
`bodycast-physiology-v3`. Episode recalculation therefore rebuilds the full
history under one equation set rather than mixing v2 and v3 daily rows.
Historical null-break rows remain numerically compatible, while explicit-break
rows use active-work time.

The model does not know break posture, meal thermogenesis timing, whether a
walking segment carried a load, or work-specific walking pace. Category choice,
break duration, daily speed proxy, and boundary reconstruction remain sources of
uncertainty. The UI default is convenience copy, not evidence that every shift
contains a 30-minute break.
