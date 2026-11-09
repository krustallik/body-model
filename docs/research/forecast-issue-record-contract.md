# Forecast issue record contract (proposal)

**Status: proposed; persistence is not implemented.** BodyCast currently has no immutable, as-issued forecast store. Historical replay is counterfactual and must not be described as the accuracy of a forecast users saw.

## Minimal record

When a separate schema and data-lifecycle decision authorizes persistence, append one record for each forecast result shown to the user:

- opaque issue ID and owning `profileId`;
- server `issuedAt` timestamp and model-local forecast origin date;
- target dates and requested horizon;
- scenario mode and a fingerprint of the exact normalized request;
- source fingerprint, model/algorithm versions, currentness generation, and recovery version if used;
- exact displayed point estimate and quantiles for each forecast date and metric, including interval semantics;
- record format version.

The record is insert-only. Re-running a scenario creates a new issue record; it never overwrites an earlier result. Do not store raw Health or Training inputs in the record when versioned fingerprints and exact issued outputs are sufficient for evaluation.

## Evaluation

After the target date, a separate append-only evaluation associates the issue ID with the first eligible observed weight available under the existing weight-observation contract. Preserve observation date, ingestion timestamp, source provenance, and the issue's original horizon. A later measurement or correction appends a new evaluation revision instead of mutating the forecast or prior evaluation. Exclude pairs whose target measurement is absent; absence is not a miss or a zero.

## Required decision before a production migration

Owner/product review must decide retention and deletion behavior, user export/deletion semantics, evaluation timing, and whether each forecast mode is recorded. Then add the smallest profile-owned table(s), test tenant isolation and append-only behavior on isolated PostgreSQL, and rehearse migration/rollback. No production migration, backfill, or capture was introduced by this task.
