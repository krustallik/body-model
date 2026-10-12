export const STAGE_02_MANIFEST = Object.freeze({
  id: "stage-02-strength-accounting-v1",
  migrations: Object.freeze([
    Object.freeze({ name: "20260929170000_training_load_accounting_v1", sha256: "d90a7cac525eb221ba2436c23043b6a515914d02205af47343b96337771d7f5b" }),
    Object.freeze({ name: "20260929190000_persist_strength_accounting_v1", sha256: "b33ea8679866972ac4964b6d7de92e74a237271ec25951b04e5541e12d5b8913" }),
  ]),
});

export const ACTIVE_ENERGY_UNIFIED_MANIFEST = Object.freeze({
  id: "active-energy-unified-v2",
  cutbackSupported: true,
  migrations: Object.freeze([
    Object.freeze({ name: "20261002100000_active_energy_canonical_resolution", sha256: "45711a527d809775a5ce66d3d9e529954158dcb65ed0065f70a0f948a4693a0b" }),
    Object.freeze({ name: "20261002150000_add_production_publication_generation", sha256: "9f1e38182dc3ec2449da5297786b603d8c0370498ed68db97059f640220bbbd7" }),
    Object.freeze({ name: "20261003120000_add_episode_aware_unified_experimental_physiology_v2", sha256: "0bb495d988ead0c1729f8e657b85f85bc4c20673fdedd5b61a7644cb0dcaf9b6" }),
    Object.freeze({ name: "20261005120000_episode_relative_muscle_core", sha256: "afef76464e4e77e6fd13a6ed6f8b04a6972d98229e3c5fc12a7e7dd8e3fd6588" }),
    Object.freeze({ name: "20261006110000_relative_muscle_legacy_identity", sha256: "56d8a64d4c966428835a96058783d01c4eac5984f8ed51928d26b13d6290208e" }),
    Object.freeze({ name: "20261006130000_unified_v4_glycogen_water_rollout", sha256: "9e50a8f33ec93e5f7d74681a611bd7272038f7e5e25563054f4a4dbb093b5408" }),
  ]),
  requiredTablesBefore: Object.freeze([
    "Workout", "Profile", "ModelEpisode", "PhysiologyV7Lifecycle", "DailyModelState", "_prisma_migrations",
    "ExperimentalSkeletalMuscleDeltaShadow", "ExperimentalCessationDetrainingShadow",
  ]),
  requiredObjectsBefore: Object.freeze([
    "ExperimentalSkeletalMuscleDeltaShadow_profileId_date_key",
    "ExperimentalCessationDetrainingShadow_profileId_date_key",
  ]),
  requiredObjectSignatureIncludes: Object.freeze({
    "ExperimentalSkeletalMuscleDeltaShadow_profileId_date_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExperimentalSkeletalMuscleDeltaShadow_profileId_date_key\" ON public.\"ExperimentalSkeletalMuscleDeltaShadow\" USING btree (\"profileId\", date)",
    "ExperimentalCessationDetrainingShadow_profileId_date_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExperimentalCessationDetrainingShadow_profileId_date_key\" ON public.\"ExperimentalCessationDetrainingShadow\" USING btree (\"profileId\", date)",
  }),
  postflightAbsentObjects: Object.freeze([
    "ExperimentalSkeletalMuscleDeltaShadow_profileId_date_key",
    "ExperimentalCessationDetrainingShadow_profileId_date_key",
  ]),
  postflightSignatureIncludes: Object.freeze({
    "ExperimentalSkeletalMuscleDeltaShadow.modelEpisodeId": "integer|nullable=true|default=",
    "ExperimentalSkeletalMuscleDeltaShadow.isStale": "boolean|nullable=false|default=false",
    "ExperimentalCessationDetrainingShadow.modelEpisodeId": "integer|nullable=true|default=",
    "ExperimentalCessationDetrainingShadow.isStale": "boolean|nullable=false|default=false",
    "ModelEpisode_id_profileId_key": "CREATE UNIQUE INDEX \"ModelEpisode_id_profileId_key\" ON public.\"ModelEpisode\" USING btree (id, \"profileId\")",
    "RelMuscleDelta_episode_profile_fkey": "FOREIGN KEY (\"modelEpisodeId\", \"profileId\") REFERENCES \"ModelEpisode\"(id, \"profileId\") ON UPDATE CASCADE ON DELETE RESTRICT",
    "RelMuscleCessation_episode_profile_fkey": "FOREIGN KEY (\"modelEpisodeId\", \"profileId\") REFERENCES \"ModelEpisode\"(id, \"profileId\") ON UPDATE CASCADE ON DELETE RESTRICT",
    "RelMuscleDelta_episode_date_key": "CREATE UNIQUE INDEX \"RelMuscleDelta_episode_date_key\" ON public.\"ExperimentalSkeletalMuscleDeltaShadow\" USING btree (\"profileId\", \"modelEpisodeId\", date) NULLS NOT DISTINCT",
    "RelMuscleDelta_episode_stale_date_idx": "CREATE INDEX \"RelMuscleDelta_episode_stale_date_idx\" ON public.\"ExperimentalSkeletalMuscleDeltaShadow\" USING btree (\"profileId\", \"modelEpisodeId\", \"isStale\", date)",
    "RelMuscleDelta_episode_profile_idx": "CREATE INDEX \"RelMuscleDelta_episode_profile_idx\" ON public.\"ExperimentalSkeletalMuscleDeltaShadow\" USING btree (\"modelEpisodeId\", \"profileId\")",
    "RelMuscleCessation_episode_date_key": "CREATE UNIQUE INDEX \"RelMuscleCessation_episode_date_key\" ON public.\"ExperimentalCessationDetrainingShadow\" USING btree (\"profileId\", \"modelEpisodeId\", date) NULLS NOT DISTINCT",
    "RelMuscleCessation_episode_stale_date_idx": "CREATE INDEX \"RelMuscleCessation_episode_stale_date_idx\" ON public.\"ExperimentalCessationDetrainingShadow\" USING btree (\"profileId\", \"modelEpisodeId\", \"isStale\", date)",
    "RelMuscleCessation_episode_profile_idx": "CREATE INDEX \"RelMuscleCessation_episode_profile_idx\" ON public.\"ExperimentalCessationDetrainingShadow\" USING btree (\"modelEpisodeId\", \"profileId\")",
  }),
  postflightObjects: Object.freeze([
    "ActiveEnergyCanonicalEvent", "ActiveEnergyCanonicalEvent_pkey", "ActiveEnergyCanonicalEvent_profile_key_key",
    "ActiveEnergyCanonicalEvent_superseded_by_fkey", "ActiveEnergyCanonicalEvent_revisions_nonnegative",
    "ActiveEnergyCanonicalEvent_fingerprints_hex", "ActiveEnergyCanonicalEvent_current_kcal_nonnegative",
    "ActiveEnergyCanonicalEvent_profile_date_idx", "ActiveEnergyCanonicalEvent_profile_occurrence_idx",
    "ActiveEnergyCanonicalEvent_superseded_by_idx", "ActiveEnergyEventAlias", "ActiveEnergyEventAlias_pkey",
    "ActiveEnergyEventAlias_profile_source_key", "ActiveEnergyEventAlias_event_fkey", "ActiveEnergyEventAlias_workout_fkey",
    "ActiveEnergyEventAlias_event_idx", "ActiveEnergyCandidate", "ActiveEnergyCandidate_pkey",
    "ActiveEnergyCandidate_event_fkey", "ActiveEnergyCandidate_event_source_fingerprint_key",
    "ActiveEnergyCandidate_availability_value_check", "ActiveEnergyCandidate_fingerprint_hex",
    "ActiveEnergyCandidate_event_created_idx", "ActiveEnergyResolutionRevision", "ActiveEnergyResolutionRevision_pkey",
    "ActiveEnergyResolutionRevision_event_fkey", "ActiveEnergyResolutionRevision_event_revision_key",
    "ActiveEnergyResolutionRevision_revision_positive", "ActiveEnergyResolutionRevision_fingerprint_hex",
    "ActiveEnergyResolutionRevision_value_check", "ActiveEnergyCanonicalEvent_id_seq", "ActiveEnergyEventAlias_id_seq",
    "ActiveEnergyCandidate_id_seq", "ActiveEnergyResolutionRevision_id_seq",
    "PhysiologyV7Lifecycle.productionStaleFromDate", "PhysiologyV7Lifecycle.productionPublishedGeneration",
    "PhysiologyV7Lifecycle.unifiedPublishedGeneration", "PhysiologyV7Lifecycle_productionStaleFromDate_idx",
    "PhysiologyV7Lifecycle.unifiedTargetRevision", "PhysiologyV7Lifecycle.unifiedRolloutEpoch",
    "PhysiologyV7Lifecycle.unifiedPublishedRolloutEpoch",
    "PhysiologyV7Lifecycle_unifiedTargetRevision_supported", "PhysiologyV7Lifecycle_unifiedRolloutEpoch_nonnegative",
    "DailyModelState.weightFilterVarianceKg2", "UnifiedExperimentalPhysiologyStateV2",
    "UnifiedExperimentalPhysiologyStateV2_pkey", "UnifiedExperimentalPhysiologyStateV2_profileId_fkey",
    "UnifiedExperimentalPhysiologyStateV2_modelEpisodeId_fkey",
    "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_date_key",
    "UnifiedExperimentalPhysiologyStateV2_profileId_boundaryAt_idx",
    "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_boundaryAt_idx",
    "UnifiedExperimentalPhysiologyStateV2_profileId_modelRevision_updatedAt_idx",
    "UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatus_boundaryAt_idx",
    "UnifiedExperimentalPhysiologyStateV2_profileId_resultFingerprint_idx",
    "UnifiedExperimentalPhysiologyStateV2_id_seq",
    "ExperimentalSkeletalMuscleDeltaShadow.modelEpisodeId", "ExperimentalSkeletalMuscleDeltaShadow.isStale",
    "ExperimentalCessationDetrainingShadow.modelEpisodeId", "ExperimentalCessationDetrainingShadow.isStale",
    "ModelEpisode_id_profileId_key", "RelMuscleDelta_episode_profile_fkey", "RelMuscleCessation_episode_profile_fkey",
    "RelMuscleDelta_episode_date_key", "RelMuscleDelta_episode_stale_date_idx", "RelMuscleDelta_episode_profile_idx",
    "RelMuscleCessation_episode_date_key", "RelMuscleCessation_episode_stale_date_idx", "RelMuscleCessation_episode_profile_idx",
  ]),
});

