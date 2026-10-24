#!/usr/bin/env bash

# Read-only inspector for the production checkout, fixed runtime, and public
# maintenance state. Inputs are provided by the fixed GitHub workflow over SSH
# stdin; secret values, arbitrary paths, and response bodies are never emitted.
set -uo pipefail
export LC_ALL=C
export GIT_OPTIONAL_LOCKS=0
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR \
  GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_PARAMETERS

emit() {
  printf '%s=%s\n' "$1" "$2"
}

bool() {
  if [[ "$1" == 1 ]]; then printf 'yes'; else printf 'no'; fi
}

count_nul_records() {
  local count=0 record
  while IFS= read -r -d '' record; do
    count=$((count + 1))
  done
  printf '%s' "$count"
}

safe_path_sample() {
  local count=0 path='' lower_path='' safe_path=''
  while IFS= read -r -d '' path; do
    if (( count < 20 )); then
      if (( count > 0 )); then printf ';'; fi
      lower_path="${path,,}"
      case "$lower_path" in
        .*|*/.*|*secret*|*credential*|*password*|*token*|*private*|*config*|*runtime*|*backup*|*.pem|*.key|*.crt|*.p12|*.pfx|*.sql|*.dump|*.db|*.sqlite|*.env|*.env.*)
          safe_path='[redacted]'
          ;;
        *)
          safe_path="${path//[^A-Za-z0-9._\/+@-]/?}"
          ;;
      esac
      printf '%s' "$safe_path"
    fi
    count=$((count + 1))
  done
  if (( count == 0 )); then printf 'none'; elif (( count > 20 )); then printf ';[additional paths omitted]'; fi
}

