# MS100 bracketed-step validation procedure

This procedure validates whether a health-sync step-counter delta is a useful
source proxy for this user's fixed MS100 setup. It does not calibrate energy,
mechanical work, cadence, or physiology.

For 3–5 future MS100 workouts:

1. Trigger a manual health sync immediately before the workout. If practical,
   note the MS100 displayed repetition/count value.
2. Complete the workout without changing the usual machine configuration.
3. Trigger another manual health sync immediately afterwards and, if practical,
   note the displayed MS100 repetition/count value again.
4. Inspect the developer `WorkoutStepperEvidenceV7` diagnostic. Record the
   before/after effective snapshot timestamps, their pre/post gaps, and the
   `derivedStepDelta` with provenance `bracketed-health-step-delta`.
5. Compare the MS100 displayed count change with `derivedStepDelta`.

The delta is a bracketed health-counter attribution and can include ordinary
walking in the preserved pre/post gaps. Do not derive a correction coefficient,
quality cutoff, cadence zone, or calorie estimate from these comparisons.
