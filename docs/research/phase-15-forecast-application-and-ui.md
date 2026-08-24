# Phase 15 — Forecast application, API, and interface

## Product decision

The forecast screen presents one visually dominant median line, a darker 25–75% band, and a lighter 5–95% band. Exact endpoint values accompany the chart. The copy consistently calls these intervals “model paths” or “ranges,” never promises, confidence scores, or guaranteed outcomes.

The default scenario resamples connected blocks of reliable recent behavior. An exact-plan mode intentionally suppresses future-adherence variation, while a flexible-plan mode varies behavior around user-entered targets. This distinction stays visible next to the selector and in the assumptions panel.

## Evidence reviewed

- Kay et al., *When(ish) is My Bus?* (CHI 2016): discrete quantile displays improved mobile probability judgments and reduced response variance. This supported showing nested, directly interpretable probability ranges rather than a decorative gradient alone: <https://www.hullmanlab.northwestern.edu/paper%20discrete-outcome/2016/01/01/when-ish-is-my-bus.html>
- Fernandes et al., *Uncertainty Displays Using Quantile Dotplots or CDFs Improve Transit Decision-Making* (CHI 2018): explicit distribution encodings improved decisions over conventional interval displays. BodyCast retains exact range text and a clear legend so the band is not the only explanation: <https://idl.uw.edu/papers/uncertainty-bus>
- Correll and Gleicher, *Error Bars Considered Harmful*: conventional intervals invite categorical inside/outside readings and hide distribution shape. The UI therefore labels both intervals with their probability mass and avoids calling either a binary safe zone: <https://pmc.ncbi.nlm.nih.gov/articles/PMC6214189/>
- Han et al., *Laypersons’ responses to the communication of uncertainty regarding cancer risk estimates*: a best estimate plus a simple visual range reduced variability in interpretation. This informed the summary-card pairing of median and numeric ranges: <https://pubmed.ncbi.nlm.nih.gov/25808952/>
- Zipkin et al., systematic review of verbal and numeric risk communication: verbal-only descriptions tend to be interpreted inconsistently, so every “likely” label is paired with numbers: <https://pmc.ncbi.nlm.nih.gov/articles/PMC4153005/>
- Nadav-Greenberg et al., predictive intervals in weather forecasts: predictive intervals can improve trust and decisions when their meaning is made explicit: <https://journals.ametsoc.org/view/journals/wcas/5/2/wcas-d-12-00007_1.xml>
- Bank of England, *Anchors aweigh?* (2026): recent experimental evidence favors fan-chart-style communication for conveying expectation and uncertainty jointly: <https://www.bankofengland.co.uk/working-paper/2026/anchors-aweigh-the-effect-of-communicating-forecast-uncertainty>

## Application flow

1. Opening `/forecast` automatically runs a 30-day recent-routine forecast.
2. Users can select 7, 30, 90, 180, or 365 days and rerun explicitly.
3. Manual scenarios accept nutrition, non-work walking, strength frequency and duration, and an optional Monday–Friday occupation plan including shift duration, breaks, walking, and speed.
4. Strength days use a deterministic spread (Monday, Wednesday, Friday first, then Tuesday, Thursday, Saturday, Sunday) so the form is reproducible and testable.
5. Calendar generation uses date-only UTC arithmetic, while “today” is resolved in `Europe/Bratislava`; DST transitions cannot skip or duplicate a forecast date.

## State and failure semantics

- `deterministic`: forecast ready.
- `recovered`: current state reconstructed; gap uncertainty is included.
- `degraded`: sparse evidence was replaced with conservative engineering assumptions.
- `awaiting`: no chart; users are directed to add observations or update the model.
- `degenerate`: no chart; recovery is the primary action.
- limited long horizon: the result remains visible with an explicit numerical-quality warning.
- insufficient recent donors: the UI explains that the evidence-driven scenario cannot run and offers the flexible manual scenario.

Requests use an abort controller plus a monotonically increasing request identifier. A slower, older response cannot overwrite a newer scenario. The UI-facing route delegates directly to the same forecast service and schema as the authenticated external model API; no forecasting logic is duplicated in the browser.

## Known uncertainty boundary

The bands include initial-state uncertainty when recovery produced a posterior and future-behavior uncertainty when the selected scenario supports it. They currently exclude measurement noise and model-parameter uncertainty. The chart note and assumptions panel disclose that boundary. Phase 15 does not add a goal-seeking or inverse-planning solver.