read_only_energy_diagnostic_inventory() {
  local server_ip inventory shadow_payload_b64
  server_ip="$(docker inspect --format '{{ with index .NetworkSettings.Networks "bodycast-backend-prod" }}{{.IPAddress}}{{end}}' bodycast-db-prod 2>/dev/null)" || return 1
  [[ "$server_ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  inventory="$(docker exec --interactive bodycast-db-prod bash -s -- "$server_ip" 2>/dev/null <<'BASH'
set -Eeuo pipefail
server_ip="$1"
[[ "${POSTGRES_USER:-}" == "bodycast" && -n "${POSTGRES_PASSWORD:-}" ]] || exit 1
[[ "$POSTGRES_PASSWORD" != *$'\n'* && "$POSTGRES_PASSWORD" != *$'\r'* ]] || exit 1
umask 077
passfile="$(mktemp /tmp/bodycast-checkout-diagnostic.XXXXXX)"
error_file="$(mktemp /tmp/bodycast-checkout-diagnostic-error.XXXXXX)"
trap 'rm -f -- "$passfile" "$error_file"' EXIT
chmod 600 "$passfile"
escaped_password="${POSTGRES_PASSWORD//\\/\\\\}"
escaped_password="${escaped_password//:/\\:}"
printf '%s:%s:%s:%s:%s\n' "$server_ip" 5432 bodycast "$POSTGRES_USER" "$escaped_password" > "$passfile"
query="$(cat <<'SQL'
WITH eligible_aliases AS (
  SELECT e."id" AS event_id, e."occurrenceAt" AS event_occurrence_at,
    a."sourceType", w."id" AS workout_id, w."supersededByWorkoutId", w."type"
  FROM "ActiveEnergyEventAlias" AS a
  JOIN "ActiveEnergyCanonicalEvent" AS e ON e."id" = a."eventId"
  JOIN "Workout" AS w ON w."id" = a."workoutId"
  WHERE a."profileId" = 1
    AND a."sourceType" IN ('workout', 'strength-session')
    AND a."workoutId" IS NOT NULL
    AND w."hiddenFromHistory" = false
    AND e."isStale" = false
    AND e."supersededByEventId" IS NULL
    AND e."currentSource" IS NOT NULL
    AND e."currentSource" <> 'unavailable'
    AND e."currentKcal" IS NOT NULL
    AND e."currentKcal" >= 0
    AND e."currentKcal"::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND e."currentResolutionFingerprint" ~ '^[a-f0-9]{64}$'
), current_events AS (
  SELECT event_id, min(event_occurrence_at) AS event_occurrence_at,
    bool_or("supersededByWorkoutId" IS NOT NULL) AS has_superseded_workout,
    bool_or("supersededByWorkoutId" IS NULL) AS has_current_workout,
    bool_or(lower(btrim("type")) = 'stair climbing') AS has_stair_climbing_workout,
    bool_or(lower(btrim("type")) = 'traditional strength training') AS has_strength_training_workout,
    bool_or("sourceType" = 'workout') AS has_workout_source_alias,
    bool_or("sourceType" = 'strength-session') AS has_strength_session_source_alias
  FROM eligible_aliases
  GROUP BY event_id
), target_strength_session_candidates AS (
  SELECT "status", "entryMode", "matchedWorkoutId", "accountingTimeZone",
    "effectiveAccountingAt", "webStartedAt",
    COALESCE("effectiveAccountingAt", "webStartedAt") AS session_instant,
    (
      ("effectiveAccountingAt" >= TIMESTAMPTZ '2026-10-21 00:00:00+00'
        AND "effectiveAccountingAt" < TIMESTAMPTZ '2026-10-24 00:00:00+00')
      OR ("effectiveAccountingAt" IS NULL
        AND "webStartedAt" >= TIMESTAMPTZ '2026-10-21 00:00:00+00'
        AND "webStartedAt" < TIMESTAMPTZ '2026-10-24 00:00:00+00')
    ) AS is_in_acceptance_utc_window
  FROM "StrengthDiarySession"
  WHERE "profileId" = 1
), target_strength_session_localized AS (
  SELECT *,
    CASE WHEN is_in_acceptance_utc_window AND "accountingTimeZone" IS NOT NULL AND session_instant IS NOT NULL THEN
      to_char(session_instant AT TIME ZONE "accountingTimeZone", 'YYYY-MM-DD HH24:MI') = '2026-10-22 14:40'
    ELSE false END AS is_target_local_minute,
    CASE WHEN is_in_acceptance_utc_window AND "accountingTimeZone" IS NOT NULL AND "effectiveAccountingAt" IS NOT NULL THEN
      to_char("effectiveAccountingAt" AT TIME ZONE "accountingTimeZone", 'YYYY-MM-DD HH24:MI') = '2026-10-22 14:40'
    ELSE false END AS is_effective_target_local_minute,
    CASE WHEN is_in_acceptance_utc_window AND "accountingTimeZone" IS NOT NULL AND "webStartedAt" IS NOT NULL THEN
      to_char("webStartedAt" AT TIME ZONE "accountingTimeZone", 'YYYY-MM-DD HH24:MI') = '2026-10-22 14:40'
    ELSE false END AS is_web_started_target_local_minute,
    CASE WHEN is_in_acceptance_utc_window AND "accountingTimeZone" IS NOT NULL THEN
      TIMESTAMP '2026-10-22 00:00:00' AT TIME ZONE "accountingTimeZone"
    ELSE NULL END AS local_day_start
  FROM target_strength_session_candidates
), target_strength_session_day AS (
  SELECT
    count(*) FILTER (WHERE is_in_acceptance_utc_window) AS target_utc_window_matches,
    count(*) FILTER (WHERE is_in_acceptance_utc_window AND "accountingTimeZone" IS NULL) AS target_utc_window_missing_timezone,
    count(*) FILTER (WHERE is_in_acceptance_utc_window AND "status" = 'COMPLETED') AS target_completed_matches,
    count(*) FILTER (WHERE is_in_acceptance_utc_window AND "status" = 'COMPLETED'
      AND "entryMode" = 'LIVE') AS target_live_matches,
    count(*) FILTER (WHERE is_in_acceptance_utc_window AND "status" = 'COMPLETED'
      AND "entryMode" = 'LIVE' AND "matchedWorkoutId" IS NULL) AS target_unmatched_candidates,
    count(*) FILTER (WHERE is_in_acceptance_utc_window AND is_target_local_minute) AS target_local_minute_matches,
    count(*) FILTER (WHERE is_in_acceptance_utc_window AND is_effective_target_local_minute) AS target_effective_local_minute_matches,
    count(*) FILTER (WHERE is_in_acceptance_utc_window AND is_web_started_target_local_minute) AS target_web_started_local_minute_matches,
    count(*) FILTER (WHERE is_in_acceptance_utc_window AND is_target_local_minute
      AND "status" = 'COMPLETED' AND "entryMode" = 'LIVE' AND "matchedWorkoutId" IS NULL) AS target_session_matches,
    min(local_day_start) FILTER (WHERE is_in_acceptance_utc_window AND is_target_local_minute
      AND "status" = 'COMPLETED' AND "entryMode" = 'LIVE' AND "matchedWorkoutId" IS NULL) AS local_day_start
  FROM target_strength_session_localized
), target_workout_56 AS (
  SELECT w."id", w."type", w."hiddenFromHistory", w."activeEnergyKcal",
    w."manualActiveEnergyKcal",
    CASE WHEN lower(btrim(w."type")) = 'traditional strength training' THEN 'strength'
      WHEN lower(btrim(w."type")) = 'stair climbing' THEN 'stepper' ELSE 'other' END AS expected_kind
  FROM "Workout" AS w
  WHERE w."id" = 56
), target_workout_56_reconciliation AS (
  SELECT c."id" AS candidate_id, c."groupId", c."manualWorkoutId", c."garminWorkoutId",
    g."status", g."provisionalWorkoutId"
  FROM "StepperReconciliationCandidate" AS c
  JOIN "StepperReconciliationGroup" AS g ON g."id" = c."groupId"
  WHERE (c."manualWorkoutId" = 56 OR c."garminWorkoutId" = 56)
    AND g."status" IN ('pending', 'ambiguous', 'confirmed')
  ORDER BY c."groupId", c."id"
  LIMIT 1
), target_workout_56_reconciliation_pairs AS (
  SELECT c."manualWorkoutId", c."garminWorkoutId", c."candidateStatus"
  FROM "StepperReconciliationCandidate" AS c
  JOIN target_workout_56_reconciliation AS r ON r."groupId" = c."groupId"
  WHERE r."status" = 'ambiguous'
    OR (r."status" = 'confirmed' AND c."candidateStatus" = 'confirmed')
    OR (r."status" = 'pending' AND c."candidateStatus" = 'pending')
), target_workout_56_reconciliation_member_ids AS (
  SELECT "manualWorkoutId" AS "id" FROM target_workout_56_reconciliation_pairs
  UNION
  SELECT "garminWorkoutId" AS "id" FROM target_workout_56_reconciliation_pairs
), target_workout_56_representative AS (
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target_workout_56_reconciliation) THEN 56
    WHEN (SELECT "status" FROM target_workout_56_reconciliation) = 'confirmed' THEN COALESCE(
      (SELECT "garminWorkoutId" FROM target_workout_56_reconciliation_pairs
        WHERE "candidateStatus" = 'confirmed' ORDER BY "manualWorkoutId", "garminWorkoutId" LIMIT 1),
      (SELECT "garminWorkoutId" FROM target_workout_56_reconciliation), 56)
    WHEN (SELECT "status" FROM target_workout_56_reconciliation) = 'pending' THEN COALESCE(
      (SELECT "provisionalWorkoutId" FROM target_workout_56_reconciliation),
      (SELECT "manualWorkoutId" FROM target_workout_56_reconciliation), 56)
    ELSE COALESCE((SELECT min("id") FROM target_workout_56_reconciliation_member_ids), 56)
  END AS "id"
), target_workout_56_events AS (
  SELECT DISTINCT e.*
  FROM target_workout_56 AS w
  JOIN "ActiveEnergyEventAlias" AS a ON a."profileId" = 1 AND a."workoutId" = w."id"
  JOIN "ActiveEnergyCanonicalEvent" AS e ON e."id" = a."eventId"
), target_workout_72 AS (
  SELECT w."id", w."type", w."hiddenFromHistory", w."createdAt", w."activeEnergyKcal",
    w."manualActiveEnergyKcal",
    CASE WHEN lower(btrim(w."type")) = 'traditional strength training' THEN 'strength'
      WHEN lower(btrim(w."type")) = 'stair climbing' THEN 'stepper' ELSE 'other' END AS expected_kind
  FROM "Workout" AS w
  WHERE w."id" = 72
), target_workout_72_events AS (
  SELECT DISTINCT e.*
  FROM target_workout_72 AS w
  JOIN "ActiveEnergyEventAlias" AS a ON a."profileId" = 1 AND a."workoutId" = w."id"
    AND a."sourceType" = 'workout'
  JOIN "ActiveEnergyCanonicalEvent" AS e ON e."id" = a."eventId"
), target_workout_56_canonical_event AS (
  SELECT e."inputFingerprint"
  FROM "ActiveEnergyEventAlias" AS a
  JOIN "ActiveEnergyCanonicalEvent" AS e ON e."id" = a."eventId"
  WHERE a."profileId" = 1 AND a."sourceType" = 'workout' AND a."sourceId" = '56'
)
SELECT count(*),
  count(*) FILTER (WHERE has_superseded_workout),
  count(*) FILTER (WHERE has_current_workout),
  count(*) FILTER (WHERE has_superseded_workout AND has_current_workout),
  count(*) FILTER (WHERE has_stair_climbing_workout),
  count(*) FILTER (WHERE has_strength_training_workout),
  count(*) FILTER (WHERE has_workout_source_alias),
  count(*) FILTER (WHERE has_strength_session_source_alias),
  (SELECT count(DISTINCT workout_id) FROM eligible_aliases),
  (SELECT target_utc_window_matches FROM target_strength_session_day),
  (SELECT target_utc_window_missing_timezone FROM target_strength_session_day),
  (SELECT target_completed_matches FROM target_strength_session_day),
  (SELECT target_live_matches FROM target_strength_session_day),
  (SELECT target_unmatched_candidates FROM target_strength_session_day),
  (SELECT target_local_minute_matches FROM target_strength_session_day),
  (SELECT target_effective_local_minute_matches FROM target_strength_session_day),
  (SELECT target_web_started_local_minute_matches FROM target_strength_session_day),
  (SELECT target_session_matches FROM target_strength_session_day),
  (SELECT count(*) FROM current_events CROSS JOIN target_strength_session_day
    WHERE target_session_matches = 1 AND event_occurrence_at < local_day_start),
  (SELECT count(*) FROM current_events CROSS JOIN target_strength_session_day
    WHERE target_session_matches = 1 AND event_occurrence_at >= local_day_start),
  (SELECT count(*) FROM target_workout_56 WHERE NOT "hiddenFromHistory"),
  (SELECT count(*) FROM target_workout_56 AS w
    JOIN "ActiveEnergyEventAlias" AS a ON a."profileId" = 1 AND a."workoutId" = w."id"),
  (SELECT count(DISTINCT e."id") FROM target_workout_56 AS w
    JOIN "ActiveEnergyEventAlias" AS a ON a."profileId" = 1 AND a."workoutId" = w."id"
    JOIN "ActiveEnergyCanonicalEvent" AS e ON e."id" = a."eventId"),
  (SELECT count(*) FROM target_workout_56 AS w CROSS JOIN target_workout_56_events AS e
    WHERE e."eventKind" = w.expected_kind),
  (SELECT count(*) FROM target_workout_56 AS w CROSS JOIN target_workout_56_events AS e
    WHERE e."logicalEventKey" = 'workout:56'
      OR (w.expected_kind = 'stepper' AND e."logicalEventKey" LIKE 'stepper-reconciliation:%')),
  (SELECT count(*) FROM target_workout_56_events AS e
    WHERE NOT e."isStale" AND e."supersededByEventId" IS NULL
      AND e."currentSource" IS NOT NULL AND e."currentSource" <> 'unavailable'
      AND e."currentKcal" IS NOT NULL AND e."currentKcal" >= 0
      AND e."currentKcal"::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND e."currentResolutionFingerprint" ~ '^[a-f0-9]{64}$'),
  (SELECT count(*) FROM target_workout_56_events AS e
    JOIN "ActiveEnergyResolutionRevision" AS r ON r."eventId" = e."id"
      AND r."revision" = e."resolutionRevision"
      AND r."resolutionFingerprint" = e."currentResolutionFingerprint"
      AND r."source" = e."currentSource"
      AND r."valueKcal" IS NOT DISTINCT FROM e."currentKcal"
      AND r."provenance" = e."currentProvenance"),
  (SELECT count(*) FROM target_workout_56_events AS e
    JOIN "ActiveEnergyCandidate" AS c ON c."eventId" = e."id"
      AND c."source" = e."currentSource"
      AND c."sourceIdentity" = e."currentProvenance"->>'sourceIdentity'
      AND c."sourceFingerprint" = e."currentProvenance"->>'sourceFingerprint'
      AND c."availability" = 'available'
      AND c."valueKcal" IS NOT DISTINCT FROM e."currentKcal"),
  (SELECT count(*) FROM target_workout_56 AS w
    WHERE w."activeEnergyKcal" IS NOT NULL OR w."manualActiveEnergyKcal" IS NOT NULL),
  (SELECT count(*) FROM target_workout_56_events AS e
    JOIN "ActiveEnergyCandidate" AS c ON c."eventId" = e."id"
    WHERE c."availability" = 'available' AND c."valueKcal" IS NOT NULL
      AND c."valueKcal" >= 0 AND c."valueKcal"::text NOT IN ('NaN', 'Infinity', '-Infinity')),
  (SELECT COALESCE(max(CASE e."currentSource"
      WHEN 'manual-kcal' THEN 1 WHEN 'device-kcal' THEN 2
      WHEN 'bodycast-stepper-mechanical' THEN 3
      WHEN 'bodycast-strength-estimate' THEN 4
      WHEN 'bodycast-strength-met-fallback' THEN 5
      WHEN 'unavailable' THEN 0 ELSE 6 END), -1)
    FROM target_workout_56_events AS e),
  (SELECT COALESCE(max(CASE w.expected_kind WHEN 'strength' THEN 1 WHEN 'stepper' THEN 2 ELSE 3 END), -1)
    FROM target_workout_56 AS w),
  (SELECT COALESCE(max(CASE
      WHEN e."currentProvenance"->>'sourceIdentity' = 'stepper-shadow:56' THEN 1
      WHEN e."currentProvenance"->>'sourceIdentity' = 'stepper-manual-steps:56' THEN 2
      WHEN e."currentProvenance"->>'sourceIdentity' LIKE 'stepper-shadow:%' THEN 3
      WHEN e."currentProvenance"->>'sourceIdentity' LIKE 'stepper-manual-steps:%' THEN 4
      WHEN e."currentProvenance"->>'sourceIdentity' LIKE 'strength-session:%' THEN 5
      WHEN e."currentProvenance"->>'sourceIdentity' = 'workout:56:manual' THEN 6
      WHEN e."currentProvenance"->>'sourceIdentity' = 'workout:56:device' THEN 7
      ELSE 8 END), 0)
    FROM target_workout_56_events AS e),
  COALESCE((SELECT replace(replace(encode(convert_to(jsonb_build_object(
      'modelRevision', s."modelRevision",
      'sourceFingerprint', s."sourceFingerprint",
      'result', s."result",
      'canonicalEventInputFingerprint', (SELECT e."inputFingerprint" FROM target_workout_56_canonical_event AS e),
      'reconciliationStatus', COALESCE((SELECT r."status" FROM target_workout_56_reconciliation AS r), 'none'),
      'reconciliationRepresentativeIsWorkout56', ((SELECT "id" FROM target_workout_56_representative) = 56),
      'reconciliationRepresentativeVisible', EXISTS (SELECT 1 FROM "Workout" AS w
        JOIN target_workout_56_representative AS r ON r."id" = w."id" WHERE NOT w."hiddenFromHistory"),
      'reconciliationRepresentativeShadowExists', EXISTS (SELECT 1 FROM "ExperimentalStepperActiveEnergyShadow" AS target
        JOIN target_workout_56_representative AS r ON r."id" = target."workoutId" AND target."profileId" = 1),
      'shadowPresent', s."workoutId" IS NOT NULL,
      'targetWorkout72', COALESCE((SELECT jsonb_build_object(
        'visible', NOT w."hiddenFromHistory",
        'expectedKind', w.expected_kind,
        'createdOnOrAfterAcceptanceCutoff', w."createdAt" >= TIMESTAMPTZ '2026-10-22 00:00:00+00',
        'rawEnergyNonNull', w."activeEnergyKcal" IS NOT NULL OR w."manualActiveEnergyKcal" IS NOT NULL,
        'workoutAliasCount', (SELECT count(*) FROM "ActiveEnergyEventAlias" AS a
          WHERE a."profileId" = 1 AND a."sourceType" = 'workout' AND a."workoutId" = w."id"),
        'canonicalEventCount', (SELECT count(DISTINCT e."id") FROM target_workout_72_events AS e),
        'eventKindMatchCount', (SELECT count(DISTINCT e."id") FROM target_workout_72_events AS e WHERE e."eventKind" = w.expected_kind),
        'logicalIdentityMatchCount', (SELECT count(DISTINCT e."id") FROM target_workout_72_events AS e
          WHERE e."logicalEventKey" = 'workout:72'
            OR (w.expected_kind = 'stepper' AND e."logicalEventKey" LIKE 'stepper-reconciliation:%')),
        'currentValidCount', (SELECT count(DISTINCT e."id") FROM target_workout_72_events AS e
          WHERE NOT e."isStale" AND e."supersededByEventId" IS NULL
            AND e."currentSource" IS NOT NULL AND e."currentSource" <> 'unavailable'
            AND e."currentKcal" IS NOT NULL AND e."currentKcal" >= 0
            AND e."currentKcal"::text NOT IN ('NaN', 'Infinity', '-Infinity')
            AND e."currentResolutionFingerprint" ~ '^[a-f0-9]{64}$'),
        'resolutionRevisionMatchCount', (SELECT count(DISTINCT e."id") FROM target_workout_72_events AS e
          JOIN "ActiveEnergyResolutionRevision" AS r ON r."eventId" = e."id"
            AND r."revision" = e."resolutionRevision"
            AND r."resolutionFingerprint" = e."currentResolutionFingerprint"
            AND r."source" = e."currentSource"
            AND r."valueKcal" IS NOT DISTINCT FROM e."currentKcal"
            AND r."provenance" = e."currentProvenance"),
        'selectedCandidateMatchCount', (SELECT count(DISTINCT e."id") FROM target_workout_72_events AS e
          JOIN "ActiveEnergyCandidate" AS c ON c."eventId" = e."id"
            AND c."source" = e."currentSource"
            AND c."sourceIdentity" = e."currentProvenance"->>'sourceIdentity'
            AND c."sourceFingerprint" = e."currentProvenance"->>'sourceFingerprint'
            AND c."availability" = 'available'
            AND c."valueKcal" IS NOT DISTINCT FROM e."currentKcal"),
        'selectedCandidateEvidenceMatchCount', (SELECT count(DISTINCT e."id") FROM target_workout_72_events AS e
          JOIN "ActiveEnergyCandidate" AS c ON c."eventId" = e."id"
            AND c."source" = e."currentSource"
            AND c."sourceIdentity" = e."currentProvenance"->>'sourceIdentity'
            AND c."sourceFingerprint" = e."currentProvenance"->>'sourceFingerprint'
            AND c."availability" = 'available'
            AND c."valueKcal" IS NOT DISTINCT FROM e."currentKcal"
            AND c."provenance" = e."currentProvenance"->'evidence'),
        'availableCandidateCount', (SELECT count(*) FROM target_workout_72_events AS e
          JOIN "ActiveEnergyCandidate" AS c ON c."eventId" = e."id"
          WHERE c."availability" = 'available' AND c."valueKcal" IS NOT NULL
            AND c."valueKcal" >= 0 AND c."valueKcal"::text NOT IN ('NaN', 'Infinity', '-Infinity')),
        'selectedSourceCodeFirstEvent', (SELECT CASE e."currentSource"
          WHEN 'manual-kcal' THEN 1 WHEN 'device-kcal' THEN 2
          WHEN 'bodycast-stepper-mechanical' THEN 3 WHEN 'bodycast-strength-estimate' THEN 4
          WHEN 'bodycast-strength-met-fallback' THEN 5 WHEN 'unavailable' THEN 0 ELSE 6 END
          FROM target_workout_72_events AS e ORDER BY e."id" LIMIT 1),
        'selectedIdentityCodeFirstEvent', (SELECT CASE
          WHEN e."currentProvenance"->>'sourceIdentity' = 'stepper-shadow:72' THEN 1
          WHEN e."currentProvenance"->>'sourceIdentity' LIKE 'stepper-shadow:%' THEN 2
          WHEN e."currentProvenance"->>'sourceIdentity' LIKE 'stepper-manual-steps:%' THEN 3
          WHEN e."currentProvenance"->>'sourceIdentity' LIKE 'strength-session:%' THEN 4
          WHEN e."currentProvenance"->>'sourceIdentity' = 'workout:72:manual' THEN 5
          WHEN e."currentProvenance"->>'sourceIdentity' = 'workout:72:device' THEN 6
          ELSE 7 END FROM target_workout_72_events AS e ORDER BY e."id" LIMIT 1),
        'stepperShadowPresent', EXISTS (SELECT 1 FROM "ExperimentalStepperActiveEnergyShadow" AS s
          WHERE s."profileId" = 1 AND s."workoutId" = w."id")
      )), jsonb_build_object('visible', false, 'expectedKind', 'missing'))
    )::text, 'UTF8'), 'base64'), E'\n', ''), E'\r', '')
    FROM (SELECT 1) AS diagnostic_anchor
    LEFT JOIN "ExperimentalStepperActiveEnergyShadow" AS s
      ON s."profileId" = 1 AND s."workoutId" = 56), 'none')
FROM current_events
SQL
)"
if ! query_result="$(PGPASSFILE="$passfile" \
  PGAPPNAME=bodycast-production-checkout-diagnostic \
  PGCONNECT_TIMEOUT=5 \
  PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000' \
  psql --no-psqlrc --quiet --tuples-only --no-align --field-separator='|' --no-password \
    --set=ON_ERROR_STOP=1 --set=VERBOSITY=verbose \
    --host "$server_ip" --username="$POSTGRES_USER" --dbname=bodycast \
    --command "BEGIN READ ONLY; $query; ROLLBACK" 2>"$error_file")"; then
  sqlstate="$(sed -nE 's/^[A-Z]+:[[:space:]]+([0-9A-Z]{5})(:|$).*/\1/p' "$error_file" | head -n 1)"
  if [[ "$sqlstate" =~ ^[0-9A-Z]{5}$ ]]; then
    safe_object="$(sed -nE \
      -e 's/^[A-Z]+:[[:space:]]+[0-9A-Z]{5}:[[:space:]]+relation "([A-Za-z0-9_]+)" does not exist.*/relation-\1/p' \
      -e 's/^[A-Z]+:[[:space:]]+[0-9A-Z]{5}:[[:space:]]+missing FROM-clause entry for table "([A-Za-z0-9_]+)".*/table-reference-\1/p' \
      "$error_file" | head -n 1)"
    case "$safe_object" in
      relation-Workout|relation-ActiveEnergyEventAlias|relation-ActiveEnergyCanonicalEvent|relation-ActiveEnergyResolutionRevision|relation-ActiveEnergyCandidate|relation-ExperimentalStepperActiveEnergyShadow|relation-StepperReconciliationCandidate|relation-StepperReconciliationGroup|relation-StrengthDiarySession|relation-eligible_aliases|relation-current_events|relation-target_strength_session_candidates|relation-target_strength_session_localized|relation-target_strength_session_day|relation-target_workout_56|relation-target_workout_56_reconciliation|relation-target_workout_56_reconciliation_pairs|relation-target_workout_56_reconciliation_member_ids|relation-target_workout_56_representative|relation-target_workout_56_events|relation-target_workout_72|relation-target_workout_72_events|relation-target_workout_56_canonical_event|table-reference-w|table-reference-e|table-reference-a|table-reference-c|table-reference-r|table-reference-s)
        printf '__diagnostic_query_error__|sqlstate-%s|object-%s\n' "$sqlstate" "$safe_object"
        ;;
      *) printf '__diagnostic_query_error__|sqlstate-%s\n' "$sqlstate" ;;
    esac
  else
    printf '__diagnostic_query_error__|connection-or-client\n'
  fi
  exit 0