const V7_BASELINE_FUNCTIONS = Object.freeze([
  "function:physiology_v7_invalidate(integer, character varying)",
  "function:physiology_v7_workout_date(integer)",
  "function:physiology_v7_workout_source_trigger()",
  "function:physiology_v7_training_date(integer)",
  "function:physiology_v7_session_source_trigger()",
  "function:physiology_v7_session_child_source_trigger()",
]);
const V7_REPUBLICATION_FUNCTIONS = Object.freeze([
  ...V7_BASELINE_FUNCTIONS,
  "function:physiology_v7_model_date(integer, timestamp with time zone)",
  "function:physiology_v7_training_model_date(integer, integer, timestamp with time zone, timestamp with time zone, timestamp with time zone)",
  "function:physiology_v7_matched_workout_source_trigger()",
  "function:physiology_v7_matched_workout_delete_trigger()",
]);
const V7_TRAINING_SOURCE_TRIGGERS = Object.freeze([
  "trigger:StrengthDiarySession.StrengthDiarySession_v7_invalidate",
  "trigger:StrengthSessionExercise.StrengthSessionExercise_v7_invalidate",
  "trigger:StrengthSet.StrengthSet_v7_invalidate",
]);
const V7_BASELINE_WORKOUT_SOURCE_TRIGGERS = Object.freeze([
  "trigger:Workout.Workout_v7_invalidate_insert_delete",
  "trigger:Workout.Workout_v7_invalidate_update",
]);
const V7_REPUBLICATION_SOURCE_TRIGGERS = Object.freeze([
  "trigger:Workout.Workout_v7_invalidate",
  "trigger:Workout.Workout_v7_invalidate_matched_delete",
]);
const V7_REPUBLICATION_SCHEMA_OBJECTS = Object.freeze([
  "PhysiologyV7Lifecycle.unifiedPublicationBlockedFromDate",
  "PhysiologyV7Lifecycle.unifiedPublicationBlockedSource",
  "UnifiedPublicationBlock",
  "UnifiedPublicationBlock.profileId",
  "UnifiedPublicationBlock.source",
  "UnifiedPublicationBlock.sourceKey",
  "UnifiedPublicationBlock.fromDate",
  "UnifiedPublicationBlock.revision",
  "UnifiedPublicationBlock.updatedAt",
  "UnifiedPublicationBlock.createdAt",
  "UnifiedPublicationBlock_pkey",
  "UnifiedPublicationBlock_source_check",
  "UnifiedPublicationBlock_sourceKey_check",
  "UnifiedPublicationBlock_profileId_fkey",
  "UnifiedPublicationBlock_profileId_fromDate_idx",
  ...V7_REPUBLICATION_FUNCTIONS,
  ...V7_TRAINING_SOURCE_TRIGGERS,
  ...V7_BASELINE_WORKOUT_SOURCE_TRIGGERS,
  ...V7_REPUBLICATION_SOURCE_TRIGGERS,
]);

const functionDefinitionSignature = (header, body) => `definition=${header} AS $function$ ${body.replace(/\s+/g, " ").trim()} $function$`;
const V7_WORKOUT_SOURCE_TRIGGER_BODY = `
  DECLARE old_date VARCHAR(10); new_date VARCHAR(10); affected VARCHAR(10);
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      SELECT "date" INTO old_date FROM "DailyHealthData" WHERE "id" = OLD."dailyHealthDataId";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT "date" INTO new_date FROM "DailyHealthData" WHERE "id" = NEW."dailyHealthDataId";
    END IF;
    affected := CASE WHEN old_date IS NULL THEN new_date WHEN new_date IS NULL THEN old_date ELSE LEAST(old_date, new_date) END;
    PERFORM physiology_v7_invalidate(1, affected);
    RETURN COALESCE(NEW, OLD);
  END;`;
const V7_WORKOUT_SOURCE_TRIGGER_SIGNATURE = functionDefinitionSignature(
  "CREATE OR REPLACE FUNCTION public.physiology_v7_workout_source_trigger() RETURNS trigger LANGUAGE plpgsql",
  V7_WORKOUT_SOURCE_TRIGGER_BODY,
);
const V7_SESSION_SOURCE_TRIGGER_BODY = `
  DECLARE old_date VARCHAR(10); new_date VARCHAR(10); affected VARCHAR(10); pid INTEGER;
  BEGIN
    pid := COALESCE(NEW."profileId", OLD."profileId", 1);
    IF TG_OP <> 'INSERT' THEN old_date := physiology_v7_workout_date(OLD."matchedWorkoutId"); END IF;
    IF TG_OP <> 'DELETE' THEN new_date := physiology_v7_workout_date(NEW."matchedWorkoutId"); END IF;
    IF old_date IS NULL AND TG_OP <> 'INSERT' THEN SELECT MIN("date") INTO old_date FROM "DailyHealthData"; END IF;
    IF new_date IS NULL AND TG_OP <> 'DELETE' THEN SELECT MIN("date") INTO new_date FROM "DailyHealthData"; END IF;
    affected := CASE WHEN old_date IS NULL THEN new_date WHEN new_date IS NULL THEN old_date ELSE LEAST(old_date, new_date) END;
    PERFORM physiology_v7_invalidate(pid, affected);
    RETURN COALESCE(NEW, OLD);
  END;`;
const V7_SESSION_SOURCE_TRIGGER_SIGNATURE = functionDefinitionSignature(
  "CREATE OR REPLACE FUNCTION public.physiology_v7_session_source_trigger() RETURNS trigger LANGUAGE plpgsql",
  V7_SESSION_SOURCE_TRIGGER_BODY,
);
const V7_WORKOUT_INSERT_DELETE_TRIGGER_SIGNATURE = `enabled=O|function=physiology_v7_workout_source_trigger|definition=CREATE TRIGGER "Workout_v7_invalidate_insert_delete" AFTER INSERT OR DELETE ON "Workout" FOR EACH ROW EXECUTE FUNCTION physiology_v7_workout_source_trigger()`;
const V7_WORKOUT_UPDATE_TRIGGER_SIGNATURE = `enabled=O|function=physiology_v7_workout_source_trigger|definition=CREATE TRIGGER "Workout_v7_invalidate_update" AFTER UPDATE OF "dailyHealthDataId", type, "startAt", "endAt", "durationMinutes" ON "Workout" FOR EACH ROW EXECUTE FUNCTION physiology_v7_workout_source_trigger()`;
const V4_TRAINING_MODEL_DATE_BODY = `
  DECLARE
    event_at TIMESTAMPTZ;
    workout_date VARCHAR(10);
    event_date VARCHAR(10);
  BEGIN
    IF p_matched_workout_id IS NOT NULL THEN
      SELECT d."date", w."startAt" AT TIME ZONE 'UTC'
      INTO workout_date, event_at
      FROM "Workout" w
      JOIN "DailyHealthData" d ON d."id" = w."dailyHealthDataId"
      WHERE w."id" = p_matched_workout_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Matched workout or its daily source row is missing';
      END IF;
      event_date := physiology_v7_model_date(p_profile_id, event_at);
      RETURN CASE
        WHEN workout_date IS NULL THEN event_date
        WHEN event_date IS NULL THEN workout_date
        ELSE LEAST(workout_date, event_date)
      END;
    END IF;

    event_at := COALESCE(event_at, p_effective_accounting_at, p_web_started_at, p_created_at);
    RETURN physiology_v7_model_date(p_profile_id, event_at);
  END;`;