fi
printf '%s\n' "$query_result"
BASH
)" || return 1
  if [[ "$inventory" =~ ^__diagnostic_query_error__\|sqlstate-([0-9A-Z]{5})\|object-([A-Za-z0-9_-]+)$ ]]; then
    printf '__diagnostic_query_error__|sqlstate-%s|object-%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 1
  fi
  if [[ "$inventory" =~ ^__diagnostic_query_error__\|(sqlstate-[0-9A-Z]{5}|connection-or-client)$ ]]; then
    printf '%s\n' "$inventory"
    return 1
  fi
  shadow_payload_b64="${inventory##*|}"
  inventory="${inventory%|*}"
  [[ "$inventory" =~ ^([0-9]+\|){32}[0-9]+$ ]] || { printf '__diagnostic_query_error__|invalid-result-shape\n'; return 1; }
  [[ "$shadow_payload_b64" == none || "$shadow_payload_b64" =~ ^[A-Za-z0-9+/]+={0,2}$ ]] || return 1
  printf '%s\n%s\n' "$inventory" "$shadow_payload_b64"
}

git_ro() {
  GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false -c core.untrackedCache=false "$@"
}

stat_fields() {
  stat -Lc '%u %g %a' -- "$1" 2>/dev/null || printf 'unavailable unavailable unavailable'
}