const V4_TRAINING_MODEL_DATE_SIGNATURE = functionDefinitionSignature(
  "CREATE OR REPLACE FUNCTION public.physiology_v7_training_model_date(p_profile_id integer, p_matched_workout_id integer, p_effective_accounting_at timestamp with time zone, p_web_started_at timestamp with time zone, p_created_at timestamp with time zone) RETURNS character varying LANGUAGE plpgsql STABLE",
  V4_TRAINING_MODEL_DATE_BODY,
);
const V4_MODEL_DATE_SIGNATURE = `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_model_date(p_profile_id integer, p_event_at timestamp with time zone) RETURNS character varying LANGUAGE plpgsql STABLE AS $function$ DECLARE affected VARCHAR(10); active_count INTEGER; active_start TIMESTAMPTZ; active_is_last BOOLEAN; invalid_boundary_count INTEGER; final_episode_active BOOLEAN; final_episode_start TIMESTAMPTZ; final_episode_end TIMESTAMPTZ; BEGIN IF p_event_at IS NULL THEN RETURN NULL; END IF; SELECT COUNT(*) INTO invalid_boundary_count FROM "ModelEpisode" e WHERE e."profileId" = p_profile_id AND to_char( (e."startDate"::timestamp AT TIME ZONE e."timezone") AT TIME ZONE e."timezone", 'YYYY-MM-DD HH24:MI:SS' ) <> e."startDate" || ' 00:00:00'; IF invalid_boundary_count > 0 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ModelEpisode start boundary does not round-trip in its timezone'; END IF; SELECT COUNT(*) INTO active_count FROM "ModelEpisode" WHERE "profileId" = p_profile_id AND "active"; IF active_count > 1 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ModelEpisode active partition is ambiguous'; END IF; SELECT "startDate"::timestamp AT TIME ZONE "timezone" INTO active_start FROM "ModelEpisode" WHERE "profileId" = p_profile_id AND "active"; WITH effective_boundaries AS ( SELECT e."id", e."active", e."deactivatedAt", e."startDate"::timestamp AT TIME ZONE e."timezone" AS "startInstant" FROM "ModelEpisode" e WHERE e."profileId" = p_profile_id AND (e."active" OR active_start IS NULL OR e."startDate"::timestamp AT TIME ZONE e."timezone" <= active_start) ), ordered_boundaries AS ( SELECT *, LEAD("startInstant") OVER (ORDER BY "startInstant" ASC, "id" ASC) AS "nextStartInstant", ROW_NUMBER() OVER (ORDER BY "startInstant" DESC, "id" DESC) AS reverse_position FROM effective_boundaries ) SELECT "active", "startInstant", "deactivatedAt" INTO final_episode_active, final_episode_start, final_episode_end FROM ordered_boundaries WHERE reverse_position = 1; IF final_episode_active IS FALSE AND (final_episode_end IS NULL OR final_episode_end <= final_episode_start) THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Last inactive ModelEpisode has no valid upper boundary'; END IF; SELECT "active" INTO active_is_last FROM ( SELECT e."active", ROW_NUMBER() OVER ( ORDER BY e."startDate"::timestamp AT TIME ZONE e."timezone" DESC, e."id" DESC ) AS reverse_position FROM "ModelEpisode" e WHERE e."profileId" = p_profile_id AND (e."active" OR active_start IS NULL OR e."startDate"::timestamp AT TIME ZONE e."timezone" <= active_start) ) effective WHERE reverse_position = 1; IF active_start IS NOT NULL AND active_is_last IS DISTINCT FROM TRUE THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Active ModelEpisode partition is ambiguous'; END IF; WITH episode_boundaries AS ( SELECT e."id", e."startDate", e."timezone", e."active", e."deactivatedAt", e."startDate"::timestamp AT TIME ZONE e."timezone" AS "startInstant" FROM "ModelEpisode" e WHERE e."profileId" = p_profile_id ), effective_boundaries AS ( SELECT * FROM episode_boundaries WHERE "active" OR active_start IS NULL OR "startInstant" <= active_start ), ordered_boundaries AS ( SELECT *, LEAD("startInstant") OVER (ORDER BY "startInstant" ASC, "id" ASC) AS "nextStartInstant" FROM effective_boundaries ) SELECT to_char(p_event_at AT TIME ZONE "timezone", 'YYYY-MM-DD') INTO affected FROM ordered_boundaries WHERE p_event_at >= "startInstant" AND ("nextStartInstant" IS NOT NULL AND p_event_at < "nextStartInstant" OR "nextStartInstant" IS NULL AND ("active" OR p_event_at < "deactivatedAt")) AND to_char(p_event_at AT TIME ZONE "timezone", 'YYYY-MM-DD') >= "startDate" ORDER BY "startInstant" DESC, "id" DESC LIMIT 1; IF affected IS NULL THEN affected := to_char(p_event_at AT TIME ZONE 'Europe/Bratislava', 'YYYY-MM-DD'); END IF; RETURN affected; END; $function$`;
const V4_TRAINING_DATE_SIGNATURE = `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_training_date(p_session_id integer) RETURNS character varying LANGUAGE plpgsql STABLE AS $function$ DECLARE affected VARCHAR(10); BEGIN SELECT physiology_v7_training_model_date( s."profileId", s."matchedWorkoutId", s."effectiveAccountingAt", s."webStartedAt", s."createdAt" ) INTO affected FROM "StrengthDiarySession" s WHERE s."id" = p_session_id; RETURN affected; END; $function$`;
const V4_SESSION_SOURCE_TRIGGER_BODY = `
  DECLARE
    old_date VARCHAR(10);
    new_date VARCHAR(10);
    affected VARCHAR(10);
    pid INTEGER;
    old_completed BOOLEAN := false;
    new_completed BOOLEAN := false;
  BEGIN
    IF TG_OP <> 'INSERT' THEN old_completed := OLD."status" = 'COMPLETED'; END IF;
    IF TG_OP <> 'DELETE' THEN new_completed := NEW."status" = 'COMPLETED'; END IF;
    IF NOT old_completed AND NOT new_completed THEN RETURN COALESCE(NEW, OLD); END IF;

    pid := COALESCE(NEW."profileId", OLD."profileId", 1);
    IF old_completed AND TG_OP <> 'INSERT' THEN
      IF TG_OP = 'UPDATE'
          AND OLD."matchedWorkoutId" IS NOT NULL
          AND NEW."matchedWorkoutId" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "Workout" WHERE "id" = OLD."matchedWorkoutId") THEN
        old_date := NULL;
      ELSE
        old_date := physiology_v7_training_model_date(
          OLD."profileId", OLD."matchedWorkoutId", OLD."effectiveAccountingAt", OLD."webStartedAt", OLD."createdAt"
        );
      END IF;
    END IF;
    IF new_completed AND TG_OP <> 'DELETE' THEN
      new_date := physiology_v7_training_model_date(
        NEW."profileId", NEW."matchedWorkoutId", NEW."effectiveAccountingAt", NEW."webStartedAt", NEW."createdAt"
      );
    END IF;
    affected := CASE WHEN old_date IS NULL THEN new_date WHEN new_date IS NULL THEN old_date ELSE LEAST(old_date, new_date) END;
    PERFORM physiology_v7_invalidate(pid, affected);
    RETURN COALESCE(NEW, OLD);
  END;`;
const V4_SESSION_SOURCE_TRIGGER_SIGNATURE = functionDefinitionSignature(
  "CREATE OR REPLACE FUNCTION public.physiology_v7_session_source_trigger() RETURNS trigger LANGUAGE plpgsql",
  V4_SESSION_SOURCE_TRIGGER_BODY,
);
const V4_MATCHED_WORKOUT_TRIGGER_BODY = `
  DECLARE
    pid INTEGER;
    old_date VARCHAR(10);
    new_date VARCHAR(10);
    affected VARCHAR(10);
  BEGIN
    IF OLD."startAt" IS NOT DISTINCT FROM NEW."startAt" THEN
      RETURN NEW;
    END IF;

    FOR pid IN
      SELECT DISTINCT s."profileId"
      FROM "StrengthDiarySession" s
      WHERE s."matchedWorkoutId" = OLD."id" AND s."status" = 'COMPLETED'
    LOOP
      old_date := physiology_v7_model_date(pid, OLD."startAt" AT TIME ZONE 'UTC');
      new_date := physiology_v7_model_date(pid, NEW."startAt" AT TIME ZONE 'UTC');
      affected := CASE
        WHEN old_date IS NULL THEN new_date
        WHEN new_date IS NULL THEN old_date
        ELSE LEAST(old_date, new_date)
      END;
      PERFORM physiology_v7_invalidate(pid, affected);
    END LOOP;
    RETURN NEW;
  END;`;
const V4_MATCHED_WORKOUT_TRIGGER_SIGNATURE = functionDefinitionSignature(
  "CREATE OR REPLACE FUNCTION public.physiology_v7_matched_workout_source_trigger() RETURNS trigger LANGUAGE plpgsql",
  V4_MATCHED_WORKOUT_TRIGGER_BODY,
);
const V4_MATCHED_WORKOUT_DELETE_TRIGGER_BODY = `
  DECLARE
    pid INTEGER;
    affected VARCHAR(10);
  BEGIN
    FOR pid IN
      SELECT DISTINCT s."profileId"
      FROM "StrengthDiarySession" s
      WHERE s."matchedWorkoutId" = OLD."id" AND s."status" = 'COMPLETED'
    LOOP
      affected := physiology_v7_model_date(pid, OLD."startAt" AT TIME ZONE 'UTC');
      PERFORM physiology_v7_invalidate(pid, affected);
    END LOOP;
    RETURN OLD;
  END;`;
const V4_MATCHED_WORKOUT_DELETE_TRIGGER_SIGNATURE = functionDefinitionSignature(
  "CREATE OR REPLACE FUNCTION public.physiology_v7_matched_workout_delete_trigger() RETURNS trigger LANGUAGE plpgsql",
  V4_MATCHED_WORKOUT_DELETE_TRIGGER_BODY,
);
const V4_MATCHED_WORKOUT_TRIGGER_DDL_SIGNATURE = `enabled=O|function=physiology_v7_matched_workout_source_trigger|definition=CREATE TRIGGER "Workout_v7_invalidate" AFTER UPDATE OF "startAt" ON "Workout" FOR EACH ROW EXECUTE FUNCTION physiology_v7_matched_workout_source_trigger()`;
const V4_MATCHED_WORKOUT_DELETE_TRIGGER_DDL_SIGNATURE = `enabled=O|function=physiology_v7_matched_workout_delete_trigger|definition=CREATE TRIGGER "Workout_v7_invalidate_matched_delete" BEFORE DELETE ON "Workout" FOR EACH ROW EXECUTE FUNCTION physiology_v7_matched_workout_delete_trigger()`;