if [[ ! "${DEPLOY_PATH_B64:-}" =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
  emit diagnostic_status invalid_path_input
  exit 2
fi

if [[ ! "${APP_HOST_B64:-}" =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
  emit diagnostic_status invalid_app_host_input
  exit 2
fi

APP_HOST="$(printf '%s' "$APP_HOST_B64" | base64 --decode 2>/dev/null)" || {
  emit diagnostic_status invalid_app_host_input
  exit 2
}
if [[ ! "$APP_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  emit diagnostic_status invalid_app_host_input
  exit 2
fi

DEPLOY_PATH="$(printf '%s' "$DEPLOY_PATH_B64" | base64 --decode 2>/dev/null)" || {
  emit diagnostic_status invalid_path_input
  exit 2
}
if [[ "$DEPLOY_PATH" != /* || "$DEPLOY_PATH" == *$'\n'* || "$DEPLOY_PATH" == *$'\r'* ]]; then
  emit diagnostic_status invalid_path_input
  exit 2
fi

DEPLOY_EXISTS=0
DEPLOY_IS_DIR=0
DEPLOY_IS_SYMLINK=0
DEPLOY_HAS_TRAILING_SLASH=0
DEPLOY_NORMALIZED=""
if [[ -e "$DEPLOY_PATH" || -L "$DEPLOY_PATH" ]]; then DEPLOY_EXISTS=1; fi
if [[ -d "$DEPLOY_PATH" ]]; then DEPLOY_IS_DIR=1; fi
if [[ -L "$DEPLOY_PATH" ]]; then DEPLOY_IS_SYMLINK=1; fi
if [[ "$DEPLOY_PATH" == */ ]]; then DEPLOY_HAS_TRAILING_SLASH=1; fi
DEPLOY_NORMALIZED="$(realpath -m -- "$DEPLOY_PATH" 2>/dev/null || true)"
DEPLOY_NORMALIZED_DIFFERS=0
if [[ -n "$DEPLOY_NORMALIZED" && "$DEPLOY_NORMALIZED" != "$DEPLOY_PATH" ]]; then DEPLOY_NORMALIZED_DIFFERS=1; fi

DEPLOY_HAS_SYMLINK_COMPONENT=0
path_parts=()
IFS='/' read -r -a path_parts <<< "$DEPLOY_PATH"
path_prefix=''
path_component=''
for path_component in "${path_parts[@]}"; do
  [[ -n "$path_component" ]] || continue
  if [[ "$path_component" == . || "$path_component" == .. ]]; then continue; fi
  if [[ "$path_prefix" == '' ]]; then path_prefix="/$path_component"; else path_prefix="$path_prefix/$path_component"; fi
  if [[ -L "$path_prefix" ]]; then DEPLOY_HAS_SYMLINK_COMPONENT=1; fi
done

GIT_ROOT="$(git_ro -C "$DEPLOY_PATH" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$GIT_ROOT" ]]; then
  emit diagnostic_status no_git_worktree_at_configured_path
  emit deploy_path_exists "$(bool "$DEPLOY_EXISTS")"
  emit deploy_path_is_directory "$(bool "$DEPLOY_IS_DIR")"
  emit deploy_path_is_symlink "$(bool "$DEPLOY_IS_SYMLINK")"
  emit deploy_path_has_symlink_component "$(bool "$DEPLOY_HAS_SYMLINK_COMPONENT")"
  emit deploy_path_has_trailing_slash "$(bool "$DEPLOY_HAS_TRAILING_SLASH")"
  emit deploy_path_normalization_changes_value "$(bool "$DEPLOY_NORMALIZED_DIFFERS")"
  emit effective_uid "$(id -u 2>/dev/null || printf unavailable)"
  read -r DEPLOY_UID DEPLOY_GID DEPLOY_MODE <<< "$(stat_fields "$DEPLOY_PATH")"
  emit deploy_path_uid "$DEPLOY_UID"
  emit deploy_path_gid "$DEPLOY_GID"
  emit deploy_path_mode "$DEPLOY_MODE"
  emit deploy_path_readable "$(bool "$([[ -r "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
  emit deploy_path_writable "$(bool "$([[ -w "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
  exit 0
fi

GIT_ROOT_CANONICAL="$(realpath -e -- "$GIT_ROOT" 2>/dev/null || true)"
DEPLOY_CANONICAL="$(realpath -e -- "$DEPLOY_PATH" 2>/dev/null || true)"
LITERAL_MATCH=0
CANONICAL_MATCH=0
if [[ "$DEPLOY_PATH" == "$GIT_ROOT" ]]; then LITERAL_MATCH=1; fi
if [[ -n "$DEPLOY_CANONICAL" && -n "$GIT_ROOT_CANONICAL" && "$DEPLOY_CANONICAL" == "$GIT_ROOT_CANONICAL" ]]; then
  CANONICAL_MATCH=1
fi

HEAD_SHA="$(git_ro -C "$GIT_ROOT" rev-parse --verify HEAD 2>/dev/null || printf unavailable)"
BRANCH="$(git_ro -C "$GIT_ROOT" symbolic-ref -q --short HEAD 2>/dev/null || printf DETACHED)"
ORIGIN_MAIN_SHA="$(git_ro -C "$GIT_ROOT" rev-parse --verify refs/remotes/origin/main 2>/dev/null || printf unavailable)"
STATUS_RC=0
STATUS_OUTPUT="$(git_ro -C "$GIT_ROOT" status --porcelain=v1 --untracked-files=all 2>/dev/null)" || STATUS_RC=$?
STATUS_DIRTY=0
if [[ -n "$STATUS_OUTPUT" ]]; then STATUS_DIRTY=1; fi

UNSTAGED_TRACKED_COUNT="$(git_ro -C "$GIT_ROOT" diff --name-only --no-renames -z 2>/dev/null | count_nul_records)"
STAGED_TRACKED_COUNT="$(git_ro -C "$GIT_ROOT" diff --cached --name-only --no-renames -z 2>/dev/null | count_nul_records)"
UNTRACKED_COUNT="$(git_ro -C "$GIT_ROOT" ls-files --others --exclude-standard -z 2>/dev/null | count_nul_records)"
UNMERGED_RECORD_COUNT="$(git_ro -C "$GIT_ROOT" ls-files -u -z 2>/dev/null | count_nul_records)"

GIT_DIR="$(git_ro -C "$GIT_ROOT" rev-parse --absolute-git-dir 2>/dev/null || true)"
COMMON_DIR="$(git_ro -C "$GIT_ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
if [[ -n "$COMMON_DIR" && "$COMMON_DIR" != /* ]]; then COMMON_DIR="$GIT_ROOT/$COMMON_DIR"; fi
COMMON_DIR="$(realpath -e -- "$COMMON_DIR" 2>/dev/null || true)"
INDEX_PATH="$(git_ro -C "$GIT_ROOT" rev-parse --git-path index 2>/dev/null || true)"
if [[ -n "$INDEX_PATH" && "$INDEX_PATH" != /* ]]; then INDEX_PATH="$GIT_ROOT/$INDEX_PATH"; fi

WORKTREE_COUNT="$(git_ro -C "$GIT_ROOT" worktree list --porcelain 2>/dev/null | awk '$1 == "worktree" { count++ } END { print count + 0 }')"
IS_LINKED_WORKTREE=0
if [[ -n "$GIT_DIR" && -n "$COMMON_DIR" ]]; then
  GIT_DIR_CANONICAL="$(realpath -e -- "$GIT_DIR" 2>/dev/null || true)"
  if [[ -n "$GIT_DIR_CANONICAL" && "$GIT_DIR_CANONICAL" != "$COMMON_DIR" ]]; then IS_LINKED_WORKTREE=1; fi
fi

EUID_VALUE="$(id -u 2>/dev/null || printf unavailable)"
read -r DEPLOY_UID DEPLOY_GID DEPLOY_MODE <<< "$(stat_fields "$DEPLOY_PATH")"
read -r ROOT_UID ROOT_GID ROOT_MODE <<< "$(stat_fields "$GIT_ROOT")"
read -r GIT_DIR_UID GIT_DIR_GID GIT_DIR_MODE <<< "$(stat_fields "$GIT_DIR")"
read -r COMMON_UID COMMON_GID COMMON_MODE <<< "$(stat_fields "$COMMON_DIR")"
read -r INDEX_UID INDEX_GID INDEX_MODE <<< "$(stat_fields "$INDEX_PATH")"
CHECKOUT_CLEAN=0
if [[ "$STATUS_RC" == 0 && "$STATUS_DIRTY" == 0 ]]; then CHECKOUT_CLEAN=1; fi

emit diagnostic_status complete
emit deploy_path_exists "$(bool "$DEPLOY_EXISTS")"
emit deploy_path_is_directory "$(bool "$DEPLOY_IS_DIR")"
emit deploy_path_is_symlink "$(bool "$DEPLOY_IS_SYMLINK")"
emit deploy_path_has_symlink_component "$(bool "$DEPLOY_HAS_SYMLINK_COMPONENT")"
emit deploy_path_has_trailing_slash "$(bool "$DEPLOY_HAS_TRAILING_SLASH")"
emit deploy_path_normalization_changes_value "$(bool "$DEPLOY_NORMALIZED_DIFFERS")"
emit deploy_path_literal_matches_git_root "$(bool "$LITERAL_MATCH")"
emit deploy_path_canonical_matches_git_root "$(bool "$CANONICAL_MATCH")"
emit head_sha "$HEAD_SHA"
emit branch "$BRANCH"
emit origin_main_sha "$ORIGIN_MAIN_SHA"
emit worktree_count "$WORKTREE_COUNT"
emit is_linked_worktree "$(bool "$IS_LINKED_WORKTREE")"
emit status_exit_code "$STATUS_RC"
emit git_status_dirty "$(bool "$STATUS_DIRTY")"
emit checkout_clean_as_existing_guard "$(bool "$CHECKOUT_CLEAN")"
emit tracked_unstaged_path_count "$UNSTAGED_TRACKED_COUNT"
emit tracked_staged_path_count "$STAGED_TRACKED_COUNT"
emit untracked_path_count "$UNTRACKED_COUNT"
emit unmerged_index_record_count "$UNMERGED_RECORD_COUNT"
emit tracked_unstaged_path_sample "$(git_ro -C "$GIT_ROOT" diff --name-only --no-renames -z 2>/dev/null | safe_path_sample)"
emit tracked_staged_path_sample "$(git_ro -C "$GIT_ROOT" diff --cached --name-only --no-renames -z 2>/dev/null | safe_path_sample)"
emit untracked_path_sample "$(git_ro -C "$GIT_ROOT" ls-files --others --exclude-standard -z 2>/dev/null | safe_path_sample)"
emit effective_uid "$EUID_VALUE"
emit deploy_path_uid "$DEPLOY_UID"
emit deploy_path_gid "$DEPLOY_GID"
emit deploy_path_mode "$DEPLOY_MODE"
emit deploy_path_readable "$(bool "$([[ -r "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
emit deploy_path_searchable "$(bool "$([[ -x "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
emit deploy_path_writable "$(bool "$([[ -w "$DEPLOY_PATH" ]] && echo 1 || echo 0)")"
emit git_root_uid "$ROOT_UID"
emit git_root_gid "$ROOT_GID"
emit git_root_mode "$ROOT_MODE"
emit git_dir_uid "$GIT_DIR_UID"
emit git_dir_gid "$GIT_DIR_GID"
emit git_dir_mode "$GIT_DIR_MODE"
emit git_dir_writable "$(bool "$([[ -w "$GIT_DIR" ]] && echo 1 || echo 0)")"
emit git_common_dir_uid "$COMMON_UID"
emit git_common_dir_gid "$COMMON_GID"
emit git_common_dir_mode "$COMMON_MODE"
emit git_common_dir_writable "$(bool "$([[ -w "$COMMON_DIR" ]] && echo 1 || echo 0)")"
emit git_index_uid "$INDEX_UID"
emit git_index_gid "$INDEX_GID"
emit git_index_mode "$INDEX_MODE"
emit git_index_readable "$(bool "$([[ -r "$INDEX_PATH" ]] && echo 1 || echo 0)")"
emit git_index_writable "$(bool "$([[ -w "$INDEX_PATH" ]] && echo 1 || echo 0)")"
emit deploy_path_owner_matches_effective_user "$(bool "$([[ "$DEPLOY_UID" == "$EUID_VALUE" ]] && echo 1 || echo 0)")"
emit git_root_owner_matches_effective_user "$(bool "$([[ "$ROOT_UID" == "$EUID_VALUE" ]] && echo 1 || echo 0)")"
emit git_common_dir_owner_matches_effective_user "$(bool "$([[ "$COMMON_UID" == "$EUID_VALUE" ]] && echo 1 || echo 0)")"
emit git_index_owner_matches_effective_user "$(bool "$([[ "$INDEX_UID" == "$EUID_VALUE" ]] && echo 1 || echo 0)")"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  emit docker_daemon_available yes
  production_db_ready=false
  caddy_named_inventory="unknown"
  if caddy_names="$(docker ps -a --filter "name=caddy" --format '{{.Names}}' 2>/dev/null)"; then
    caddy_named_inventory="none"
    safe_caddy_names=()
    invalid_caddy_name=false
    while IFS= read -r caddy_name; do
      [[ -n "$caddy_name" ]] || continue
      if [[ ! "$caddy_name" =~ ^[A-Za-z0-9_.-]{1,128}$ || "${caddy_name,,}" != *caddy* ]]; then
        invalid_caddy_name=true
        continue
      fi
      safe_caddy_names+=("$caddy_name")
      (( ${#safe_caddy_names[@]} <= 10 )) || break
    done <<< "$caddy_names"
    if [[ "$invalid_caddy_name" == "true" || ${#safe_caddy_names[@]} -gt 10 ]]; then
      caddy_named_inventory="unknown"
    elif [[ ${#safe_caddy_names[@]} -gt 0 ]]; then
      caddy_named_inventory="$(IFS=,; printf '%s' "${safe_caddy_names[*]}")"
    fi
  fi
  emit caddy_named_container_inventory "$caddy_named_inventory"
  for container in bodycast-app-prod bodycast-db-prod gymbeam-caddy; do
    key="${container//-/_}"
    fields="$(docker inspect --format '{{.Id}}|{{.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.HostConfig.RestartPolicy.Name}}|{{index .Config.Labels "org.bodycast.release-sha"}}' "$container" 2>/dev/null)"
    inspect_status=$?
    if [[ "$inspect_status" -ne 0 || -z "$fields" ]]; then
      if container_names="$(docker ps -a --filter "name=^/${container}$" --format '{{.Names}}' 2>/dev/null)"; then
        if [[ -z "$container_names" ]]; then
          emit "${key}_found" no
        else
          emit "${key}_found" unknown
        fi
      else
        emit "${key}_found" unknown
      fi
      emit "${key}_state" unknown
      continue
    fi
    IFS='|' read -r container_id image_id container_state container_health restart_policy release_sha <<< "$fields"
    [[ "$container_id" =~ ^[a-f0-9]{64}$ ]] || container_id=unknown
    [[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || image_id=unknown
    case "$container_state" in running|created|restarting|paused|exited|dead|removing) ;; *) container_state=unknown ;; esac
    case "$container_health" in healthy|unhealthy|starting|none) ;; *) container_health=unknown ;; esac
    case "$restart_policy" in no|always|unless-stopped|on-failure) ;; *) restart_policy=unknown ;; esac
    [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || release_sha=unknown
    emit "${key}_found" yes
    emit "${key}_container_id" "$container_id"
    emit "${key}_image_id" "$image_id"
    emit "${key}_state" "$container_state"
    emit "${key}_health" "$container_health"
    emit "${key}_restart_policy" "$restart_policy"
    emit "${key}_release_sha" "$release_sha"
    if [[ "$container" == "bodycast-db-prod" && "$container_state" == "running" && "$container_health" == "healthy" ]]; then
      production_db_ready=true
    fi
  done
  deploy_rollback_image="bodycast-app:deploy-rollback"
  if deploy_rollback_rows="$(docker image ls --no-trunc --format '{{.ID}}' "$deploy_rollback_image" 2>/dev/null)"; then
    if [[ -z "$deploy_rollback_rows" ]]; then
      emit deploy_rollback_pin_state absent
      emit deploy_rollback_pin_image_id unavailable
    elif [[ "$deploy_rollback_rows" =~ ^sha256:[a-f0-9]{64}$ ]]; then
      deploy_rollback_image_id="$(docker image inspect --format '{{.Id}}' "$deploy_rollback_image" 2>/dev/null)"
      if [[ "$deploy_rollback_image_id" == "$deploy_rollback_rows" ]]; then
        emit deploy_rollback_pin_state present
        emit deploy_rollback_pin_image_id "$deploy_rollback_image_id"
      else
        emit deploy_rollback_pin_state unknown
        emit deploy_rollback_pin_image_id unavailable
      fi
    else
      emit deploy_rollback_pin_state unknown
      emit deploy_rollback_pin_image_id unavailable
    fi
  else
    emit deploy_rollback_pin_state unknown
    emit deploy_rollback_pin_image_id unavailable
  fi
  if [[ "$production_db_ready" == true ]] && energy_inventory="$(read_only_energy_diagnostic_inventory)"; then
    energy_shadow_payload_b64="${energy_inventory##*$'\n'}"
    energy_inventory="${energy_inventory%%$'\n'*}"
    IFS='|' read -r energy_total energy_with_superseded energy_with_current energy_with_both_alias_kinds energy_stair_climbing energy_strength_training energy_workout_source energy_strength_session_source energy_workout_ids energy_target_utc_window_matches energy_target_utc_window_missing_timezone energy_target_completed_matches energy_target_live_matches energy_target_unmatched_candidates energy_target_local_minute_matches energy_target_effective_local_minute_matches energy_target_web_started_local_minute_matches energy_target_strength_session_matches energy_before_strength_local_date energy_on_or_after_strength_local_date energy_w56_visible energy_w56_aliases energy_w56_events energy_w56_kind_matches energy_w56_identity_matches energy_w56_current energy_w56_resolution_revision_matches energy_w56_selected_candidate_matches energy_w56_raw_energy_inputs energy_w56_available_candidates energy_w56_selected_source_code energy_w56_workout_classification_code energy_w56_selected_identity_code <<< "$energy_inventory"
    emit energy_diagnostic_inventory_status available
    emit energy_diagnostic_available_events_with_visible_workout_alias "$energy_total"
    emit energy_diagnostic_events_with_superseded_workout_alias "$energy_with_superseded"
    emit energy_diagnostic_events_with_current_workout_alias "$energy_with_current"
    emit energy_diagnostic_events_with_both_workout_alias_kinds "$energy_with_both_alias_kinds"
    emit energy_diagnostic_events_with_stair_climbing_workout_type "$energy_stair_climbing"
    emit energy_diagnostic_events_with_strength_training_workout_type "$energy_strength_training"
    emit energy_diagnostic_events_with_workout_alias_source_type "$energy_workout_source"
    emit energy_diagnostic_events_with_strength_session_alias_source_type "$energy_strength_session_source"
    emit energy_diagnostic_distinct_workout_ids_with_available_energy "$energy_workout_ids"
    emit energy_diagnostic_strength_session_utc_window_matches "$energy_target_utc_window_matches"
    emit energy_diagnostic_strength_session_utc_window_missing_timezone "$energy_target_utc_window_missing_timezone"
    emit energy_diagnostic_strength_session_completed_in_utc_window "$energy_target_completed_matches"
    emit energy_diagnostic_strength_session_live_in_utc_window "$energy_target_live_matches"
    emit energy_diagnostic_strength_session_unmatched_candidates_in_utc_window "$energy_target_unmatched_candidates"
    emit energy_diagnostic_strength_session_target_local_minute_matches "$energy_target_local_minute_matches"
    emit energy_diagnostic_strength_session_effective_at_target_local_minute_matches "$energy_target_effective_local_minute_matches"
    emit energy_diagnostic_strength_session_web_start_target_local_minute_matches "$energy_target_web_started_local_minute_matches"
    emit energy_diagnostic_target_strength_session_scope_matches "$energy_target_strength_session_matches"
    emit energy_diagnostic_canonical_events_before_target_strength_local_date "$energy_before_strength_local_date"
    emit energy_diagnostic_canonical_events_on_or_after_target_strength_local_date "$energy_on_or_after_strength_local_date"
    emit energy_diagnostic_workout_56_visible "$energy_w56_visible"
    emit energy_diagnostic_workout_56_aliases "$energy_w56_aliases"
    emit energy_diagnostic_workout_56_canonical_events "$energy_w56_events"
    emit energy_diagnostic_workout_56_event_kind_matches "$energy_w56_kind_matches"
    emit energy_diagnostic_workout_56_identity_matches "$energy_w56_identity_matches"
    emit energy_diagnostic_workout_56_current_resolution "$energy_w56_current"
    emit energy_diagnostic_workout_56_resolution_revision_matches "$energy_w56_resolution_revision_matches"
    emit energy_diagnostic_workout_56_selected_candidate_matches "$energy_w56_selected_candidate_matches"
    emit energy_diagnostic_workout_56_raw_energy_inputs "$energy_w56_raw_energy_inputs"
    emit energy_diagnostic_workout_56_available_candidates "$energy_w56_available_candidates"
    emit energy_diagnostic_workout_56_selected_source_code "$energy_w56_selected_source_code"
    emit energy_diagnostic_workout_56_workout_classification_code "$energy_w56_workout_classification_code"
    emit energy_diagnostic_workout_56_selected_identity_code "$energy_w56_selected_identity_code"
    emit energy_diagnostic_workout_56_shadow_payload_b64 "$energy_shadow_payload_b64"
  else
    energy_inventory_status=unavailable
    if [[ "${energy_inventory:-}" =~ ^__diagnostic_query_error__\|sqlstate-([0-9A-Z]{5})\|object-([A-Za-z0-9_-]+)$ ]]; then
      energy_inventory_status="query-error-sqlstate-${BASH_REMATCH[1]}-object-${BASH_REMATCH[2]}"
    elif [[ "${energy_inventory:-}" =~ ^__diagnostic_query_error__\|sqlstate-([0-9A-Z]{5})$ ]]; then
      energy_inventory_status="query-error-sqlstate-${BASH_REMATCH[1]}"
    elif [[ "${energy_inventory:-}" == '__diagnostic_query_error__|connection-or-client' ]]; then
      energy_inventory_status=query-error-connection-or-client
    elif [[ "${energy_inventory:-}" == '__diagnostic_query_error__|invalid-result-shape' ]]; then
      energy_inventory_status=invalid-result-shape
    fi
    emit energy_diagnostic_inventory_status "$energy_inventory_status"
    emit energy_diagnostic_available_events_with_visible_workout_alias unavailable
    emit energy_diagnostic_events_with_superseded_workout_alias unavailable
    emit energy_diagnostic_events_with_current_workout_alias unavailable
    emit energy_diagnostic_events_with_both_workout_alias_kinds unavailable
    emit energy_diagnostic_events_with_stair_climbing_workout_type unavailable
    emit energy_diagnostic_events_with_strength_training_workout_type unavailable
    emit energy_diagnostic_events_with_workout_alias_source_type unavailable
    emit energy_diagnostic_events_with_strength_session_alias_source_type unavailable
    emit energy_diagnostic_distinct_workout_ids_with_available_energy unavailable
    emit energy_diagnostic_strength_session_utc_window_matches unavailable
    emit energy_diagnostic_strength_session_utc_window_missing_timezone unavailable
    emit energy_diagnostic_strength_session_completed_in_utc_window unavailable
    emit energy_diagnostic_strength_session_live_in_utc_window unavailable
    emit energy_diagnostic_strength_session_unmatched_candidates_in_utc_window unavailable
    emit energy_diagnostic_strength_session_target_local_minute_matches unavailable
    emit energy_diagnostic_strength_session_effective_at_target_local_minute_matches unavailable
    emit energy_diagnostic_strength_session_web_start_target_local_minute_matches unavailable
    emit energy_diagnostic_target_strength_session_scope_matches unavailable
    emit energy_diagnostic_canonical_events_before_target_strength_local_date unavailable
    emit energy_diagnostic_canonical_events_on_or_after_target_strength_local_date unavailable
    emit energy_diagnostic_workout_56_visible unavailable
    emit energy_diagnostic_workout_56_aliases unavailable
    emit energy_diagnostic_workout_56_canonical_events unavailable
    emit energy_diagnostic_workout_56_event_kind_matches unavailable
    emit energy_diagnostic_workout_56_identity_matches unavailable
    emit energy_diagnostic_workout_56_current_resolution unavailable
    emit energy_diagnostic_workout_56_resolution_revision_matches unavailable
    emit energy_diagnostic_workout_56_selected_candidate_matches unavailable
    emit energy_diagnostic_workout_56_raw_energy_inputs unavailable
    emit energy_diagnostic_workout_56_available_candidates unavailable
    emit energy_diagnostic_workout_56_selected_source_code unavailable
    emit energy_diagnostic_workout_56_workout_classification_code unavailable
    emit energy_diagnostic_workout_56_selected_identity_code unavailable
    emit energy_diagnostic_workout_56_shadow_payload_b64 unavailable
  fi
else
  emit docker_daemon_available no
  emit bodycast_app_prod_found unknown
  emit bodycast_db_prod_found unknown
  emit gymbeam_caddy_found unknown
  emit caddy_named_container_inventory unknown
  emit deploy_rollback_pin_state unknown
  emit deploy_rollback_pin_image_id unavailable
  emit energy_diagnostic_inventory_status unavailable
  emit energy_diagnostic_available_events_with_visible_workout_alias unavailable
  emit energy_diagnostic_events_with_superseded_workout_alias unavailable
  emit energy_diagnostic_events_with_current_workout_alias unavailable
  emit energy_diagnostic_events_with_both_workout_alias_kinds unavailable
  emit energy_diagnostic_events_with_stair_climbing_workout_type unavailable
  emit energy_diagnostic_events_with_strength_training_workout_type unavailable
  emit energy_diagnostic_events_with_workout_alias_source_type unavailable
  emit energy_diagnostic_events_with_strength_session_alias_source_type unavailable
  emit energy_diagnostic_distinct_workout_ids_with_available_energy unavailable
  emit energy_diagnostic_strength_session_utc_window_matches unavailable
  emit energy_diagnostic_strength_session_utc_window_missing_timezone unavailable
  emit energy_diagnostic_strength_session_completed_in_utc_window unavailable
  emit energy_diagnostic_strength_session_live_in_utc_window unavailable
  emit energy_diagnostic_strength_session_unmatched_candidates_in_utc_window unavailable
  emit energy_diagnostic_strength_session_target_local_minute_matches unavailable
  emit energy_diagnostic_strength_session_effective_at_target_local_minute_matches unavailable
  emit energy_diagnostic_strength_session_web_start_target_local_minute_matches unavailable
  emit energy_diagnostic_target_strength_session_scope_matches unavailable
  emit energy_diagnostic_canonical_events_before_target_strength_local_date unavailable
  emit energy_diagnostic_canonical_events_on_or_after_target_strength_local_date unavailable
  emit energy_diagnostic_workout_56_visible unavailable
  emit energy_diagnostic_workout_56_aliases unavailable
  emit energy_diagnostic_workout_56_canonical_events unavailable
  emit energy_diagnostic_workout_56_event_kind_matches unavailable
  emit energy_diagnostic_workout_56_identity_matches unavailable
  emit energy_diagnostic_workout_56_current_resolution unavailable
  emit energy_diagnostic_workout_56_resolution_revision_matches unavailable
  emit energy_diagnostic_workout_56_selected_candidate_matches unavailable
  emit energy_diagnostic_workout_56_raw_energy_inputs unavailable
  emit energy_diagnostic_workout_56_available_candidates unavailable
  emit energy_diagnostic_workout_56_selected_source_code unavailable
  emit energy_diagnostic_workout_56_workout_classification_code unavailable
  emit energy_diagnostic_workout_56_selected_identity_code unavailable
  emit energy_diagnostic_workout_56_shadow_payload_b64 unavailable
fi

if command -v curl >/dev/null 2>&1; then
  curl --silent --show-error --max-time 10 --dump-header - "https://${APP_HOST}/" 2>/dev/null \
    | awk '
      BEGIN { in_headers = 1; status = "unavailable"; body_match = 0; maintenance_header = 0; no_store = 0 }
      /^HTTP\/[0-9.]+[[:space:]]+[0-9][0-9][0-9]/ { status = $2; in_headers = 1; next }
      in_headers && /^\r?$/ { in_headers = 0; next }
      in_headers && tolower($0) ~ /^x-bodycast-deploy-maintenance:/ { maintenance_header = 1; next }
      in_headers && tolower($0) ~ /^cache-control:/ && tolower($0) ~ /(^|[,:[:space:]])no-store([,;[:space:]]|$)/ { no_store = 1; next }
      !in_headers && $0 == "BodyCast is temporarily unavailable while the model is updated." { body_match = 1 }
      END {
        printf "public_https_status=%s\n", status
        printf "maintenance_header_present=%s\n", maintenance_header ? "yes" : "no"
        printf "maintenance_body_matches=%s\n", body_match ? "yes" : "no"
        printf "maintenance_cache_control_no_store=%s\n", no_store ? "yes" : "no"
      }
    '
  CURL_EXIT="${PIPESTATUS[0]}"
  emit public_https_probe_exit_code "$CURL_EXIT"

  API_HEALTH_OUTPUT="$(curl --silent --show-error --max-redirs 0 --connect-timeout 5 --max-time 10 --output - --write-out $'\n%{http_code}' "https://${APP_HOST}/api/health" 2>/dev/null)"
  API_HEALTH_EXIT="$?"
  API_HEALTH_RESPONSE="${API_HEALTH_OUTPUT%$'\n'*}"
  API_HEALTH_STATUS="unavailable"
  API_HEALTH_BODY_MATCH="no"
  [[ "${API_HEALTH_OUTPUT##*$'\n'}" =~ ^[1-5][0-9][0-9]$ ]] && API_HEALTH_STATUS="${API_HEALTH_OUTPUT##*$'\n'}"
  if [[ "$API_HEALTH_RESPONSE" == *'"status":"ok"'* ]]; then API_HEALTH_BODY_MATCH="yes"; fi
  emit public_api_health_status "$API_HEALTH_STATUS"
  emit public_api_health_body_matches "$API_HEALTH_BODY_MATCH"
  emit public_api_health_probe_exit_code "$API_HEALTH_EXIT"

  UI_STATUS="unavailable"
  UI_HTML_MATCH="no"
  UI_ORIGIN_MATCH="no"
  UI_PROBE_EXIT=0
  UI_REDIRECT_BLOCKED=no
  UI_CURRENT_URL="https://${APP_HOST}/"
  for ((UI_HOP = 0; UI_HOP <= 5; UI_HOP += 1)); do
    UI_RAW_RESPONSE="$(curl --silent --show-error --max-redirs 0 --connect-timeout 5 --max-time 15 --dump-header - --output /dev/null --write-out $'\n__BODYCAST_UI_RESULT__%{http_code}|%{content_type}' "$UI_CURRENT_URL" 2>/dev/null)"
    UI_PROBE_EXIT="$?"
    if [[ "$UI_PROBE_EXIT" -ne 0 ]]; then break; fi
    UI_RESULT="${UI_RAW_RESPONSE##*$'\n__BODYCAST_UI_RESULT__'}"
    UI_HEADERS="${UI_RAW_RESPONSE%$'\n__BODYCAST_UI_RESULT__'*}"
    if [[ ! "$UI_RESULT" =~ ^([1-5][0-9][0-9])\|([^|]*)$ ]]; then
      UI_STATUS="unavailable"
      UI_PROBE_EXIT=1
      break
    fi
    UI_STATUS="${BASH_REMATCH[1]}"
    UI_CONTENT_TYPE="${BASH_REMATCH[2]}"
    if [[ "$UI_STATUS" == 200 ]]; then
      if [[ "${UI_CONTENT_TYPE,,}" == text/html* ]]; then UI_HTML_MATCH="yes"; fi
      UI_ORIGIN_MATCH=yes
      break
    fi
    case "$UI_STATUS" in
      301|302|303|307|308) ;;
      *)
        if [[ "${UI_CONTENT_TYPE,,}" == text/html* ]]; then UI_HTML_MATCH="yes"; fi
        break
        ;;
    esac
    UI_LOCATION_INFO="$(printf '%s\n' "$UI_HEADERS" | awk '
      tolower(substr($0, 1, 9)) == "location:" {
        value = substr($0, 10)
        sub(/^[[:space:]]+/, "", value)
        sub(/\r$/, "", value)
        count += 1
        location = value
      }
      END {
        if (count == 0) print "none"
        else if (count == 1 && location !~ /[|[:cntrl:][:space:]]/) print "one|" location
        else print "invalid"
      }
    ')"
    if [[ "$UI_LOCATION_INFO" != one\|* || "$UI_HOP" -eq 5 ]]; then
      UI_REDIRECT_BLOCKED=yes
      UI_PROBE_EXIT=47
      break
    fi
    UI_LOCATION="${UI_LOCATION_INFO#one|}"
    if [[ "$UI_LOCATION" == /* && "$UI_LOCATION" != //* && "$UI_LOCATION" != *\\* ]]; then
      UI_CURRENT_URL="https://${APP_HOST}${UI_LOCATION}"
    else
      UI_LOWER_LOCATION="${UI_LOCATION,,}"
      UI_ORIGIN_PREFIX="https://${APP_HOST,,}"
      if [[ "$UI_LOWER_LOCATION" == "$UI_ORIGIN_PREFIX" ]]; then
        UI_CURRENT_URL="$UI_LOCATION"
      elif [[ "$UI_LOWER_LOCATION" == "$UI_ORIGIN_PREFIX"/* || "$UI_LOWER_LOCATION" == "$UI_ORIGIN_PREFIX"\?* || "$UI_LOWER_LOCATION" == "$UI_ORIGIN_PREFIX"\#* ]]; then
        UI_CURRENT_URL="$UI_LOCATION"
      else
        UI_REDIRECT_BLOCKED=yes
        UI_PROBE_EXIT=47
        break
      fi
    fi
  done
  emit public_ui_status "$UI_STATUS"
  emit public_ui_html_response "$UI_HTML_MATCH"
  emit public_ui_origin_matches_app_host "$UI_ORIGIN_MATCH"
  emit public_ui_redirect_blocked "$UI_REDIRECT_BLOCKED"
  emit public_ui_probe_exit_code "$UI_PROBE_EXIT"
else
  emit public_https_probe_exit_code unavailable
  emit public_https_status unavailable
  emit maintenance_header_present unavailable
  emit maintenance_body_matches unavailable
  emit maintenance_cache_control_no_store unavailable
  emit public_api_health_status unavailable
  emit public_api_health_body_matches unavailable
  emit public_api_health_probe_exit_code unavailable
  emit public_ui_status unavailable
  emit public_ui_html_response unavailable
  emit public_ui_origin_matches_app_host unavailable
  emit public_ui_redirect_blocked unavailable
  emit public_ui_probe_exit_code unavailable
fi