export const V4_REPUBLICATION_MANIFEST = Object.freeze({
  id: "unified-v4-republication-v1",
  cutbackSupported: true,
  migrations: Object.freeze([
    Object.freeze({ name: "20261011120000_unified_publication_failure_fence", sha256: "b122658704a2ca7dac3d5de6e3e1b196d04027078d899d0b8e6079bf0a4397bc" }),
    Object.freeze({ name: "20261011130000_only_completed_training_invalidates_v7", sha256: "d37185c4d9c681bcf2e387d343cad2501f75c1d33916b5e4822eba8a9635a2b8" }),
  ]),
  requiredAppliedMigrations: ACTIVE_ENERGY_UNIFIED_MANIFEST.migrations,
  requiredTablesBefore: ACTIVE_ENERGY_UNIFIED_MANIFEST.requiredTablesBefore,
  requiredObjectsBefore: Object.freeze([
    ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects,
    ...V7_BASELINE_FUNCTIONS,
    ...V7_TRAINING_SOURCE_TRIGGERS,
    ...V7_BASELINE_WORKOUT_SOURCE_TRIGGERS,
  ]),
  requiredAbsentObjectsBefore: Object.freeze([
    ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightAbsentObjects,
    "function:physiology_v7_model_date(integer, timestamp with time zone)",
    "function:physiology_v7_training_model_date(integer, integer, timestamp with time zone, timestamp with time zone, timestamp with time zone)",
    "function:physiology_v7_matched_workout_source_trigger()",
    "function:physiology_v7_matched_workout_delete_trigger()",
    ...V7_REPUBLICATION_SOURCE_TRIGGERS,
  ]),
  requiredObjectSignatureIncludes: Object.freeze({
    ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightSignatureIncludes,
    "function:physiology_v7_invalidate(integer, character varying)": `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_invalidate(p_profile_id integer, p_date character varying) RETURNS void LANGUAGE plpgsql AS $function$ BEGIN IF p_date IS NULL THEN RETURN; END IF; INSERT INTO "PhysiologyV7Lifecycle" ("profileId", "staleFromDate", "invalidationGeneration", "stateVersion", "sourceNormalizationVersion", "dailyRuntimeVersion", "rangeRebuildVersion", "rebuildServiceVersion", "updatedAt") VALUES (p_profile_id, p_date, 1, 'bodycast-physiology-v7-state-v3', 'bodycast-v7-source-normalization-1', 'bodycast-physiology-daily-runtime-v7-1', 'bodycast-physiology-range-rebuild-v7-1', 'bodycast-physiology-v7-rebuild-service-1', CURRENT_TIMESTAMP) ON CONFLICT ("profileId") DO UPDATE SET "staleFromDate" = CASE WHEN "PhysiologyV7Lifecycle"."staleFromDate" IS NULL THEN EXCLUDED."staleFromDate" ELSE LEAST("PhysiologyV7Lifecycle"."staleFromDate", EXCLUDED."staleFromDate") END, "currentThroughDate" = CASE WHEN "PhysiologyV7Lifecycle"."currentThroughDate" >= EXCLUDED."staleFromDate" THEN to_char((EXCLUDED."staleFromDate"::date - INTERVAL '1 day'), 'YYYY-MM-DD') ELSE "PhysiologyV7Lifecycle"."currentThroughDate" END, "invalidationGeneration" = "PhysiologyV7Lifecycle"."invalidationGeneration" + 1, "updatedAt" = CURRENT_TIMESTAMP; END; $function$`,
    "function:physiology_v7_workout_date(integer)": `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_workout_date(p_workout_id integer) RETURNS character varying LANGUAGE plpgsql AS $function$ DECLARE affected VARCHAR(10); BEGIN SELECT d."date" INTO affected FROM "Workout" w JOIN "DailyHealthData" d ON d."id" = w."dailyHealthDataId" WHERE w."id" = p_workout_id; RETURN affected; END; $function$`,
    "function:physiology_v7_workout_source_trigger()": V7_WORKOUT_SOURCE_TRIGGER_SIGNATURE,
    "function:physiology_v7_training_date(integer)": `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_training_date(p_session_id integer) RETURNS character varying LANGUAGE plpgsql AS $function$ DECLARE affected VARCHAR(10); BEGIN SELECT d."date" INTO affected FROM "StrengthDiarySession" s LEFT JOIN "Workout" w ON w."id" = s."matchedWorkoutId" LEFT JOIN "DailyHealthData" d ON d."id" = w."dailyHealthDataId" WHERE s."id" = p_session_id; IF affected IS NULL THEN SELECT MIN("date") INTO affected FROM "DailyHealthData"; END IF; RETURN affected; END; $function$`,
    "function:physiology_v7_session_source_trigger()": V7_SESSION_SOURCE_TRIGGER_SIGNATURE,
    "function:physiology_v7_session_child_source_trigger()": `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_session_child_source_trigger() RETURNS trigger LANGUAGE plpgsql AS $function$ DECLARE sid INTEGER; affected VARCHAR(10); pid INTEGER; BEGIN IF TG_TABLE_NAME = 'StrengthSessionExercise' THEN sid := COALESCE(NEW."sessionId", OLD."sessionId"); ELSE SELECT "sessionId" INTO sid FROM "StrengthSessionExercise" WHERE "id" = COALESCE(NEW."sessionExerciseId", OLD."sessionExerciseId"); END IF; SELECT "profileId" INTO pid FROM "StrengthDiarySession" WHERE "id" = sid; affected := physiology_v7_training_date(sid); PERFORM physiology_v7_invalidate(COALESCE(pid, 1), affected); RETURN COALESCE(NEW, OLD); END; $function$`,
    "trigger:StrengthDiarySession.StrengthDiarySession_v7_invalidate": "enabled=O|function=physiology_v7_session_source_trigger|definition=CREATE TRIGGER \"StrengthDiarySession_v7_invalidate\" AFTER INSERT OR DELETE OR UPDATE ON \"StrengthDiarySession\" FOR EACH ROW EXECUTE FUNCTION physiology_v7_session_source_trigger()",
    "trigger:StrengthSessionExercise.StrengthSessionExercise_v7_invalidate": "enabled=O|function=physiology_v7_session_child_source_trigger|definition=CREATE TRIGGER \"StrengthSessionExercise_v7_invalidate\" AFTER INSERT OR DELETE OR UPDATE ON \"StrengthSessionExercise\" FOR EACH ROW EXECUTE FUNCTION physiology_v7_session_child_source_trigger()",
    "trigger:StrengthSet.StrengthSet_v7_invalidate": "enabled=O|function=physiology_v7_session_child_source_trigger|definition=CREATE TRIGGER \"StrengthSet_v7_invalidate\" AFTER INSERT OR DELETE OR UPDATE ON \"StrengthSet\" FOR EACH ROW EXECUTE FUNCTION physiology_v7_session_child_source_trigger()",
    "trigger:Workout.Workout_v7_invalidate_insert_delete": V7_WORKOUT_INSERT_DELETE_TRIGGER_SIGNATURE,
    "trigger:Workout.Workout_v7_invalidate_update": V7_WORKOUT_UPDATE_TRIGGER_SIGNATURE,
  }),
  requiredObjectSignatureExcludes: Object.freeze({
    "function:physiology_v7_training_date(integer)": V4_TRAINING_DATE_SIGNATURE,
    "function:physiology_v7_session_source_trigger()": V4_SESSION_SOURCE_TRIGGER_SIGNATURE,
    "function:physiology_v7_session_child_source_trigger()": `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_session_child_source_trigger() RETURNS trigger LANGUAGE plpgsql AS $function$ DECLARE old_sid INTEGER; new_sid INTEGER; candidate_sid INTEGER; affected VARCHAR(10); pid INTEGER; session_status VARCHAR(20); BEGIN IF TG_TABLE_NAME = 'StrengthSessionExercise' THEN IF TG_OP <> 'INSERT' THEN old_sid := OLD."sessionId"; END IF; IF TG_OP <> 'DELETE' THEN new_sid := NEW."sessionId"; END IF; ELSE IF TG_OP <> 'INSERT' THEN SELECT "sessionId" INTO old_sid FROM "StrengthSessionExercise" WHERE "id" = OLD."sessionExerciseId"; END IF; IF TG_OP <> 'DELETE' THEN SELECT "sessionId" INTO new_sid FROM "StrengthSessionExercise" WHERE "id" = NEW."sessionExerciseId"; END IF; END IF; FOR candidate_sid IN SELECT DISTINCT candidate FROM unnest(ARRAY[old_sid, new_sid]) AS candidates(candidate) WHERE candidate IS NOT NULL LOOP SELECT "profileId", "status" INTO pid, session_status FROM "StrengthDiarySession" WHERE "id" = candidate_sid; IF session_status = 'COMPLETED' THEN affected := physiology_v7_training_date(candidate_sid); PERFORM physiology_v7_invalidate(COALESCE(pid, 1), affected); END IF; END LOOP; RETURN COALESCE(NEW, OLD); END; $function$`,
  }),
  postflightAbsentObjects: ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightAbsentObjects,
  postflightSignatureIncludes: Object.freeze({
    ...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightSignatureIncludes,
    "PhysiologyV7Lifecycle.unifiedPublicationBlockedFromDate": "character varying(10)|nullable=true|default=",
    "PhysiologyV7Lifecycle.unifiedPublicationBlockedSource": "character varying(20)|nullable=true|default=",
    "UnifiedPublicationBlock": "relkind=r",
    "UnifiedPublicationBlock.profileId": "integer|nullable=false|default=",
    "UnifiedPublicationBlock.source": "character varying(20)|nullable=false|default=",
    "UnifiedPublicationBlock.sourceKey": "character varying(100)|nullable=false|default=",
    "UnifiedPublicationBlock.fromDate": "character varying(10)|nullable=false|default=",
    "UnifiedPublicationBlock.revision": "integer|nullable=false|default=1",
    "UnifiedPublicationBlock.updatedAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
    "UnifiedPublicationBlock.createdAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
    "UnifiedPublicationBlock_pkey": "p|validated=true|table=\"UnifiedPublicationBlock\"|definition=PRIMARY KEY (\"profileId\", source, \"sourceKey\")",
    "UnifiedPublicationBlock_source_check": "c|validated=true|table=\"UnifiedPublicationBlock\"|definition=CHECK (source::text = ANY (ARRAY['health'::character varying, 'day'::character varying, 'training'::character varying, 'stepper'::character varying]::text[]))",
    "UnifiedPublicationBlock_sourceKey_check": "c|validated=true|table=\"UnifiedPublicationBlock\"|definition=CHECK (length(\"sourceKey\"::text) > 0)",
    "UnifiedPublicationBlock_profileId_fkey": "f|validated=true|table=\"UnifiedPublicationBlock\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE CASCADE",
    "UnifiedPublicationBlock_profileId_fromDate_idx": "unique=false|valid=true|definition=CREATE INDEX \"UnifiedPublicationBlock_profileId_fromDate_idx\" ON public.\"UnifiedPublicationBlock\" USING btree (\"profileId\", \"fromDate\")",
    "function:physiology_v7_invalidate(integer, character varying)": `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_invalidate(p_profile_id integer, p_date character varying) RETURNS void LANGUAGE plpgsql AS $function$ BEGIN IF p_date IS NULL THEN RETURN; END IF; INSERT INTO "PhysiologyV7Lifecycle" ("profileId", "staleFromDate", "invalidationGeneration", "stateVersion", "sourceNormalizationVersion", "dailyRuntimeVersion", "rangeRebuildVersion", "rebuildServiceVersion", "updatedAt") VALUES (p_profile_id, p_date, 1, 'bodycast-physiology-v7-state-v3', 'bodycast-v7-source-normalization-1', 'bodycast-physiology-daily-runtime-v7-1', 'bodycast-physiology-range-rebuild-v7-1', 'bodycast-physiology-v7-rebuild-service-1', CURRENT_TIMESTAMP) ON CONFLICT ("profileId") DO UPDATE SET "staleFromDate" = CASE WHEN "PhysiologyV7Lifecycle"."staleFromDate" IS NULL THEN EXCLUDED."staleFromDate" ELSE LEAST("PhysiologyV7Lifecycle"."staleFromDate", EXCLUDED."staleFromDate") END, "currentThroughDate" = CASE WHEN "PhysiologyV7Lifecycle"."currentThroughDate" >= EXCLUDED."staleFromDate" THEN to_char((EXCLUDED."staleFromDate"::date - INTERVAL '1 day'), 'YYYY-MM-DD') ELSE "PhysiologyV7Lifecycle"."currentThroughDate" END, "invalidationGeneration" = "PhysiologyV7Lifecycle"."invalidationGeneration" + 1, "updatedAt" = CURRENT_TIMESTAMP; END; $function$`,
    "function:physiology_v7_workout_date(integer)": `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_workout_date(p_workout_id integer) RETURNS character varying LANGUAGE plpgsql AS $function$ DECLARE affected VARCHAR(10); BEGIN SELECT d."date" INTO affected FROM "Workout" w JOIN "DailyHealthData" d ON d."id" = w."dailyHealthDataId" WHERE w."id" = p_workout_id; RETURN affected; END; $function$`,
    "function:physiology_v7_workout_source_trigger()": V7_WORKOUT_SOURCE_TRIGGER_SIGNATURE,
    "function:physiology_v7_training_date(integer)": V4_TRAINING_DATE_SIGNATURE,
    "function:physiology_v7_training_model_date(integer, integer, timestamp with time zone, timestamp with time zone, timestamp with time zone)": V4_TRAINING_MODEL_DATE_SIGNATURE,
    "function:physiology_v7_matched_workout_source_trigger()": V4_MATCHED_WORKOUT_TRIGGER_SIGNATURE,
    "function:physiology_v7_matched_workout_delete_trigger()": V4_MATCHED_WORKOUT_DELETE_TRIGGER_SIGNATURE,
    "function:physiology_v7_model_date(integer, timestamp with time zone)": V4_MODEL_DATE_SIGNATURE,
    "function:physiology_v7_session_source_trigger()": V4_SESSION_SOURCE_TRIGGER_SIGNATURE,
    "function:physiology_v7_session_child_source_trigger()": `definition=CREATE OR REPLACE FUNCTION public.physiology_v7_session_child_source_trigger() RETURNS trigger LANGUAGE plpgsql AS $function$ DECLARE old_sid INTEGER; new_sid INTEGER; candidate_sid INTEGER; affected VARCHAR(10); pid INTEGER; session_status VARCHAR(20); BEGIN IF TG_TABLE_NAME = 'StrengthSessionExercise' THEN IF TG_OP <> 'INSERT' THEN old_sid := OLD."sessionId"; END IF; IF TG_OP <> 'DELETE' THEN new_sid := NEW."sessionId"; END IF; ELSE IF TG_OP <> 'INSERT' THEN SELECT "sessionId" INTO old_sid FROM "StrengthSessionExercise" WHERE "id" = OLD."sessionExerciseId"; END IF; IF TG_OP <> 'DELETE' THEN SELECT "sessionId" INTO new_sid FROM "StrengthSessionExercise" WHERE "id" = NEW."sessionExerciseId"; END IF; END IF; FOR candidate_sid IN SELECT DISTINCT candidate FROM unnest(ARRAY[old_sid, new_sid]) AS candidates(candidate) WHERE candidate IS NOT NULL LOOP SELECT "profileId", "status" INTO pid, session_status FROM "StrengthDiarySession" WHERE "id" = candidate_sid; IF session_status = 'COMPLETED' THEN affected := physiology_v7_training_date(candidate_sid); PERFORM physiology_v7_invalidate(COALESCE(pid, 1), affected); END IF; END LOOP; RETURN COALESCE(NEW, OLD); END; $function$`,
    "trigger:StrengthDiarySession.StrengthDiarySession_v7_invalidate": "enabled=O|function=physiology_v7_session_source_trigger|definition=CREATE TRIGGER \"StrengthDiarySession_v7_invalidate\" AFTER INSERT OR DELETE OR UPDATE ON \"StrengthDiarySession\" FOR EACH ROW EXECUTE FUNCTION physiology_v7_session_source_trigger()",
    "trigger:StrengthSessionExercise.StrengthSessionExercise_v7_invalidate": "enabled=O|function=physiology_v7_session_child_source_trigger|definition=CREATE TRIGGER \"StrengthSessionExercise_v7_invalidate\" AFTER INSERT OR DELETE OR UPDATE ON \"StrengthSessionExercise\" FOR EACH ROW EXECUTE FUNCTION physiology_v7_session_child_source_trigger()",
    "trigger:StrengthSet.StrengthSet_v7_invalidate": "enabled=O|function=physiology_v7_session_child_source_trigger|definition=CREATE TRIGGER \"StrengthSet_v7_invalidate\" AFTER INSERT OR DELETE OR UPDATE ON \"StrengthSet\" FOR EACH ROW EXECUTE FUNCTION physiology_v7_session_child_source_trigger()",
    "trigger:Workout.Workout_v7_invalidate_insert_delete": V7_WORKOUT_INSERT_DELETE_TRIGGER_SIGNATURE,
    "trigger:Workout.Workout_v7_invalidate_update": V7_WORKOUT_UPDATE_TRIGGER_SIGNATURE,
    "trigger:Workout.Workout_v7_invalidate": V4_MATCHED_WORKOUT_TRIGGER_DDL_SIGNATURE,
    "trigger:Workout.Workout_v7_invalidate_matched_delete": V4_MATCHED_WORKOUT_DELETE_TRIGGER_DDL_SIGNATURE,
  }),
  partialObjects: Object.freeze(V7_REPUBLICATION_SCHEMA_OBJECTS.filter((name) => !name.startsWith("function:") && !name.startsWith("trigger:"))),
  postflightObjects: Object.freeze([...ACTIVE_ENERGY_UNIFIED_MANIFEST.postflightObjects, ...V7_REPUBLICATION_SCHEMA_OBJECTS]),
});

export const PRODUCTION_MIGRATION_MANIFESTS = Object.freeze({
  [ACTIVE_ENERGY_UNIFIED_MANIFEST.id]: ACTIVE_ENERGY_UNIFIED_MANIFEST,
  [V4_REPUBLICATION_MANIFEST.id]: V4_REPUBLICATION_MANIFEST,
});

export function getProductionMigrationManifest(id) {
  const manifest = PRODUCTION_MIGRATION_MANIFESTS[id];
  if (!manifest) throw new Error(`Unknown or unreviewed production migration manifest: ${String(id)}.`);
  return manifest;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
