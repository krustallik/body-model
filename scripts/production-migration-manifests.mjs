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

// This release is intentionally bound to the two independently reviewed SQL
// files present at the exact release SHA. Prisma migrate deploy applies the
// complete tree, so neither schema change can be omitted from this contract.
const DYNAMIC_WORKOUT_RELEASE_PREDECESSORS = Object.freeze([
  Object.freeze({ name: "20260821000000_init", sha256: "bd96389688adaceebf24b435c52dd784a4442b922460a826588e0ea9b0f7db3b" }),
  Object.freeze({ name: "20260821010000_apple_health_sync", sha256: "25bfefec0b883a7815e962fc423674f27277941b36bde6bf0d9fbcf6e9861106" }),
  Object.freeze({ name: "20260822090000_add_daily_walking_and_body_fat_metrics", sha256: "d6d8fc2892ee412903e6aeab05ab9a63bdb4a06d97d33e58329cde508b2c304d" }),
  Object.freeze({ name: "20260822100000_add_strength_training_minutes", sha256: "c65b18eabe6d25569e754f7683d5dbd5bbe120d012346465d7b312506b9dd6a6" }),
  Object.freeze({ name: "20260822130000_add_singleton_profile", sha256: "4de0cdf0fbdc870e23a9a89369ee1b547a0eb531fa7fee71bdfe05b97849c827" }),
  Object.freeze({ name: "20260823090000_add_sync_snapshots_and_work_intervals", sha256: "7dca6b35d02d6ecdcdef03e04e2f59a19b4e4d1d767afd610ded68bca6a377e5" }),
  Object.freeze({ name: "20260823093000_preserve_snapshots_when_daily_state_deleted", sha256: "efbad57250508eaadf5e753b174598074671fb2d10ff456e512cc02b0f654730" }),
  Object.freeze({ name: "20260823130000_add_model_episodes", sha256: "260d34f565f9130e36f965837e632579e600f2d7517b54c7d874b1ab9d87a8df" }),
  Object.freeze({ name: "20260823150000_add_nutrition_gap_provenance", sha256: "a946f1a2ffbd38fa45a3bfc0e23e3e6fd290cebce42cbb535812dcb859fce39d" }),
  Object.freeze({ name: "20260824090000_add_work_interval_break_minutes", sha256: "1e2c0d3b5bf18f878e47a5825aa0434973367a98b1095d459b1aa0f1d4bb7066" }),
  Object.freeze({ name: "20260824120000_add_model_unknown_intervals", sha256: "21b470712e9b287596c019ac4d60ae98a0de273e7cc1308b0b74fa1d17f21499" }),
  Object.freeze({ name: "20260824150000_add_model_recovery_runs", sha256: "01aee7d488fb2cd4052b444f5dff3bd1d924cf5e849af886a6b2b4ef21255a83" }),
  Object.freeze({ name: "20260824180000_add_profile_locale", sha256: "3fb58d63d2ffc2080f9a2c57e0276a6c5cbe07d16137343ce8611427436305b7" }),
  Object.freeze({ name: "20260916090000_add_v5_initialization_semantics", sha256: "bf8700534910b5e3e9e07dd2a6f990027568c5e2d8a8f0afb9bbc05725fd0a2d" }),
  Object.freeze({ name: "20260916120000_add_workout_active_energy_kcal", sha256: "7dcdc578041324369d47db3e67b57f603cba8218e2481afd1674150249065ec5" }),
  Object.freeze({ name: "20260916153000_add_workout_feed_observed", sha256: "46c64fea0fd06fa7f7bed55504c71410c9d9f8f3433f6d3b2cd025321864043e" }),
  Object.freeze({ name: "20260917090000_add_heart_rate_samples", sha256: "4c8a89c1049d4256a162368628c4c4304d0a31edf2d5010d6393049624341e91" }),
  Object.freeze({ name: "20260917093000_allow_cross_day_heart_rate_samples", sha256: "655f5b5893909d9f462017845ec1a5dc425f51195d9c2697b2575935d3b30b1d" }),
  Object.freeze({ name: "20260917110000_add_sleep_segments", sha256: "01a6b3dcfbccbaab485e178993adb10aa734c09ec6364d78d5530fd197e8c7f2" }),
  Object.freeze({ name: "20260917113000_sleep_segment_offsets", sha256: "260eebd3a27af249b60e7abd10a174c1ba5fe66f282036a5eca983252d2a0bc4" }),
  Object.freeze({ name: "20260917140000_durable_source_retention", sha256: "cd29fe20db8ddd55f815744bfb6c3335374dd0155e4552fa9a2caeabc37ea4b0" }),
  Object.freeze({ name: "20260917160000_strength_training_diary", sha256: "de144c11501708d47dcdb071a05a7efd72f27ebaacfe4a35027bfcd631aa2ba4" }),
  Object.freeze({ name: "20260917161000_exercise_catalog_seed_idempotent", sha256: "c1a2cbbb0830477c5b23728593e3d5a440a65b50c0e754340deabc72f9bf0aa6" }),
  Object.freeze({ name: "20260917170000_retrospective_training_diary", sha256: "58cedb35b15bdd1dc0e63d44a5bd9ac7a9efe8180bd7237b15290b8ad5895f85" }),
  Object.freeze({ name: "20260917180000_strength_set_comment", sha256: "3be989fd9c0a1d9ad9cc11bcedeb8f5b6dc29f6d67363da9bf02a085ce5f320c" }),
  Object.freeze({ name: "20260917190000_add_stepper_equipment_assignments", sha256: "eaca44077106632136944732c794427fcf56f28e750738efec6ed69b97aaeb90" }),
  Object.freeze({ name: "20260917200000_add_exercise_catalog_stable_key", sha256: "1af185c5ef0eb225d5fed743362e885c5b3f9bdf07580815bf888e74d6127287" }),
  Object.freeze({ name: "20260917210000_strength_set_rir", sha256: "ded051aa99d21febe2183eea8b2af05669c8c3da5a3791757c9ed89b6660105e" }),
  Object.freeze({ name: "20260918120000_add_v7_physiology_persistence", sha256: "69787020440020df13f89b85628c4cc2c8f83d457a856f42c5a7ba93d28c428a" }),
  Object.freeze({ name: "20260918130000_add_experimental_strength_energy_shadow", sha256: "6305b5346d242fd5fa9f49570ad22c61fb4e8e9eeccc61f7e7da23b576ec1f30" }),
  Object.freeze({ name: "20260918150000_add_physiology_v7_shadow_diagnostics", sha256: "3468018d49a7af95a7d829c43b8f8138c5b06c3891d0751af52494421dc4cef7" }),
  Object.freeze({ name: "20260918160000_add_fat_weight_shadow_v1", sha256: "9948e18370fea3beb2d125853f3304359ece7887b553e681c07d89be284e02ae" }),
  Object.freeze({ name: "20260918190000_add_experimental_strength_glycogen_demand_shadow", sha256: "332cd05032fbcea62f11e1bf970fbb1cb82999428b7171964043c1b3a07b74f4" }),
  Object.freeze({ name: "20260918193000_add_experimental_transient_exercise_water_shadow", sha256: "b0de48a1e2078fb02b1ce8b39196d9315d51cd898b765bd7ceca4946d9f68160" }),
  Object.freeze({ name: "20260918194500_add_experimental_stepper_active_energy_shadow", sha256: "b73e2bf7208217df498f36b83393b71108899d88d1177f30093404aeaab4f013" }),
  Object.freeze({ name: "20260918200000_add_experimental_stepper_glycogen_demand_shadow", sha256: "64fe49ea98cd12dd8331fc743e36491c5ee1d8ea93eec31947e21469af56b8e7" }),
  Object.freeze({ name: "20260918201500_add_experimental_glycogen_repletion_shadow", sha256: "de54fb28cf07de1436aaea3c00c7f667cfdf43106e2dbe2fe8ea6ad549b38dba" }),
  Object.freeze({ name: "20260918203000_add_experimental_glycogen_associated_water_shadow", sha256: "cc1c405a59aed67edbabba72547656e55ed88ff22a2c73a11942d40c94a4c488" }),
  Object.freeze({ name: "20260918204500_add_experimental_glycogen_state_shadow", sha256: "e212aae2e6e9e732bffae7ae1217284deb2763fd3fee97919a6072e49cf0bbf8" }),
  Object.freeze({ name: "20260918210000_add_experimental_fat_weight_uncertainty_shadow", sha256: "1f8e329f9b504f75427150985d42632f95223eae8822edf3e1eb15e0a77adcf6" }),
  Object.freeze({ name: "20260918211500_add_experimental_skeletal_muscle_delta_shadow", sha256: "c0106ae5e4978eda30aaf35c6557badbbf6ba5f3ab863366b68e58b52e1fc0ab" }),
  Object.freeze({ name: "20260918223000_add_experimental_local_hypertrophy_response_shadow", sha256: "015ff140ca57d9a924111dae072f9dd61a464150e464cc6f8acf422877b25328" }),
  Object.freeze({ name: "20260918224500_add_experimental_cessation_detraining_shadow", sha256: "e8d2346c5d3f14beddfc857763939cd24c229902e15a54dec8ae1dbb3a7e612e" }),
  Object.freeze({ name: "20260918231500_add_experimental_ffm_retention_shadow", sha256: "4678ba422a318cc366847213fa2e71df1469bc2d90d47ea89eca5495b54f2ce3" }),
  Object.freeze({ name: "20260919163000_add_health_activity_intervals", sha256: "19cfa44c3e5f2c3ba9e775cd89b80cb3cc0c116340f8e22a9931d1cb7fcee2c9" }),
  Object.freeze({ name: "20260919170000_add_health_sync_audit", sha256: "8e5318628e97c4d1c49e347280c27bc857eae036c714d22dd4d275d30d3285cf" }),
  Object.freeze({ name: "20260920110000_add_health_metric_samples", sha256: "e073dc07b016fd13b58d45000b48a6f664153703282e45d147d8f20f40126b75" }),
  Object.freeze({ name: "20260920113000_dedupe_health_metric_samples_by_timestamp", sha256: "eff439dccc6c7eaa4d0d123439daaa3b10fde2b05b2d9c20d1e5343284a21d98" }),
  Object.freeze({ name: "20260920190000_add_pull_up_exercise_catalog", sha256: "198395b05a4272582544ae6e28ceb014d5cc982dfeb5ae8392609ed3a5f3d18b" }),
  Object.freeze({ name: "20260921140000_fix_v7_stale_suffix_lifecycle", sha256: "d90fa8d62098d88c24fcb66f3fba3d684f8c9ed07979fe0bda3037907281e5de" }),
  Object.freeze({ name: "20260922120000_add_unified_experimental_physiology_state", sha256: "4c35baa6b6ff4da967828c666284dae8d36cfc69c1d9a0039623dfae5e1203e8" }),
  Object.freeze({ name: "20260922140000_add_profile_auto_advance_exercises", sha256: "fbf7e41789c403710f34b1b802be4250159b380543d33c1887317db6187ee875" }),
  Object.freeze({ name: "20260924120000_protect_user_managed_workouts", sha256: "da986df7e3a12882ea0bc6b6c706ef16aecb1ac8a456954f2ee0d0d9f789da0a" }),
  Object.freeze({ name: "20260926190000_energy_distance_additive", sha256: "a1e09f1260517d8912b33d434f28b731bdc82aab9a7d00e921c0a52105fe0c7f" }),
  Object.freeze({ name: "20260927120000_energy_distance_constraints", sha256: "2db1824cfbf262aaec8670cad3aa839e8bfb2e9f7458d9a950fde45f1c4801cc" }),
  Object.freeze({ name: "20260929170000_training_load_accounting_v1", sha256: "d90a7cac525eb221ba2436c23043b6a515914d02205af47343b96337771d7f5b" }),
  Object.freeze({ name: "20260929190000_persist_strength_accounting_v1", sha256: "b33ea8679866972ac4964b6d7de92e74a237271ec25951b04e5541e12d5b8913" }),
  Object.freeze({ name: "20261002100000_active_energy_canonical_resolution", sha256: "45711a527d809775a5ce66d3d9e529954158dcb65ed0065f70a0f948a4693a0b" }),
  Object.freeze({ name: "20261002150000_add_production_publication_generation", sha256: "9f1e38182dc3ec2449da5297786b603d8c0370498ed68db97059f640220bbbd7" }),
  Object.freeze({ name: "20261003120000_add_episode_aware_unified_experimental_physiology_v2", sha256: "0bb495d988ead0c1729f8e657b85f85bc4c20673fdedd5b61a7644cb0dcaf9b6" }),
  Object.freeze({ name: "20261005120000_episode_relative_muscle_core", sha256: "afef76464e4e77e6fd13a6ed6f8b04a6972d98229e3c5fc12a7e7dd8e3fd6588" }),
  Object.freeze({ name: "20261006110000_relative_muscle_legacy_identity", sha256: "56d8a64d4c966428835a96058783d01c4eac5984f8ed51928d26b13d6290208e" }),
  Object.freeze({ name: "20261006130000_unified_v4_glycogen_water_rollout", sha256: "9e50a8f33ec93e5f7d74681a611bd7272038f7e5e25563054f4a4dbb093b5408" }),
  Object.freeze({ name: "20261011120000_unified_publication_failure_fence", sha256: "b122658704a2ca7dac3d5de6e3e1b196d04027078d899d0b8e6079bf0a4397bc" }),
  Object.freeze({ name: "20261011130000_only_completed_training_invalidates_v7", sha256: "d37185c4d9c681bcf2e387d343cad2501f75c1d33916b5e4822eba8a9635a2b8" }),
]);
const DYNAMIC_WORKOUT_RELEASE_OBJECTS = Object.freeze([
  "StrengthDiarySession.programId", "StrengthDiarySession.programVersionId",
  "StrengthDiarySession_programId_fkey", "StrengthDiarySession_programVersionId_fkey", "StrengthDiarySession_program_pair_check",
  "HealthSyncRefreshJob", "HealthSyncRefreshJob.profileId", "HealthSyncRefreshJob.requestedGeneration",
  "HealthSyncRefreshJob.completedGeneration", "HealthSyncRefreshJob.fromDate", "HealthSyncRefreshJob.toDate",
  "HealthSyncRefreshJob.sourceDates", "HealthSyncRefreshJob.weightSourceChangedDates", "HealthSyncRefreshJob.leaseToken",
  "HealthSyncRefreshJob.leaseUntil", "HealthSyncRefreshJob.nextAttemptAt", "HealthSyncRefreshJob.attemptCount",
  "HealthSyncRefreshJob.lastAttemptAt", "HealthSyncRefreshJob.lastErrorType", "HealthSyncRefreshJob.lastErrorAt",
  "HealthSyncRefreshJob.createdAt", "HealthSyncRefreshJob.updatedAt", "HealthSyncRefreshJob_pkey",
  "HealthSyncRefreshJob_profileId_fkey", "HealthSyncRefreshJob_nextAttemptAt_leaseUntil_idx",
]);
export const DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST = Object.freeze({
  id: "programless-workouts-health-sync-v1",
  cutbackSupported: true,
  requireCompleteReleaseTree: true,
  migrations: Object.freeze([
    Object.freeze({ name: "20261015090000_programless_dynamic_sessions", sha256: "4e63b16fbb2950666489c591cc6586ba9a35a0c0a1ed595a51309c37786f9b49" }),
    Object.freeze({ name: "20261015100000_health_sync_durable_refresh_queue", sha256: "6e07af8484ee10cda3cea5f06db19ec1286cb41ff40da8c05166c3cf7d90c991" }),
  ]),
  requiredAppliedMigrations: DYNAMIC_WORKOUT_RELEASE_PREDECESSORS,
  requiredTablesBefore: Object.freeze([...V4_REPUBLICATION_MANIFEST.requiredTablesBefore, "StrengthDiarySession"]),
  requiredObjectsBefore: Object.freeze([
    ...V4_REPUBLICATION_MANIFEST.postflightObjects,
    "StrengthDiarySession.programId", "StrengthDiarySession.programVersionId",
    "StrengthDiarySession_programId_fkey", "StrengthDiarySession_programVersionId_fkey",
  ]),
  requiredObjectSignatureIncludes: Object.freeze({
    ...V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes,
    "StrengthDiarySession.programId": "integer|nullable=false|default=",
    "StrengthDiarySession.programVersionId": "integer|nullable=false|default=",
    "StrengthDiarySession_programId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"programId\") REFERENCES \"TrainingProgram\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
    "StrengthDiarySession_programVersionId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"programVersionId\") REFERENCES \"TrainingProgramVersion\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  }),
  requiredObjectSignatureEquals: Object.freeze({
    "StrengthDiarySession.programId": "integer|nullable=false|default=",
    "StrengthDiarySession.programVersionId": "integer|nullable=false|default=",
    "StrengthDiarySession_programId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"programId\") REFERENCES \"TrainingProgram\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
    "StrengthDiarySession_programVersionId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"programVersionId\") REFERENCES \"TrainingProgramVersion\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  }),
  partialObjects: Object.freeze([
    ...DYNAMIC_WORKOUT_RELEASE_OBJECTS.filter((name) => name !== "StrengthDiarySession.programId"
      && name !== "StrengthDiarySession.programVersionId" && !name.endsWith("_fkey")),
  ]),
  requiredAbsentObjectsBefore: Object.freeze([
    ...DYNAMIC_WORKOUT_RELEASE_OBJECTS.filter((name) => name !== "StrengthDiarySession.programId"
      && name !== "StrengthDiarySession.programVersionId" && !name.endsWith("_fkey")),
  ]),
  postflightAbsentObjects: V4_REPUBLICATION_MANIFEST.postflightAbsentObjects,
  postflightSignatureIncludes: Object.freeze({
    ...V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes,
    "StrengthDiarySession.programId": "integer|nullable=true|default=",
    "StrengthDiarySession.programVersionId": "integer|nullable=true|default=",
    "StrengthDiarySession_programId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"programId\") REFERENCES \"TrainingProgram\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
    "StrengthDiarySession_programVersionId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"programVersionId\") REFERENCES \"TrainingProgramVersion\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
    "StrengthDiarySession_program_pair_check": "c|validated=true|table=\"StrengthDiarySession\"|definition=CHECK ((\"programId\" IS NULL) = (\"programVersionId\" IS NULL))",
    "HealthSyncRefreshJob": "relkind=r",
    "HealthSyncRefreshJob.profileId": "integer|nullable=false|default=1",
    "HealthSyncRefreshJob.requestedGeneration": "integer|nullable=false|default=0",
    "HealthSyncRefreshJob.completedGeneration": "integer|nullable=false|default=0",
    "HealthSyncRefreshJob.fromDate": "character varying(10)|nullable=true|default=",
    "HealthSyncRefreshJob.toDate": "character varying(10)|nullable=true|default=",
    "HealthSyncRefreshJob.sourceDates": "text[]|nullable=false|default=ARRAY[]::text[]",
    "HealthSyncRefreshJob.weightSourceChangedDates": "text[]|nullable=false|default=ARRAY[]::text[]",
    "HealthSyncRefreshJob.leaseToken": "character varying(36)|nullable=true|default=",
    "HealthSyncRefreshJob.leaseUntil": "timestamp(3) with time zone|nullable=true|default=",
    "HealthSyncRefreshJob.nextAttemptAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
    "HealthSyncRefreshJob.attemptCount": "integer|nullable=false|default=0",
    "HealthSyncRefreshJob.lastAttemptAt": "timestamp(3) with time zone|nullable=true|default=",
    "HealthSyncRefreshJob.lastErrorType": "character varying(100)|nullable=true|default=",
    "HealthSyncRefreshJob.lastErrorAt": "timestamp(3) with time zone|nullable=true|default=",
    "HealthSyncRefreshJob.createdAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
    "HealthSyncRefreshJob.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
    "HealthSyncRefreshJob_pkey": "p|validated=true|table=\"HealthSyncRefreshJob\"|definition=PRIMARY KEY (\"profileId\")",
    "HealthSyncRefreshJob_profileId_fkey": "f|validated=true|table=\"HealthSyncRefreshJob\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE CASCADE",
    "HealthSyncRefreshJob_nextAttemptAt_leaseUntil_idx": "unique=false|valid=true|definition=CREATE INDEX \"HealthSyncRefreshJob_nextAttemptAt_leaseUntil_idx\" ON public.\"HealthSyncRefreshJob\" USING btree (\"nextAttemptAt\", \"leaseUntil\")",
  }),
  postflightSignatureEquals: Object.freeze(Object.fromEntries(DYNAMIC_WORKOUT_RELEASE_OBJECTS.map((name) => [
    name, {
      ...V4_REPUBLICATION_MANIFEST.postflightSignatureIncludes,
      "StrengthDiarySession.programId": "integer|nullable=true|default=",
      "StrengthDiarySession.programVersionId": "integer|nullable=true|default=",
      "StrengthDiarySession_programId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"programId\") REFERENCES \"TrainingProgram\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
      "StrengthDiarySession_programVersionId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"programVersionId\") REFERENCES \"TrainingProgramVersion\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
      "StrengthDiarySession_program_pair_check": "c|validated=true|table=\"StrengthDiarySession\"|definition=CHECK ((\"programId\" IS NULL) = (\"programVersionId\" IS NULL))",
      "HealthSyncRefreshJob": "relkind=r",
      "HealthSyncRefreshJob.profileId": "integer|nullable=false|default=1",
      "HealthSyncRefreshJob.requestedGeneration": "integer|nullable=false|default=0",
      "HealthSyncRefreshJob.completedGeneration": "integer|nullable=false|default=0",
      "HealthSyncRefreshJob.fromDate": "character varying(10)|nullable=true|default=",
      "HealthSyncRefreshJob.toDate": "character varying(10)|nullable=true|default=",
      "HealthSyncRefreshJob.sourceDates": "text[]|nullable=false|default=ARRAY[]::text[]",
      "HealthSyncRefreshJob.weightSourceChangedDates": "text[]|nullable=false|default=ARRAY[]::text[]",
      "HealthSyncRefreshJob.leaseToken": "character varying(36)|nullable=true|default=",
      "HealthSyncRefreshJob.leaseUntil": "timestamp(3) with time zone|nullable=true|default=",
      "HealthSyncRefreshJob.nextAttemptAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
      "HealthSyncRefreshJob.attemptCount": "integer|nullable=false|default=0",
      "HealthSyncRefreshJob.lastAttemptAt": "timestamp(3) with time zone|nullable=true|default=",
      "HealthSyncRefreshJob.lastErrorType": "character varying(100)|nullable=true|default=",
      "HealthSyncRefreshJob.lastErrorAt": "timestamp(3) with time zone|nullable=true|default=",
      "HealthSyncRefreshJob.createdAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
      "HealthSyncRefreshJob.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
      "HealthSyncRefreshJob_pkey": "p|validated=true|table=\"HealthSyncRefreshJob\"|definition=PRIMARY KEY (\"profileId\")",
      "HealthSyncRefreshJob_profileId_fkey": "f|validated=true|table=\"HealthSyncRefreshJob\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE CASCADE",
      "HealthSyncRefreshJob_nextAttemptAt_leaseUntil_idx": "unique=false|valid=true|definition=CREATE INDEX \"HealthSyncRefreshJob_nextAttemptAt_leaseUntil_idx\" ON public.\"HealthSyncRefreshJob\" USING btree (\"nextAttemptAt\", \"leaseUntil\")",
    }[name],
  ]))),
  postflightObjects: Object.freeze([...V4_REPUBLICATION_MANIFEST.postflightObjects, ...DYNAMIC_WORKOUT_RELEASE_OBJECTS]),
});

const TRAINING_MUTATION_LEDGER_OBJECTS = Object.freeze([
  "TrainingRefreshJob", "TrainingRefreshJob.profileId", "TrainingRefreshJob.requestedGeneration",
  "TrainingRefreshJob.completedGeneration", "TrainingRefreshJob.dueAt", "TrainingRefreshJob.dirtyFromDate",
  "TrainingRefreshJob.dirtyToDate", "TrainingRefreshJob.affectedSessionIds", "TrainingRefreshJob.leaseToken",
  "TrainingRefreshJob.leaseUntil", "TrainingRefreshJob.nextAttemptAt", "TrainingRefreshJob.attemptCount",
  "TrainingRefreshJob.lastAttemptAt", "TrainingRefreshJob.lastErrorType", "TrainingRefreshJob.lastErrorAt",
  "TrainingRefreshJob.lastProgressStage", "TrainingRefreshJob.lastProgressAt", "TrainingRefreshJob.createdAt",
  "TrainingRefreshJob.updatedAt", "TrainingRefreshJob_pkey", "TrainingRefreshJob_profileId_fkey",
  "TrainingRefreshJob_generation_check", "TrainingRefreshJob_attemptCount_check",
  "TrainingRefreshJob_dueAt_nextAttemptAt_leaseUntil_idx", "TrainingRefreshJob_requestedGeneration_completedGeneration_idx",
  "TrainingSourceChange", "TrainingSourceChange.sourceChangeId", "TrainingSourceChange.profileId",
  "TrainingSourceChange.generation", "TrainingSourceChange.operationKind", "TrainingSourceChange.schemaVersion",
  "TrainingSourceChange.evidenceComplete", "TrainingSourceChange.affectedSessionIds",
  "TrainingSourceChange.affectedExerciseIds", "TrainingSourceChange.affectedSetIds",
  "TrainingSourceChange.publicationBlockSourceKeys",
  "TrainingSourceChange.oldSourceIdentity", "TrainingSourceChange.newSourceIdentity",
  "TrainingSourceChange.oldEventInstants", "TrainingSourceChange.newEventInstants",
  "TrainingSourceChange.oldModelDates", "TrainingSourceChange.newModelDates", "TrainingSourceChange.createdAt",
  "TrainingSourceChange.acknowledgedAt", "TrainingSourceChange_pkey", "TrainingSourceChange_profileId_fkey",
  "TrainingSourceChange_generation_check", "TrainingSourceChange_schemaVersion_check",
  "TrainingSourceChange_profileId_generation_acknowledgedAt_idx", "TrainingSourceChange_profileId_createdAt_idx",
  "TrainingSourceChange.affectedWorkoutIds",
  "TrainingSetCreateOperation", "TrainingSetCreateOperation.profileId", "TrainingSetCreateOperation.operationId",
  "TrainingSetCreateOperation.payloadVersion", "TrainingSetCreateOperation.payloadDigest",
  "TrainingSetCreateOperation.sessionId", "TrainingSetCreateOperation.exerciseId",
  "TrainingSetCreateOperation.canonicalSetId", "TrainingSetCreateOperation.state",
  "TrainingSetCreateOperation.createdAt", "TrainingSetCreateOperation.updatedAt",
  "TrainingSetCreateOperation_pkey", "TrainingSetCreateOperation_profileId_fkey",
  "TrainingSetCreateOperation_state_check", "TrainingSetCreateOperation_payloadVersion_check",
  "TrainingSetCreateOperation_target_check", "TrainingSetCreateOperation_result_check",
  "TrainingSetCreateOperation_profileId_sessionId_state_idx", "TrainingSetCreateOperation_profileId_canonicalSetId_idx",
  "StepperCreateOperation", "StepperCreateOperation.profileId", "StepperCreateOperation.operationId",
  "StepperCreateOperation.payloadVersion", "StepperCreateOperation.payloadDigest", "StepperCreateOperation.workoutId",
  "StepperCreateOperation.state", "StepperCreateOperation.createdAt", "StepperCreateOperation.updatedAt",
  "StepperCreateOperation_pkey", "StepperCreateOperation_profileId_fkey", "StepperCreateOperation_payloadVersion_check",
  "StepperCreateOperation_state_check", "StepperCreateOperation_result_check", "StepperCreateOperation_profileId_workoutId_idx",
  "UnifiedPublicationBlock.ownerToken", "UnifiedPublicationBlock.ownerLeaseUntil",
  "UnifiedPublicationBlock_ownerLeaseUntil_idx",
]);

const TRAINING_MUTATION_LEDGER_OBJECT_SIGNATURES = Object.freeze({
  "TrainingRefreshJob": "relkind=r",
  "TrainingRefreshJob.profileId": "integer|nullable=false|default=",
  "TrainingRefreshJob.requestedGeneration": "integer|nullable=false|default=0",
  "TrainingRefreshJob.completedGeneration": "integer|nullable=false|default=0",
  "TrainingRefreshJob.dueAt": "timestamp(3) with time zone|nullable=true|default=",
  "TrainingRefreshJob.dirtyFromDate": "character varying(10)|nullable=true|default=",
  "TrainingRefreshJob.dirtyToDate": "character varying(10)|nullable=true|default=",
  "TrainingRefreshJob.affectedSessionIds": "integer[]|nullable=false|default=ARRAY[]::integer[]",
  "TrainingRefreshJob.leaseToken": "character varying(36)|nullable=true|default=",
  "TrainingRefreshJob.leaseUntil": "timestamp(3) with time zone|nullable=true|default=",
  "TrainingRefreshJob.nextAttemptAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "TrainingRefreshJob.attemptCount": "integer|nullable=false|default=0",
  "TrainingRefreshJob.lastAttemptAt": "timestamp(3) with time zone|nullable=true|default=",
  "TrainingRefreshJob.lastErrorType": "character varying(100)|nullable=true|default=",
  "TrainingRefreshJob.lastErrorAt": "timestamp(3) with time zone|nullable=true|default=",
  "TrainingRefreshJob.lastProgressStage": "character varying(80)|nullable=true|default=",
  "TrainingRefreshJob.lastProgressAt": "timestamp(3) with time zone|nullable=true|default=",
  "TrainingRefreshJob.createdAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "TrainingRefreshJob.updatedAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "TrainingRefreshJob_pkey": "p|validated=true|table=\"TrainingRefreshJob\"|definition=PRIMARY KEY (\"profileId\")",
  "TrainingRefreshJob_profileId_fkey": "f|validated=true|table=\"TrainingRefreshJob\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE CASCADE",
  "TrainingRefreshJob_generation_check": "c|validated=true|table=\"TrainingRefreshJob\"|definition=CHECK (\"requestedGeneration\" >= 0 AND \"completedGeneration\" >= 0 AND \"completedGeneration\" <= \"requestedGeneration\")",
  "TrainingRefreshJob_attemptCount_check": "c|validated=true|table=\"TrainingRefreshJob\"|definition=CHECK (\"attemptCount\" >= 0)",
  "TrainingRefreshJob_dueAt_nextAttemptAt_leaseUntil_idx": "unique=false|valid=true|definition=CREATE INDEX \"TrainingRefreshJob_dueAt_nextAttemptAt_leaseUntil_idx\" ON public.\"TrainingRefreshJob\" USING btree (\"dueAt\", \"nextAttemptAt\", \"leaseUntil\")",
  "TrainingRefreshJob_requestedGeneration_completedGeneration_idx": "unique=false|valid=true|definition=CREATE INDEX \"TrainingRefreshJob_requestedGeneration_completedGeneration_idx\" ON public.\"TrainingRefreshJob\" USING btree (\"requestedGeneration\", \"completedGeneration\")",
  "TrainingSourceChange": "relkind=r",
  "TrainingSourceChange.sourceChangeId": "character varying(36)|nullable=false|default=",
  "TrainingSourceChange.profileId": "integer|nullable=false|default=",
  "TrainingSourceChange.generation": "integer|nullable=false|default=",
  "TrainingSourceChange.operationKind": "character varying(50)|nullable=false|default=",
  "TrainingSourceChange.schemaVersion": "integer|nullable=false|default=1",
  "TrainingSourceChange.affectedWorkoutIds": "integer[]|nullable=false|default=ARRAY[]::integer[]",
  "TrainingSourceChange.evidenceComplete": "boolean|nullable=false|default=true",
  "TrainingSourceChange.affectedSessionIds": "integer[]|nullable=false|default=ARRAY[]::integer[]",
  "TrainingSourceChange.affectedExerciseIds": "integer[]|nullable=false|default=ARRAY[]::integer[]",
  "TrainingSourceChange.affectedSetIds": "integer[]|nullable=false|default=ARRAY[]::integer[]",
  "TrainingSourceChange.publicationBlockSourceKeys": "character varying(100)[]|nullable=false|default=(ARRAY[]::character varying[])::character varying(100)[]",
  "TrainingSourceChange.oldSourceIdentity": "jsonb|nullable=true|default=",
  "TrainingSourceChange.newSourceIdentity": "jsonb|nullable=true|default=",
  "TrainingSourceChange.oldEventInstants": "jsonb|nullable=true|default=",
  "TrainingSourceChange.newEventInstants": "jsonb|nullable=true|default=",
  "TrainingSourceChange.oldModelDates": "character varying(10)[]|nullable=false|default=(ARRAY[]::character varying[])::character varying(10)[]",
  "TrainingSourceChange.newModelDates": "character varying(10)[]|nullable=false|default=(ARRAY[]::character varying[])::character varying(10)[]",
  "TrainingSourceChange.createdAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "TrainingSourceChange.acknowledgedAt": "timestamp(3) with time zone|nullable=true|default=",
  "TrainingSourceChange_pkey": "p|validated=true|table=\"TrainingSourceChange\"|definition=PRIMARY KEY (\"sourceChangeId\")",
  "TrainingSourceChange_profileId_fkey": "f|validated=true|table=\"TrainingSourceChange\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "TrainingSourceChange_generation_check": "c|validated=true|table=\"TrainingSourceChange\"|definition=CHECK (generation > 0)",
  "TrainingSourceChange_schemaVersion_check": "c|validated=true|table=\"TrainingSourceChange\"|definition=CHECK (\"schemaVersion\" > 0)",
  "TrainingSourceChange_profileId_generation_acknowledgedAt_idx": "unique=false|valid=true|definition=CREATE INDEX \"TrainingSourceChange_profileId_generation_acknowledgedAt_idx\" ON public.\"TrainingSourceChange\" USING btree (\"profileId\", generation, \"acknowledgedAt\")",
  "TrainingSourceChange_profileId_createdAt_idx": "unique=false|valid=true|definition=CREATE INDEX \"TrainingSourceChange_profileId_createdAt_idx\" ON public.\"TrainingSourceChange\" USING btree (\"profileId\", \"createdAt\")",
  "TrainingSetCreateOperation": "relkind=r",
  "TrainingSetCreateOperation.profileId": "integer|nullable=false|default=",
  "TrainingSetCreateOperation.operationId": "character varying(36)|nullable=false|default=",
  "TrainingSetCreateOperation.payloadVersion": "integer|nullable=false|default=1",
  "TrainingSetCreateOperation.payloadDigest": "character varying(64)|nullable=false|default=",
  "TrainingSetCreateOperation.sessionId": "integer|nullable=false|default=",
  "TrainingSetCreateOperation.exerciseId": "integer|nullable=false|default=",
  "TrainingSetCreateOperation.canonicalSetId": "integer|nullable=true|default=",
  "TrainingSetCreateOperation.state": "character varying(16)|nullable=false|default='PENDING'::character varying",
  "TrainingSetCreateOperation.createdAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "TrainingSetCreateOperation.updatedAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "TrainingSetCreateOperation_pkey": "p|validated=true|table=\"TrainingSetCreateOperation\"|definition=PRIMARY KEY (\"profileId\", \"operationId\")",
  "TrainingSetCreateOperation_profileId_fkey": "f|validated=true|table=\"TrainingSetCreateOperation\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "TrainingSetCreateOperation_state_check": "c|validated=true|table=\"TrainingSetCreateOperation\"|definition=CHECK (state::text = ANY (ARRAY['PENDING'::character varying, 'COMMITTED'::character varying, 'TOMBSTONED'::character varying, 'REJECTED'::character varying]::text[]))",
  "TrainingSetCreateOperation_payloadVersion_check": "c|validated=true|table=\"TrainingSetCreateOperation\"|definition=CHECK (\"payloadVersion\" = 1)",
  "TrainingSetCreateOperation_target_check": "c|validated=true|table=\"TrainingSetCreateOperation\"|definition=CHECK (\"sessionId\" > 0 AND \"exerciseId\" > 0)",
  "TrainingSetCreateOperation_result_check": "c|validated=true|table=\"TrainingSetCreateOperation\"|definition=CHECK ((state::text = ANY (ARRAY['PENDING'::character varying, 'REJECTED'::character varying]::text[])) AND \"canonicalSetId\" IS NULL OR (state::text = ANY (ARRAY['COMMITTED'::character varying, 'TOMBSTONED'::character varying]::text[])) AND \"canonicalSetId\" IS NOT NULL)",
  "TrainingSetCreateOperation_profileId_sessionId_state_idx": "unique=false|valid=true|definition=CREATE INDEX \"TrainingSetCreateOperation_profileId_sessionId_state_idx\" ON public.\"TrainingSetCreateOperation\" USING btree (\"profileId\", \"sessionId\", state)",
  "TrainingSetCreateOperation_profileId_canonicalSetId_idx": "unique=false|valid=true|definition=CREATE INDEX \"TrainingSetCreateOperation_profileId_canonicalSetId_idx\" ON public.\"TrainingSetCreateOperation\" USING btree (\"profileId\", \"canonicalSetId\")",
  "StepperCreateOperation": "relkind=r",
  "StepperCreateOperation.profileId": "integer|nullable=false|default=",
  "StepperCreateOperation.operationId": "character varying(36)|nullable=false|default=",
  "StepperCreateOperation.payloadVersion": "integer|nullable=false|default=1",
  "StepperCreateOperation.payloadDigest": "character varying(64)|nullable=false|default=",
  "StepperCreateOperation.workoutId": "integer|nullable=true|default=",
  "StepperCreateOperation.state": "character varying(16)|nullable=false|default='PENDING'::character varying",
  "StepperCreateOperation.createdAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "StepperCreateOperation.updatedAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "StepperCreateOperation_pkey": "p|validated=true|table=\"StepperCreateOperation\"|definition=PRIMARY KEY (\"profileId\", \"operationId\")",
  "StepperCreateOperation_profileId_fkey": "f|validated=true|table=\"StepperCreateOperation\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StepperCreateOperation_payloadVersion_check": "c|validated=true|table=\"StepperCreateOperation\"|definition=CHECK ((\"payloadVersion\" = 1))",
  "StepperCreateOperation_state_check": "c|validated=true|table=\"StepperCreateOperation\"|definition=CHECK (((state)::text = ANY ((ARRAY['PENDING'::character varying, 'COMMITTED'::character varying, 'TOMBSTONED'::character varying])::text[])))",
  "StepperCreateOperation_result_check": "c|validated=true|table=\"StepperCreateOperation\"|definition=CHECK (((((state)::text = 'PENDING'::text) AND (\"workoutId\" IS NULL)) OR (((state)::text = ANY ((ARRAY['COMMITTED'::character varying, 'TOMBSTONED'::character varying])::text[])) AND (\"workoutId\" IS NOT NULL))))",
  "StepperCreateOperation_profileId_workoutId_idx": "unique=false|valid=true|definition=CREATE INDEX \"StepperCreateOperation_profileId_workoutId_idx\" ON public.\"StepperCreateOperation\" USING btree (\"profileId\", \"workoutId\")",
  "UnifiedPublicationBlock.ownerToken": "character varying(36)|nullable=true|default=",
  "UnifiedPublicationBlock.ownerLeaseUntil": "timestamp(3) with time zone|nullable=true|default=",
  "UnifiedPublicationBlock_ownerLeaseUntil_idx": "unique=false|valid=true|definition=CREATE INDEX \"UnifiedPublicationBlock_ownerLeaseUntil_idx\" ON public.\"UnifiedPublicationBlock\" USING btree (source, \"ownerLeaseUntil\")",
});

const TRAINING_MUTATION_LEDGER_PREDECESSORS = DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredAppliedMigrations;
const TRAINING_MUTATION_LEDGER_MIGRATIONS = Object.freeze([
  ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.migrations,
  Object.freeze({ name: "20261016120000_training_mutation_ledger_queue", sha256: "1d6d2ba9fba560b651ea0d6770e64ed497a9a331501b90fe61bff33522134461" }),
  Object.freeze({ name: "20261016130000_training_rejected_set_create_operations", sha256: "93866e7d74a39d76a9b9517530d9e561b2bb60599db8b996058f5df4df87434a" }),
  Object.freeze({ name: "20261016140000_training_refresh_publication_block_keys", sha256: "cdb7f5a07966e8a26ce6938f45735bb9af1b526319e7b94beb1c08b57efbd01b" }),
  Object.freeze({ name: "20261017120000_add_five_training_exercises", sha256: "8e12d1f6ddcd3b32be4df7a9e4852ba803a44e4094faaebf3d7a7026f5739166" }),
  Object.freeze({ name: "20261017130000_stepper_operation_recovery", sha256: "71e6028c6e0630eb18e9f231027e7b4a55c20fc50b20bce4a3f91757009c3bbf" }),
  Object.freeze({ name: "20261017140000_active_energy_convergence_fence", sha256: "65e0784e6bbfa85fee3041aa0adef690fa712614280365f25357a324d0944d43" }),
  Object.freeze({ name: "20261017150000_active_energy_convergence_owner_lease", sha256: "5316ae90ffbce62adee0cf5a735b0315cf8f1666983f211e3ba4b255effe5518" }),
]);

export const TRAINING_MUTATION_LEDGER_MANIFEST = Object.freeze({
  id: "training-mutation-ledger-refresh-queue-v1",
  cutbackSupported: false,
  requireCompleteReleaseTree: true,
  // Prisma deploy applies every pending directory in one run. Bind the
  // 65-schema baseline and all nine ordered targets in this one exact set.
  migrations: TRAINING_MUTATION_LEDGER_MIGRATIONS,
  requiredAppliedMigrations: TRAINING_MUTATION_LEDGER_PREDECESSORS,
  requiredTablesBefore: DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredTablesBefore,
  requiredObjectsBefore: DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredObjectsBefore,
  requiredObjectSignatureIncludes: DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredObjectSignatureIncludes,
  requiredObjectSignatureEquals: Object.freeze({
    ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredObjectSignatureEquals,
    "UnifiedPublicationBlock_source_check": "c|validated=true|table=\"UnifiedPublicationBlock\"|definition=CHECK (source::text = ANY (ARRAY['health'::character varying, 'day'::character varying, 'training'::character varying, 'stepper'::character varying]::text[]))",
  }),
  partialObjects: Object.freeze([
    ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.partialObjects,
    ...TRAINING_MUTATION_LEDGER_OBJECTS,
  ]),
  requiredAbsentObjectsBefore: Object.freeze([
    ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.requiredAbsentObjectsBefore,
    ...TRAINING_MUTATION_LEDGER_OBJECTS,
  ]),
  postflightAbsentObjects: DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.postflightAbsentObjects,
  postflightSignatureIncludes: Object.freeze({
    ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.postflightSignatureIncludes,
    "UnifiedPublicationBlock_source_check": "c|validated=true|table=\"UnifiedPublicationBlock\"|definition=CHECK (((source)::text = ANY ((ARRAY['health'::character varying, 'day'::character varying, 'training'::character varying, 'stepper'::character varying, 'active_energy'::character varying])::text[])))",
    ...TRAINING_MUTATION_LEDGER_OBJECT_SIGNATURES,
  }),
  postflightSignatureEquals: Object.freeze({
    ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.postflightSignatureEquals,
    "UnifiedPublicationBlock_source_check": "c|validated=true|table=\"UnifiedPublicationBlock\"|definition=CHECK (((source)::text = ANY ((ARRAY['health'::character varying, 'day'::character varying, 'training'::character varying, 'stepper'::character varying, 'active_energy'::character varying])::text[])))",
    ...TRAINING_MUTATION_LEDGER_OBJECT_SIGNATURES,
  }),
  postflightObjects: Object.freeze([
    ...DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.postflightObjects,
    ...TRAINING_MUTATION_LEDGER_OBJECTS,
  ]),
});


const AUTH_MULTIUSER_MIGRATION_BASELINE_SHA = "0f93f37dd6a4208cfc74331a0fb4c063c542c6bd";
const AUTH_MULTIUSER_MIGRATIONS = Object.freeze([
  {
    "name": "20261027120000_auth_multiuser",
    "sha256": "a7b9d5f162584e558193363c654b363dd9b46a3f1faeead099396d1d75b4a82c"
  },
  {
    "name": "20261028120000_scope_profile_constraints",
    "sha256": "80c995956c6eb4981709bba222ad57a17cb7ccdbf6e25260185b6cf4423d6c94"
  },
  {
    "name": "20261028130000_health_snapshot_fk_restrict",
    "sha256": "426ee69c646d307bfb34dc35ed63c152d615a1cfd2ca8fa3fcdd8c72fef7c671"
  }
].map(Object.freeze));
const AUTH_MULTIUSER_PREDECESSORS = Object.freeze([
  ...TRAINING_MUTATION_LEDGER_PREDECESSORS,
  ...TRAINING_MUTATION_LEDGER_MIGRATIONS,
]);
const AUTH_MULTIUSER_POSTFLIGHT_OBJECTS = Object.freeze([
  "Account",
  "Account.accessToken",
  "Account.accessTokenExpiresAt",
  "Account.accountId",
  "Account.createdAt",
  "Account.id",
  "Account.idToken",
  "Account.password",
  "Account.providerId",
  "Account.refreshToken",
  "Account.refreshTokenExpiresAt",
  "Account.scope",
  "Account.updatedAt",
  "Account.userId",
  "Account_pkey",
  "Account_userId_fkey",
  "Account_userId_idx",
  "ActivationRollbackEntry.profileId",
  "ActivationRollbackEntry_profileId_fkey",
  "ActiveEnergyCandidate.profileId",
  "ActiveEnergyCandidate_profileId_eventId_createdAt_idx",
  "ActiveEnergyCandidate_profileId_eventId_fkey",
  "ActiveEnergyCandidate_profileId_eventId_source_sourceIdenti_key",
  "ActiveEnergyCandidate_profileId_fkey",
  "ActiveEnergyCanonicalEvent.profileId",
  "ActiveEnergyCanonicalEvent_profileId_fkey",
  "ActiveEnergyCanonicalEvent_profileId_id_key",
  "ActiveEnergyCanonicalEvent_profileId_logicalEventKey_key",
  "ActiveEnergyCanonicalEvent_profileId_modelDate_idx",
  "ActiveEnergyCanonicalEvent_profileId_occurrenceAt_idx",
  "ActiveEnergyCanonicalEvent_profileId_supersededByEventId_fkey",
  "ActiveEnergyCanonicalEvent_supersededByEventId_idx",
  "ActiveEnergyEventAlias_eventId_idx",
  "ActiveEnergyEventAlias_profileId_eventId_fkey",
  "ActiveEnergyEventAlias_profileId_fkey",
  "ActiveEnergyEventAlias_profileId_sourceType_sourceId_key",
  "ActiveEnergyEventAlias_profileId_workoutId_fkey",
  "ActiveEnergyResolutionRevision.profileId",
  "ActiveEnergyResolutionRevision_profileId_eventId_fkey",
  "ActiveEnergyResolutionRevision_profileId_eventId_resolution_idx",
  "ActiveEnergyResolutionRevision_profileId_eventId_revision_key",
  "ActiveEnergyResolutionRevision_profileId_fkey",
  "AuthRateLimitBucket",
  "AuthRateLimitBucket.bucketKey",
  "AuthRateLimitBucket.hitCount",
  "AuthRateLimitBucket.windowStart",
  "AuthRateLimitBucket_pkey",
  "AuthRateLimitBucket_windowStart_idx",
  "DailyHealthData.profileId",
  "DailyHealthData_profileId_date_key",
  "DailyHealthData_profileId_fkey",
  "DailyHealthData_profileId_id_key",
  "ExerciseCatalog.profileId",
  "ExerciseCatalog.updatedAt",
  "ExerciseCatalog_profileId_currentLoadAccountingConfigId_fkey",
  "ExerciseCatalog_profileId_currentLoadAccountingConfigId_key",
  "ExerciseCatalog_profileId_fkey",
  "ExerciseCatalog_profileId_id_key",
  "ExerciseLoadConfiguration.profileId",
  "ExerciseLoadConfiguration_profileId_exerciseCatalogId_confi_key",
  "ExerciseLoadConfiguration_profileId_exerciseCatalogId_fkey",
  "ExerciseLoadConfiguration_profileId_fkey",
  "ExerciseLoadConfiguration_profileId_id_key",
  "ExperimentalCessationDetrainingShadow.profileId",
  "ExperimentalCessationDetrainingShadow_profileId_fkey",
  "ExperimentalFatWeightUncertaintyShadow.profileId",
  "ExperimentalFatWeightUncertaintyShadow_profileId_fkey",
  "ExperimentalFfmRetentionShadow.profileId",
  "ExperimentalFfmRetentionShadow_profileId_fkey",
  "ExperimentalGlycogenAssociatedWaterShadow.profileId",
  "ExperimentalGlycogenAssociatedWaterShadow_profileId_fkey",
  "ExperimentalGlycogenAssociatedWaterShadow_profileId_updated_idx",
  "ExperimentalGlycogenRepletionShadow.profileId",
  "ExperimentalGlycogenRepletionShadow_profileId_fkey",
  "ExperimentalGlycogenStateShadow.profileId",
  "ExperimentalGlycogenStateShadow_profileId_fkey",
  "ExperimentalLocalHypertrophyResponseShadow.profileId",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_fkey",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_update_idx",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_weekSt_key",
  "ExperimentalSkeletalMuscleDeltaShadow.profileId",
  "ExperimentalSkeletalMuscleDeltaShadow_profileId_fkey",
  "ExperimentalStepperActiveEnergyShadow.profileId",
  "ExperimentalStepperActiveEnergyShadow_profileId_fkey",
  "ExperimentalStepperActiveEnergyShadow_profileId_workoutId_fkey",
  "ExperimentalStepperActiveEnergyShadow_profileId_workoutId_key",
  "ExperimentalStepperGlycogenDemandShadow.profileId",
  "ExperimentalStepperGlycogenDemandShadow_profileId_fkey",
  "ExperimentalStepperGlycogenDemandShadow_profileId_workoutI_fkey",
  "ExperimentalStepperGlycogenDemandShadow_profileId_workoutId_key",
  "ExperimentalStrengthEnergyShadow.profileId",
  "ExperimentalStrengthEnergyShadow_profileId_fkey",
  "ExperimentalStrengthEnergyShadow_profileId_sessionId_fkey",
  "ExperimentalStrengthEnergyShadow_profileId_sessionId_key",
  "ExperimentalStrengthGlycogenDemandShadow.profileId",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_fkey",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_sessionI_key",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_session_fkey",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_updatedA_idx",
  "ExperimentalTransientExerciseWaterShadow.profileId",
  "ExperimentalTransientExerciseWaterShadow_profileId_fkey",
  "ExperimentalTransientExerciseWaterShadow_profileId_sessionI_key",
  "ExperimentalTransientExerciseWaterShadow_profileId_session_fkey",
  "ExperimentalTransientExerciseWaterShadow_profileId_updatedA_idx",
  "FatWeightShadowV1Result.profileId",
  "FatWeightShadowV1Result_profileId_fkey",
  "HealthActivityInterval.profileId",
  "HealthActivityInterval_profileId_fkey",
  "HealthActivityInterval_profileId_sourceFingerprint_key",
  "HealthMetricSample.profileId",
  "HealthMetricSample_profileId_dailyHealthDataId_fkey",
  "HealthMetricSample_profileId_fkey",
  "HealthMetricSample_profileId_metric_timestamp_key",
  "HealthSyncAudit.profileId",
  "HealthSyncAudit_profileId_fkey",
  "HealthSyncRefreshJob.profileId",
  "HealthSyncSnapshot.profileId",
  "HealthSyncSnapshot_profileId_dailyHealthDataId_fkey",
  "HealthSyncSnapshot_profileId_fkey",
  "HeartRateSample.profileId",
  "HeartRateSample_profileId_dailyHealthDataId_fkey",
  "HeartRateSample_profileId_fkey",
  "ModelEpisode.profileId",
  "ModelEpisode_profileId_id_key",
  "ModelEpisode_profileId_one_active_key",
  "ModelRecoveryRun_episodeId_algorithmVersion_seed_configFing_key",
  "PhysiologyV7DailyResult.profileId",
  "PhysiologyV7DailyResult_profileId_fkey",
  "PhysiologyV7Lifecycle_profileId_fkey",
  "PhysiologyV7ShadowDiagnostic.profileId",
  "PhysiologyV7ShadowDiagnostic_profileId_fkey",
  "Profile.dateOfBirth",
  "Profile.heightCm",
  "Profile.id",
  "Profile.sex",
  "Profile.userId",
  "ProfileApiKey",
  "ProfileApiKey.createdAt",
  "ProfileApiKey.id",
  "ProfileApiKey.lastUsedAt",
  "ProfileApiKey.lookupId",
  "ProfileApiKey.name",
  "ProfileApiKey.profileId",
  "ProfileApiKey.revokedAt",
  "ProfileApiKey.secretHash",
  "ProfileApiKey_lookupId_key",
  "ProfileApiKey_pkey",
  "ProfileApiKey_profileId_fkey",
  "ProfileApiKey_profileId_revokedAt_idx",
  "Profile_userId_fkey",
  "Profile_userId_key",
  "ProgramExercise.profileId",
  "ProgramExercise.updatedAt",
  "ProgramExercise_profileId_exerciseCatalogId_fkey",
  "ProgramExercise_profileId_fkey",
  "ProgramExercise_profileId_id_key",
  "ProgramExercise_profileId_programVersionId_fkey",
  "ProgramExercise_profileId_programVersionId_sortOrder_key",
  "RestingHeartRateSample.profileId",
  "RestingHeartRateSample_profileId_dailyHealthDataId_fkey",
  "RestingHeartRateSample_profileId_fkey",
  "Session",
  "Session.createdAt",
  "Session.expiresAt",
  "Session.id",
  "Session.ipAddress",
  "Session.token",
  "Session.updatedAt",
  "Session.userAgent",
  "Session.userId",
  "Session_pkey",
  "Session_token_key",
  "Session_userId_fkey",
  "Session_userId_idx",
  "SleepSegment.profileId",
  "SleepSegment_profileId_fkey",
  "StepperEquipmentAssignment.profileId",
  "StepperEquipmentAssignment_profileId_effectiveFrom_effectiv_idx",
  "StepperReconciliationCandidate.profileId",
  "StepperReconciliationCandidate_profileId_fkey",
  "StepperReconciliationCandidate_profileId_garminWorkoutId_fkey",
  "StepperReconciliationCandidate_profileId_garminWorkoutId_idx",
  "StepperReconciliationCandidate_profileId_groupId_fkey",
  "StepperReconciliationCandidate_profileId_groupId_idx",
  "StepperReconciliationCandidate_profileId_id_key",
  "StepperReconciliationCandidate_profileId_manualWorkoutId_fkey",
  "StepperReconciliationCandidate_profileId_manualWorkoutId_ga_key",
  "StepperReconciliationGroup.profileId",
  "StepperReconciliationGroup.updatedAt",
  "StepperReconciliationGroup_profileId_fkey",
  "StepperReconciliationGroup_profileId_id_key",
  "StepperReconciliationGroup_profileId_provisionalWorkoutId_fkey",
  "StrengthDiarySession.profileId",
  "StrengthDiarySession.updatedAt",
  "StrengthDiarySession_id_currentSnapshotRevision_key",
  "StrengthDiarySession_profileId_fkey",
  "StrengthDiarySession_profileId_id_key",
  "StrengthDiarySession_profileId_matchedWorkoutId_fkey",
  "StrengthDiarySession_profileId_matchedWorkoutId_key",
  "StrengthDiarySession_profileId_programId_fkey",
  "StrengthDiarySession_profileId_programVersionId_fkey",
  "StrengthSessionAccountingOperation.status",
  "StrengthSessionAccountingOperation_sessionId_idempotencyKey_key",
  "StrengthSessionAccountingOperation_sessionId_status_created_idx",
  "StrengthSessionAccountingSnapshot_sessionId_accountingInput_idx",
  "StrengthSessionAccountingSnapshot_sessionId_inputFingerprin_idx",
  "StrengthSessionAccountingSnapshot_sessionId_snapshotRevisio_key",
  "StrengthSessionExercise.profileId",
  "StrengthSessionExercise.updatedAt",
  "StrengthSessionExercise_profileId_fkey",
  "StrengthSessionExercise_profileId_id_key",
  "StrengthSessionExercise_profileId_sessionId_fkey",
  "StrengthSessionExercise_profileId_sourceExerciseCatalogId_fkey",
  "StrengthSet.updatedAt",
  "TrainingProgram.profileId",
  "TrainingProgram.updatedAt",
  "TrainingProgramVersion.profileId",
  "TrainingProgramVersion_profileId_fkey",
  "TrainingProgramVersion_profileId_id_key",
  "TrainingProgramVersion_profileId_programId_fkey",
  "TrainingProgramVersion_profileId_programId_versionNumber_key",
  "TrainingProgram_profileId_currentVersionId_fkey",
  "TrainingProgram_profileId_currentVersionId_key",
  "TrainingProgram_profileId_fkey",
  "TrainingProgram_profileId_id_key",
  "UnifiedExperimentalPhysiologyState.profileId",
  "UnifiedExperimentalPhysiologyState.updatedAt",
  "UnifiedExperimentalPhysiologyStateV2.profileId",
  "UnifiedExperimentalPhysiologyStateV2.updatedAt",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisod_fkey",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_idx",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_key",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelRevisio_idx",
  "UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatu_idx",
  "UnifiedExperimentalPhysiologyStateV2_profileId_resultFinger_idx",
  "UnifiedExperimentalPhysiologyState_profileId_modelRevision__idx",
  "UnifiedExperimentalPhysiologyState_profileId_qualityStatus__idx",
  "UnifiedExperimentalPhysiologyState_profileId_resultFingerpr_idx",
  "UnifiedPublicationBlock.updatedAt",
  "User",
  "User.createdAt",
  "User.email",
  "User.emailVerified",
  "User.id",
  "User.image",
  "User.name",
  "User.passwordChangeRequired",
  "User.updatedAt",
  "User_email_key",
  "User_pkey",
  "Verification",
  "Verification.createdAt",
  "Verification.expiresAt",
  "Verification.id",
  "Verification.identifier",
  "Verification.updatedAt",
  "Verification.value",
  "Verification_identifier_idx",
  "Verification_pkey",
  "WorkInterval.profileId",
  "WorkInterval_profileId_fkey",
  "Workout.profileId",
  "Workout_profileId_dailyHealthDataId_fkey",
  "Workout_profileId_dailyHealthDataId_sourceIdentity_key",
  "Workout_profileId_fkey",
  "Workout_profileId_id_key",
  "Workout_profileId_supersededByWorkoutId_fkey",
  "profile_id_seq"
]);
const AUTH_MULTIUSER_NEW_OBJECTS = Object.freeze([
  "Account",
  "Account_pkey",
  "Account_userId_fkey",
  "Account_userId_idx",
  "ActivationRollbackEntry.profileId",
  "ActivationRollbackEntry_profileId_fkey",
  "ActiveEnergyCandidate.profileId",
  "ActiveEnergyCandidate_profileId_eventId_createdAt_idx",
  "ActiveEnergyCandidate_profileId_eventId_fkey",
  "ActiveEnergyCandidate_profileId_eventId_source_sourceIdenti_key",
  "ActiveEnergyCandidate_profileId_fkey",
  "ActiveEnergyCanonicalEvent_profileId_fkey",
  "ActiveEnergyCanonicalEvent_profileId_id_key",
  "ActiveEnergyCanonicalEvent_profileId_logicalEventKey_key",
  "ActiveEnergyCanonicalEvent_profileId_modelDate_idx",
  "ActiveEnergyCanonicalEvent_profileId_occurrenceAt_idx",
  "ActiveEnergyCanonicalEvent_profileId_supersededByEventId_fkey",
  "ActiveEnergyCanonicalEvent_supersededByEventId_idx",
  "ActiveEnergyEventAlias_eventId_idx",
  "ActiveEnergyEventAlias_profileId_eventId_fkey",
  "ActiveEnergyEventAlias_profileId_fkey",
  "ActiveEnergyEventAlias_profileId_sourceType_sourceId_key",
  "ActiveEnergyEventAlias_profileId_workoutId_fkey",
  "ActiveEnergyResolutionRevision.profileId",
  "ActiveEnergyResolutionRevision_profileId_eventId_fkey",
  "ActiveEnergyResolutionRevision_profileId_eventId_resolution_idx",
  "ActiveEnergyResolutionRevision_profileId_eventId_revision_key",
  "ActiveEnergyResolutionRevision_profileId_fkey",
  "AuthRateLimitBucket",
  "AuthRateLimitBucket_pkey",
  "AuthRateLimitBucket_windowStart_idx",
  "DailyHealthData.profileId",
  "DailyHealthData_profileId_date_key",
  "DailyHealthData_profileId_fkey",
  "DailyHealthData_profileId_id_key",
  "ExerciseCatalog_profileId_currentLoadAccountingConfigId_fkey",
  "ExerciseCatalog_profileId_currentLoadAccountingConfigId_key",
  "ExerciseCatalog_profileId_fkey",
  "ExerciseCatalog_profileId_id_key",
  "ExerciseLoadConfiguration.profileId",
  "ExerciseLoadConfiguration_profileId_exerciseCatalogId_confi_key",
  "ExerciseLoadConfiguration_profileId_exerciseCatalogId_fkey",
  "ExerciseLoadConfiguration_profileId_fkey",
  "ExerciseLoadConfiguration_profileId_id_key",
  "ExperimentalCessationDetrainingShadow_profileId_fkey",
  "ExperimentalFatWeightUncertaintyShadow_profileId_fkey",
  "ExperimentalFfmRetentionShadow_profileId_fkey",
  "ExperimentalGlycogenAssociatedWaterShadow_profileId_fkey",
  "ExperimentalGlycogenAssociatedWaterShadow_profileId_updated_idx",
  "ExperimentalGlycogenRepletionShadow_profileId_fkey",
  "ExperimentalGlycogenStateShadow_profileId_fkey",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_fkey",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_update_idx",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_weekSt_key",
  "ExperimentalSkeletalMuscleDeltaShadow_profileId_fkey",
  "ExperimentalStepperActiveEnergyShadow_profileId_fkey",
  "ExperimentalStepperActiveEnergyShadow_profileId_workoutId_fkey",
  "ExperimentalStepperActiveEnergyShadow_profileId_workoutId_key",
  "ExperimentalStepperGlycogenDemandShadow_profileId_fkey",
  "ExperimentalStepperGlycogenDemandShadow_profileId_workoutI_fkey",
  "ExperimentalStepperGlycogenDemandShadow_profileId_workoutId_key",
  "ExperimentalStrengthEnergyShadow_profileId_fkey",
  "ExperimentalStrengthEnergyShadow_profileId_sessionId_fkey",
  "ExperimentalStrengthEnergyShadow_profileId_sessionId_key",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_fkey",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_sessionI_key",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_session_fkey",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_updatedA_idx",
  "ExperimentalTransientExerciseWaterShadow_profileId_fkey",
  "ExperimentalTransientExerciseWaterShadow_profileId_sessionI_key",
  "ExperimentalTransientExerciseWaterShadow_profileId_session_fkey",
  "ExperimentalTransientExerciseWaterShadow_profileId_updatedA_idx",
  "FatWeightShadowV1Result_profileId_fkey",
  "HealthActivityInterval.profileId",
  "HealthActivityInterval_profileId_fkey",
  "HealthActivityInterval_profileId_sourceFingerprint_key",
  "HealthMetricSample.profileId",
  "HealthMetricSample_profileId_dailyHealthDataId_fkey",
  "HealthMetricSample_profileId_fkey",
  "HealthMetricSample_profileId_metric_timestamp_key",
  "HealthSyncAudit.profileId",
  "HealthSyncAudit_profileId_fkey",
  "HealthSyncSnapshot.profileId",
  "HealthSyncSnapshot_profileId_dailyHealthDataId_fkey",
  "HealthSyncSnapshot_profileId_fkey",
  "HeartRateSample_profileId_dailyHealthDataId_fkey",
  "HeartRateSample_profileId_fkey",
  "ModelEpisode_profileId_id_key",
  "ModelEpisode_profileId_one_active_key",
  "ModelRecoveryRun_episodeId_algorithmVersion_seed_configFing_key",
  "PhysiologyV7DailyResult_profileId_fkey",
  "PhysiologyV7Lifecycle_profileId_fkey",
  "PhysiologyV7ShadowDiagnostic_profileId_fkey",
  "Profile.userId",
  "ProfileApiKey",
  "ProfileApiKey_lookupId_key",
  "ProfileApiKey_pkey",
  "ProfileApiKey_profileId_fkey",
  "ProfileApiKey_profileId_revokedAt_idx",
  "Profile_userId_fkey",
  "Profile_userId_key",
  "ProgramExercise.profileId",
  "ProgramExercise_profileId_exerciseCatalogId_fkey",
  "ProgramExercise_profileId_fkey",
  "ProgramExercise_profileId_id_key",
  "ProgramExercise_profileId_programVersionId_fkey",
  "ProgramExercise_profileId_programVersionId_sortOrder_key",
  "RestingHeartRateSample_profileId_dailyHealthDataId_fkey",
  "RestingHeartRateSample_profileId_fkey",
  "Session",
  "Session_pkey",
  "Session_token_key",
  "Session_userId_fkey",
  "Session_userId_idx",
  "SleepSegment_profileId_fkey",
  "StepperEquipmentAssignment_profileId_effectiveFrom_effectiv_idx",
  "StepperReconciliationCandidate.profileId",
  "StepperReconciliationCandidate_profileId_fkey",
  "StepperReconciliationCandidate_profileId_garminWorkoutId_fkey",
  "StepperReconciliationCandidate_profileId_garminWorkoutId_idx",
  "StepperReconciliationCandidate_profileId_groupId_fkey",
  "StepperReconciliationCandidate_profileId_groupId_idx",
  "StepperReconciliationCandidate_profileId_id_key",
  "StepperReconciliationCandidate_profileId_manualWorkoutId_fkey",
  "StepperReconciliationCandidate_profileId_manualWorkoutId_ga_key",
  "StepperReconciliationGroup_profileId_fkey",
  "StepperReconciliationGroup_profileId_id_key",
  "StepperReconciliationGroup_profileId_provisionalWorkoutId_fkey",
  "StrengthDiarySession_id_currentSnapshotRevision_key",
  "StrengthDiarySession_profileId_fkey",
  "StrengthDiarySession_profileId_id_key",
  "StrengthDiarySession_profileId_matchedWorkoutId_fkey",
  "StrengthDiarySession_profileId_matchedWorkoutId_key",
  "StrengthDiarySession_profileId_programId_fkey",
  "StrengthDiarySession_profileId_programVersionId_fkey",
  "StrengthSessionAccountingOperation_sessionId_idempotencyKey_key",
  "StrengthSessionAccountingOperation_sessionId_status_created_idx",
  "StrengthSessionAccountingSnapshot_sessionId_accountingInput_idx",
  "StrengthSessionAccountingSnapshot_sessionId_inputFingerprin_idx",
  "StrengthSessionAccountingSnapshot_sessionId_snapshotRevisio_key",
  "StrengthSessionExercise.profileId",
  "StrengthSessionExercise_profileId_fkey",
  "StrengthSessionExercise_profileId_id_key",
  "StrengthSessionExercise_profileId_sessionId_fkey",
  "StrengthSessionExercise_profileId_sourceExerciseCatalogId_fkey",
  "TrainingProgramVersion.profileId",
  "TrainingProgramVersion_profileId_fkey",
  "TrainingProgramVersion_profileId_id_key",
  "TrainingProgramVersion_profileId_programId_fkey",
  "TrainingProgramVersion_profileId_programId_versionNumber_key",
  "TrainingProgram_profileId_currentVersionId_fkey",
  "TrainingProgram_profileId_currentVersionId_key",
  "TrainingProgram_profileId_fkey",
  "TrainingProgram_profileId_id_key",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisod_fkey",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_idx",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_key",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelRevisio_idx",
  "UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatu_idx",
  "UnifiedExperimentalPhysiologyStateV2_profileId_resultFinger_idx",
  "UnifiedExperimentalPhysiologyState_profileId_modelRevision__idx",
  "UnifiedExperimentalPhysiologyState_profileId_qualityStatus__idx",
  "UnifiedExperimentalPhysiologyState_profileId_resultFingerpr_idx",
  "User",
  "User_email_key",
  "User_pkey",
  "Verification",
  "Verification_identifier_idx",
  "Verification_pkey",
  "WorkInterval.profileId",
  "WorkInterval_profileId_fkey",
  "Workout.profileId",
  "Workout_profileId_dailyHealthDataId_fkey",
  "Workout_profileId_dailyHealthDataId_sourceIdentity_key",
  "Workout_profileId_fkey",
  "Workout_profileId_id_key",
  "Workout_profileId_supersededByWorkoutId_fkey",
  "profile_id_seq"
]);
const AUTH_MULTIUSER_REMOVED_OBJECTS = Object.freeze([
  "ActiveEnergyCandidate_event_created_idx",
  "ActiveEnergyCandidate_event_fkey",
  "ActiveEnergyCandidate_event_source_fingerprint_key",
  "ActiveEnergyCanonicalEvent_profile_date_idx",
  "ActiveEnergyCanonicalEvent_profile_key_key",
  "ActiveEnergyCanonicalEvent_profile_occurrence_idx",
  "ActiveEnergyCanonicalEvent_superseded_by_fkey",
  "ActiveEnergyCanonicalEvent_superseded_by_idx",
  "ActiveEnergyEventAlias_event_fkey",
  "ActiveEnergyEventAlias_event_idx",
  "ActiveEnergyEventAlias_profile_source_key",
  "ActiveEnergyEventAlias_workout_fkey",
  "ActiveEnergyResolutionRevision_event_fingerprint_idx",
  "ActiveEnergyResolutionRevision_event_fkey",
  "ActiveEnergyResolutionRevision_event_revision_key",
  "DailyHealthData_date_key",
  "ExerciseCatalog_currentLoadAccountingConfigId_fkey",
  "ExerciseLoadConfiguration_exerciseCatalogId_configVersion_key",
  "ExerciseLoadConfiguration_exerciseCatalogId_fkey",
  "ExperimentalGlycogenAssociatedWaterShadow_profileId_updatedAt_i",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_updatedAt_",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_weekStartD",
  "ExperimentalStepperActiveEnergyShadow_workoutId_fkey",
  "ExperimentalStepperGlycogenDemandShadow_workoutId_fkey",
  "ExperimentalStrengthEnergyShadow_sessionId_fkey",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_updatedAt_id",
  "ExperimentalStrengthGlycogenDemandShadow_sessionId_fkey",
  "ExperimentalTransientExerciseWaterShadow_profileId_updatedAt_id",
  "ExperimentalTransientExerciseWaterShadow_sessionId_fkey",
  "HealthActivityInterval_sourceFingerprint_key",
  "HealthMetricSample_dailyHealthDataId_fkey",
  "HealthMetricSample_metric_timestamp_key",
  "HealthSyncSnapshot_dailyHealthDataId_fkey",
  "HeartRateSample_dailyHealthDataId_fkey",
  "ModelEpisode_one_active_key",
  "ModelRecoveryRun_episodeId_algorithmVersion_seed_configFingerpr",
  "ProgramExercise_exerciseCatalogId_fkey",
  "ProgramExercise_programVersionId_fkey",
  "ProgramExercise_programVersionId_sortOrder_key",
  "RestingHeartRateSample_dailyHealthDataId_fkey",
  "StepperEquipmentAssignment_profileId_effectiveFrom_effectiveTo_",
  "StepperReconciliationCandidate_garminWorkoutId_fkey",
  "StepperReconciliationCandidate_garminWorkoutId_idx",
  "StepperReconciliationCandidate_groupId_fkey",
  "StepperReconciliationCandidate_groupId_idx",
  "StepperReconciliationCandidate_manualWorkoutId_fkey",
  "StepperReconciliationCandidate_manualWorkoutId_garminWorkoutId_",
  "StepperReconciliationGroup_provisionalWorkoutId_fkey",
  "StrengthDiarySession_matchedWorkoutId_fkey",
  "StrengthDiarySession_matchedWorkoutId_key",
  "StrengthDiarySession_programId_fkey",
  "StrengthDiarySession_programVersionId_fkey",
  "StrengthSessionAccountingOperation_session_key_key",
  "StrengthSessionAccountingOperation_session_status_created_idx",
  "StrengthSessionAccountingSnapshot_session_fingerprint_idx",
  "StrengthSessionAccountingSnapshot_session_input_revision_idx",
  "StrengthSessionAccountingSnapshot_session_revision_key",
  "StrengthSessionExercise_sessionId_fkey",
  "StrengthSessionExercise_sourceExerciseCatalogId_fkey",
  "TrainingProgramVersion_programId_fkey",
  "TrainingProgramVersion_programId_versionNumber_key",
  "TrainingProgram_currentVersionId_fkey",
  "TrainingProgram_currentVersionId_key",
  "UnifiedExperimentalPhysiologyStateV2_modelEpisodeId_fkey",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_b",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisodeId_d",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelRevision_up",
  "UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatus_bo",
  "UnifiedExperimentalPhysiologyStateV2_profileId_resultFingerprin",
  "UnifiedExperimentalPhysiologyState_profileId_modelRevision_upda",
  "UnifiedExperimentalPhysiologyState_profileId_qualityStatus_date",
  "UnifiedExperimentalPhysiologyState_profileId_resultFingerprint_",
  "UnifiedPublicationBlock_ownerLeaseUntil_idx",
  "Workout_dailyHealthDataId_fkey",
  "Workout_dailyHealthDataId_sourceIdentity_key",
  "Workout_supersededByWorkoutId_fkey"
]);
const AUTH_MULTIUSER_POSTFLIGHT_SIGNATURES = Object.freeze({
  "Account": "relkind=r",
  "Account.accessToken": "text|nullable=true|default=",
  "Account.accessTokenExpiresAt": "timestamp(3) without time zone|nullable=true|default=",
  "Account.accountId": "character varying(255)|nullable=false|default=",
  "Account.createdAt": "timestamp(3) without time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "Account.id": "character varying(36)|nullable=false|default=",
  "Account.idToken": "text|nullable=true|default=",
  "Account.password": "text|nullable=true|default=",
  "Account.providerId": "character varying(100)|nullable=false|default=",
  "Account.refreshToken": "text|nullable=true|default=",
  "Account.refreshTokenExpiresAt": "timestamp(3) without time zone|nullable=true|default=",
  "Account.scope": "text|nullable=true|default=",
  "Account.updatedAt": "timestamp(3) without time zone|nullable=false|default=",
  "Account.userId": "character varying(36)|nullable=false|default=",
  "Account_pkey": "p|validated=true|table=\"Account\"|definition=PRIMARY KEY (id)",
  "Account_userId_fkey": "f|validated=true|table=\"Account\"|definition=FOREIGN KEY (\"userId\") REFERENCES \"User\"(id) ON UPDATE CASCADE ON DELETE CASCADE",
  "Account_userId_idx": "unique=false|valid=true|definition=CREATE INDEX \"Account_userId_idx\" ON public.\"Account\" USING btree (\"userId\")",
  "ActivationRollbackEntry.profileId": "integer|nullable=false|default=",
  "ActivationRollbackEntry_profileId_fkey": "f|validated=true|table=\"ActivationRollbackEntry\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ActiveEnergyCandidate.profileId": "integer|nullable=false|default=",
  "ActiveEnergyCandidate_profileId_eventId_createdAt_idx": "unique=false|valid=true|definition=CREATE INDEX \"ActiveEnergyCandidate_profileId_eventId_createdAt_idx\" ON public.\"ActiveEnergyCandidate\" USING btree (\"profileId\", \"eventId\", \"createdAt\")",
  "ActiveEnergyCandidate_profileId_eventId_fkey": "f|validated=true|table=\"ActiveEnergyCandidate\"|definition=FOREIGN KEY (\"profileId\", \"eventId\") REFERENCES \"ActiveEnergyCanonicalEvent\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ActiveEnergyCandidate_profileId_eventId_source_sourceIdenti_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ActiveEnergyCandidate_profileId_eventId_source_sourceIdenti_key\" ON public.\"ActiveEnergyCandidate\" USING btree (\"profileId\", \"eventId\", source, \"sourceIdentity\", \"sourceFingerprint\")",
  "ActiveEnergyCandidate_profileId_fkey": "f|validated=true|table=\"ActiveEnergyCandidate\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ActiveEnergyCanonicalEvent.profileId": "integer|nullable=false|default=",
  "ActiveEnergyCanonicalEvent_profileId_fkey": "f|validated=true|table=\"ActiveEnergyCanonicalEvent\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ActiveEnergyCanonicalEvent_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ActiveEnergyCanonicalEvent_profileId_id_key\" ON public.\"ActiveEnergyCanonicalEvent\" USING btree (\"profileId\", id)",
  "ActiveEnergyCanonicalEvent_profileId_logicalEventKey_key": "u|validated=true|table=\"ActiveEnergyCanonicalEvent\"|definition=UNIQUE (\"profileId\", \"logicalEventKey\")",
  "ActiveEnergyCanonicalEvent_profileId_modelDate_idx": "unique=false|valid=true|definition=CREATE INDEX \"ActiveEnergyCanonicalEvent_profileId_modelDate_idx\" ON public.\"ActiveEnergyCanonicalEvent\" USING btree (\"profileId\", \"modelDate\")",
  "ActiveEnergyCanonicalEvent_profileId_occurrenceAt_idx": "unique=false|valid=true|definition=CREATE INDEX \"ActiveEnergyCanonicalEvent_profileId_occurrenceAt_idx\" ON public.\"ActiveEnergyCanonicalEvent\" USING btree (\"profileId\", \"occurrenceAt\")",
  "ActiveEnergyCanonicalEvent_profileId_supersededByEventId_fkey": "f|validated=true|table=\"ActiveEnergyCanonicalEvent\"|definition=FOREIGN KEY (\"profileId\", \"supersededByEventId\") REFERENCES \"ActiveEnergyCanonicalEvent\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ActiveEnergyCanonicalEvent_supersededByEventId_idx": "unique=false|valid=true|definition=CREATE INDEX \"ActiveEnergyCanonicalEvent_supersededByEventId_idx\" ON public.\"ActiveEnergyCanonicalEvent\" USING btree (\"supersededByEventId\")",
  "ActiveEnergyEventAlias_eventId_idx": "unique=false|valid=true|definition=CREATE INDEX \"ActiveEnergyEventAlias_eventId_idx\" ON public.\"ActiveEnergyEventAlias\" USING btree (\"eventId\")",
  "ActiveEnergyEventAlias_profileId_eventId_fkey": "f|validated=true|table=\"ActiveEnergyEventAlias\"|definition=FOREIGN KEY (\"profileId\", \"eventId\") REFERENCES \"ActiveEnergyCanonicalEvent\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ActiveEnergyEventAlias_profileId_fkey": "f|validated=true|table=\"ActiveEnergyEventAlias\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ActiveEnergyEventAlias_profileId_sourceType_sourceId_key": "u|validated=true|table=\"ActiveEnergyEventAlias\"|definition=UNIQUE (\"profileId\", \"sourceType\", \"sourceId\")",
  "ActiveEnergyEventAlias_profileId_workoutId_fkey": "f|validated=true|table=\"ActiveEnergyEventAlias\"|definition=FOREIGN KEY (\"profileId\", \"workoutId\") REFERENCES \"Workout\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ActiveEnergyResolutionRevision.profileId": "integer|nullable=false|default=",
  "ActiveEnergyResolutionRevision_profileId_eventId_fkey": "f|validated=true|table=\"ActiveEnergyResolutionRevision\"|definition=FOREIGN KEY (\"profileId\", \"eventId\") REFERENCES \"ActiveEnergyCanonicalEvent\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ActiveEnergyResolutionRevision_profileId_eventId_resolution_idx": "unique=false|valid=true|definition=CREATE INDEX \"ActiveEnergyResolutionRevision_profileId_eventId_resolution_idx\" ON public.\"ActiveEnergyResolutionRevision\" USING btree (\"profileId\", \"eventId\", \"resolutionFingerprint\")",
  "ActiveEnergyResolutionRevision_profileId_eventId_revision_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ActiveEnergyResolutionRevision_profileId_eventId_revision_key\" ON public.\"ActiveEnergyResolutionRevision\" USING btree (\"profileId\", \"eventId\", revision)",
  "ActiveEnergyResolutionRevision_profileId_fkey": "f|validated=true|table=\"ActiveEnergyResolutionRevision\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "AuthRateLimitBucket": "relkind=r",
  "AuthRateLimitBucket.bucketKey": "character varying(64)|nullable=false|default=",
  "AuthRateLimitBucket.hitCount": "integer|nullable=false|default=0",
  "AuthRateLimitBucket.windowStart": "bigint|nullable=false|default=",
  "AuthRateLimitBucket_pkey": "p|validated=true|table=\"AuthRateLimitBucket\"|definition=PRIMARY KEY (\"bucketKey\")",
  "AuthRateLimitBucket_windowStart_idx": "unique=false|valid=true|definition=CREATE INDEX \"AuthRateLimitBucket_windowStart_idx\" ON public.\"AuthRateLimitBucket\" USING btree (\"windowStart\")",
  "DailyHealthData.profileId": "integer|nullable=false|default=",
  "DailyHealthData_profileId_date_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"DailyHealthData_profileId_date_key\" ON public.\"DailyHealthData\" USING btree (\"profileId\", date)",
  "DailyHealthData_profileId_fkey": "f|validated=true|table=\"DailyHealthData\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "DailyHealthData_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"DailyHealthData_profileId_id_key\" ON public.\"DailyHealthData\" USING btree (\"profileId\", id)",
  "ExerciseCatalog.profileId": "integer|nullable=false|default=",
  "ExerciseCatalog.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "ExerciseCatalog_profileId_currentLoadAccountingConfigId_fkey": "f|validated=true|table=\"ExerciseCatalog\"|definition=FOREIGN KEY (\"profileId\", \"currentLoadAccountingConfigId\") REFERENCES \"ExerciseLoadConfiguration\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExerciseCatalog_profileId_currentLoadAccountingConfigId_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExerciseCatalog_profileId_currentLoadAccountingConfigId_key\" ON public.\"ExerciseCatalog\" USING btree (\"profileId\", \"currentLoadAccountingConfigId\")",
  "ExerciseCatalog_profileId_fkey": "f|validated=true|table=\"ExerciseCatalog\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExerciseCatalog_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExerciseCatalog_profileId_id_key\" ON public.\"ExerciseCatalog\" USING btree (\"profileId\", id)",
  "ExerciseLoadConfiguration.profileId": "integer|nullable=false|default=",
  "ExerciseLoadConfiguration_profileId_exerciseCatalogId_confi_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExerciseLoadConfiguration_profileId_exerciseCatalogId_confi_key\" ON public.\"ExerciseLoadConfiguration\" USING btree (\"profileId\", \"exerciseCatalogId\", \"configVersion\")",
  "ExerciseLoadConfiguration_profileId_exerciseCatalogId_fkey": "f|validated=true|table=\"ExerciseLoadConfiguration\"|definition=FOREIGN KEY (\"profileId\", \"exerciseCatalogId\") REFERENCES \"ExerciseCatalog\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ExerciseLoadConfiguration_profileId_fkey": "f|validated=true|table=\"ExerciseLoadConfiguration\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExerciseLoadConfiguration_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExerciseLoadConfiguration_profileId_id_key\" ON public.\"ExerciseLoadConfiguration\" USING btree (\"profileId\", id)",
  "ExperimentalCessationDetrainingShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalCessationDetrainingShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalCessationDetrainingShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalFatWeightUncertaintyShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalFatWeightUncertaintyShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalFatWeightUncertaintyShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalFfmRetentionShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalFfmRetentionShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalFfmRetentionShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalGlycogenAssociatedWaterShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalGlycogenAssociatedWaterShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalGlycogenAssociatedWaterShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalGlycogenAssociatedWaterShadow_profileId_updated_idx": "unique=false|valid=true|definition=CREATE INDEX \"ExperimentalGlycogenAssociatedWaterShadow_profileId_updated_idx\" ON public.\"ExperimentalGlycogenAssociatedWaterShadow\" USING btree (\"profileId\", \"updatedAt\")",
  "ExperimentalGlycogenRepletionShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalGlycogenRepletionShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalGlycogenRepletionShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalGlycogenStateShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalGlycogenStateShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalGlycogenStateShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalLocalHypertrophyResponseShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalLocalHypertrophyResponseShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_update_idx": "unique=false|valid=true|definition=CREATE INDEX \"ExperimentalLocalHypertrophyResponseShadow_profileId_update_idx\" ON public.\"ExperimentalLocalHypertrophyResponseShadow\" USING btree (\"profileId\", \"updatedAt\")",
  "ExperimentalLocalHypertrophyResponseShadow_profileId_weekSt_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExperimentalLocalHypertrophyResponseShadow_profileId_weekSt_key\" ON public.\"ExperimentalLocalHypertrophyResponseShadow\" USING btree (\"profileId\", \"weekStartDate\")",
  "ExperimentalSkeletalMuscleDeltaShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalSkeletalMuscleDeltaShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalSkeletalMuscleDeltaShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalStepperActiveEnergyShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalStepperActiveEnergyShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalStepperActiveEnergyShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalStepperActiveEnergyShadow_profileId_workoutId_fkey": "f|validated=true|table=\"ExperimentalStepperActiveEnergyShadow\"|definition=FOREIGN KEY (\"profileId\", \"workoutId\") REFERENCES \"Workout\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ExperimentalStepperActiveEnergyShadow_profileId_workoutId_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExperimentalStepperActiveEnergyShadow_profileId_workoutId_key\" ON public.\"ExperimentalStepperActiveEnergyShadow\" USING btree (\"profileId\", \"workoutId\")",
  "ExperimentalStepperGlycogenDemandShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalStepperGlycogenDemandShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalStepperGlycogenDemandShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalStepperGlycogenDemandShadow_profileId_workoutI_fkey": "f|validated=true|table=\"ExperimentalStepperGlycogenDemandShadow\"|definition=FOREIGN KEY (\"profileId\", \"workoutId\") REFERENCES \"Workout\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ExperimentalStepperGlycogenDemandShadow_profileId_workoutId_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExperimentalStepperGlycogenDemandShadow_profileId_workoutId_key\" ON public.\"ExperimentalStepperGlycogenDemandShadow\" USING btree (\"profileId\", \"workoutId\")",
  "ExperimentalStrengthEnergyShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalStrengthEnergyShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalStrengthEnergyShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalStrengthEnergyShadow_profileId_sessionId_fkey": "f|validated=true|table=\"ExperimentalStrengthEnergyShadow\"|definition=FOREIGN KEY (\"profileId\", \"sessionId\") REFERENCES \"StrengthDiarySession\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ExperimentalStrengthEnergyShadow_profileId_sessionId_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExperimentalStrengthEnergyShadow_profileId_sessionId_key\" ON public.\"ExperimentalStrengthEnergyShadow\" USING btree (\"profileId\", \"sessionId\")",
  "ExperimentalStrengthGlycogenDemandShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalStrengthGlycogenDemandShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_sessionI_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExperimentalStrengthGlycogenDemandShadow_profileId_sessionI_key\" ON public.\"ExperimentalStrengthGlycogenDemandShadow\" USING btree (\"profileId\", \"sessionId\")",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_session_fkey": "f|validated=true|table=\"ExperimentalStrengthGlycogenDemandShadow\"|definition=FOREIGN KEY (\"profileId\", \"sessionId\") REFERENCES \"StrengthDiarySession\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ExperimentalStrengthGlycogenDemandShadow_profileId_updatedA_idx": "unique=false|valid=true|definition=CREATE INDEX \"ExperimentalStrengthGlycogenDemandShadow_profileId_updatedA_idx\" ON public.\"ExperimentalStrengthGlycogenDemandShadow\" USING btree (\"profileId\", \"updatedAt\")",
  "ExperimentalTransientExerciseWaterShadow.profileId": "integer|nullable=false|default=",
  "ExperimentalTransientExerciseWaterShadow_profileId_fkey": "f|validated=true|table=\"ExperimentalTransientExerciseWaterShadow\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ExperimentalTransientExerciseWaterShadow_profileId_sessionI_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ExperimentalTransientExerciseWaterShadow_profileId_sessionI_key\" ON public.\"ExperimentalTransientExerciseWaterShadow\" USING btree (\"profileId\", \"sessionId\")",
  "ExperimentalTransientExerciseWaterShadow_profileId_session_fkey": "f|validated=true|table=\"ExperimentalTransientExerciseWaterShadow\"|definition=FOREIGN KEY (\"profileId\", \"sessionId\") REFERENCES \"StrengthDiarySession\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ExperimentalTransientExerciseWaterShadow_profileId_updatedA_idx": "unique=false|valid=true|definition=CREATE INDEX \"ExperimentalTransientExerciseWaterShadow_profileId_updatedA_idx\" ON public.\"ExperimentalTransientExerciseWaterShadow\" USING btree (\"profileId\", \"updatedAt\")",
  "FatWeightShadowV1Result.profileId": "integer|nullable=false|default=",
  "FatWeightShadowV1Result_profileId_fkey": "f|validated=true|table=\"FatWeightShadowV1Result\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "HealthActivityInterval.profileId": "integer|nullable=false|default=",
  "HealthActivityInterval_profileId_fkey": "f|validated=true|table=\"HealthActivityInterval\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "HealthActivityInterval_profileId_sourceFingerprint_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"HealthActivityInterval_profileId_sourceFingerprint_key\" ON public.\"HealthActivityInterval\" USING btree (\"profileId\", \"sourceFingerprint\")",
  "HealthMetricSample.profileId": "integer|nullable=false|default=",
  "HealthMetricSample_profileId_dailyHealthDataId_fkey": "f|validated=true|table=\"HealthMetricSample\"|definition=FOREIGN KEY (\"profileId\", \"dailyHealthDataId\") REFERENCES \"DailyHealthData\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "HealthMetricSample_profileId_fkey": "f|validated=true|table=\"HealthMetricSample\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "HealthMetricSample_profileId_metric_timestamp_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"HealthMetricSample_profileId_metric_timestamp_key\" ON public.\"HealthMetricSample\" USING btree (\"profileId\", metric, \"timestamp\")",
  "HealthSyncAudit.profileId": "integer|nullable=true|default=",
  "HealthSyncAudit_profileId_fkey": "f|validated=true|table=\"HealthSyncAudit\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE SET NULL",
  "HealthSyncRefreshJob.profileId": "integer|nullable=false|default=",
  "HealthSyncSnapshot.profileId": "integer|nullable=false|default=",
  "HealthSyncSnapshot_profileId_dailyHealthDataId_fkey": "f|validated=true|table=\"HealthSyncSnapshot\"|definition=FOREIGN KEY (\"profileId\", \"dailyHealthDataId\") REFERENCES \"DailyHealthData\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "HealthSyncSnapshot_profileId_fkey": "f|validated=true|table=\"HealthSyncSnapshot\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "HeartRateSample.profileId": "integer|nullable=false|default=",
  "HeartRateSample_profileId_dailyHealthDataId_fkey": "f|validated=true|table=\"HeartRateSample\"|definition=FOREIGN KEY (\"profileId\", \"dailyHealthDataId\") REFERENCES \"DailyHealthData\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "HeartRateSample_profileId_fkey": "f|validated=true|table=\"HeartRateSample\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ModelEpisode.profileId": "integer|nullable=false|default=",
  "ModelEpisode_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ModelEpisode_profileId_id_key\" ON public.\"ModelEpisode\" USING btree (\"profileId\", id)",
  "ModelEpisode_profileId_one_active_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ModelEpisode_profileId_one_active_key\" ON public.\"ModelEpisode\" USING btree (\"profileId\") WHERE (active = true)",
  "ModelRecoveryRun_episodeId_algorithmVersion_seed_configFing_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ModelRecoveryRun_episodeId_algorithmVersion_seed_configFing_key\" ON public.\"ModelRecoveryRun\" USING btree (\"episodeId\", \"algorithmVersion\", seed, \"configFingerprint\", \"sourceFingerprint\")",
  "PhysiologyV7DailyResult.profileId": "integer|nullable=false|default=",
  "PhysiologyV7DailyResult_profileId_fkey": "f|validated=true|table=\"PhysiologyV7DailyResult\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "PhysiologyV7Lifecycle_profileId_fkey": "f|validated=true|table=\"PhysiologyV7Lifecycle\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "PhysiologyV7ShadowDiagnostic.profileId": "integer|nullable=false|default=",
  "PhysiologyV7ShadowDiagnostic_profileId_fkey": "f|validated=true|table=\"PhysiologyV7ShadowDiagnostic\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "Profile.dateOfBirth": "date|nullable=true|default=",
  "Profile.heightCm": "numeric(6,2)|nullable=true|default=",
  "Profile.id": "integer|nullable=false|default=nextval('profile_id_seq'::regclass)",
  "Profile.sex": "character varying(6)|nullable=true|default=",
  "Profile.userId": "character varying(36)|nullable=true|default=",
  "ProfileApiKey": "relkind=r",
  "ProfileApiKey.createdAt": "timestamp(3) with time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "ProfileApiKey.id": "character varying(36)|nullable=false|default=",
  "ProfileApiKey.lastUsedAt": "timestamp(3) with time zone|nullable=true|default=",
  "ProfileApiKey.lookupId": "character varying(24)|nullable=false|default=",
  "ProfileApiKey.name": "character varying(80)|nullable=false|default=",
  "ProfileApiKey.profileId": "integer|nullable=false|default=",
  "ProfileApiKey.revokedAt": "timestamp(3) with time zone|nullable=true|default=",
  "ProfileApiKey.secretHash": "character varying(64)|nullable=false|default=",
  "ProfileApiKey_lookupId_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ProfileApiKey_lookupId_key\" ON public.\"ProfileApiKey\" USING btree (\"lookupId\")",
  "ProfileApiKey_pkey": "p|validated=true|table=\"ProfileApiKey\"|definition=PRIMARY KEY (id)",
  "ProfileApiKey_profileId_fkey": "f|validated=true|table=\"ProfileApiKey\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ProfileApiKey_profileId_revokedAt_idx": "unique=false|valid=true|definition=CREATE INDEX \"ProfileApiKey_profileId_revokedAt_idx\" ON public.\"ProfileApiKey\" USING btree (\"profileId\", \"revokedAt\")",
  "Profile_userId_fkey": "f|validated=true|table=\"Profile\"|definition=FOREIGN KEY (\"userId\") REFERENCES \"User\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "Profile_userId_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"Profile_userId_key\" ON public.\"Profile\" USING btree (\"userId\")",
  "ProgramExercise.profileId": "integer|nullable=false|default=",
  "ProgramExercise.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "ProgramExercise_profileId_exerciseCatalogId_fkey": "f|validated=true|table=\"ProgramExercise\"|definition=FOREIGN KEY (\"profileId\", \"exerciseCatalogId\") REFERENCES \"ExerciseCatalog\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ProgramExercise_profileId_fkey": "f|validated=true|table=\"ProgramExercise\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "ProgramExercise_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ProgramExercise_profileId_id_key\" ON public.\"ProgramExercise\" USING btree (\"profileId\", id)",
  "ProgramExercise_profileId_programVersionId_fkey": "f|validated=true|table=\"ProgramExercise\"|definition=FOREIGN KEY (\"profileId\", \"programVersionId\") REFERENCES \"TrainingProgramVersion\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "ProgramExercise_profileId_programVersionId_sortOrder_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"ProgramExercise_profileId_programVersionId_sortOrder_key\" ON public.\"ProgramExercise\" USING btree (\"profileId\", \"programVersionId\", \"sortOrder\")",
  "RestingHeartRateSample.profileId": "integer|nullable=false|default=",
  "RestingHeartRateSample_profileId_dailyHealthDataId_fkey": "f|validated=true|table=\"RestingHeartRateSample\"|definition=FOREIGN KEY (\"profileId\", \"dailyHealthDataId\") REFERENCES \"DailyHealthData\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "RestingHeartRateSample_profileId_fkey": "f|validated=true|table=\"RestingHeartRateSample\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "Session": "relkind=r",
  "Session.createdAt": "timestamp(3) without time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "Session.expiresAt": "timestamp(3) without time zone|nullable=false|default=",
  "Session.id": "character varying(36)|nullable=false|default=",
  "Session.ipAddress": "character varying(255)|nullable=true|default=",
  "Session.token": "character varying(255)|nullable=false|default=",
  "Session.updatedAt": "timestamp(3) without time zone|nullable=false|default=",
  "Session.userAgent": "character varying(500)|nullable=true|default=",
  "Session.userId": "character varying(36)|nullable=false|default=",
  "Session_pkey": "p|validated=true|table=\"Session\"|definition=PRIMARY KEY (id)",
  "Session_token_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"Session_token_key\" ON public.\"Session\" USING btree (token)",
  "Session_userId_fkey": "f|validated=true|table=\"Session\"|definition=FOREIGN KEY (\"userId\") REFERENCES \"User\"(id) ON UPDATE CASCADE ON DELETE CASCADE",
  "Session_userId_idx": "unique=false|valid=true|definition=CREATE INDEX \"Session_userId_idx\" ON public.\"Session\" USING btree (\"userId\")",
  "SleepSegment.profileId": "integer|nullable=false|default=",
  "SleepSegment_profileId_fkey": "f|validated=true|table=\"SleepSegment\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StepperEquipmentAssignment.profileId": "integer|nullable=false|default=",
  "StepperEquipmentAssignment_profileId_effectiveFrom_effectiv_idx": "unique=false|valid=true|definition=CREATE INDEX \"StepperEquipmentAssignment_profileId_effectiveFrom_effectiv_idx\" ON public.\"StepperEquipmentAssignment\" USING btree (\"profileId\", \"effectiveFrom\", \"effectiveTo\")",
  "StepperReconciliationCandidate.profileId": "integer|nullable=false|default=",
  "StepperReconciliationCandidate_profileId_fkey": "f|validated=true|table=\"StepperReconciliationCandidate\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StepperReconciliationCandidate_profileId_garminWorkoutId_fkey": "f|validated=true|table=\"StepperReconciliationCandidate\"|definition=FOREIGN KEY (\"profileId\", \"garminWorkoutId\") REFERENCES \"Workout\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StepperReconciliationCandidate_profileId_garminWorkoutId_idx": "unique=false|valid=true|definition=CREATE INDEX \"StepperReconciliationCandidate_profileId_garminWorkoutId_idx\" ON public.\"StepperReconciliationCandidate\" USING btree (\"profileId\", \"garminWorkoutId\")",
  "StepperReconciliationCandidate_profileId_groupId_fkey": "f|validated=true|table=\"StepperReconciliationCandidate\"|definition=FOREIGN KEY (\"profileId\", \"groupId\") REFERENCES \"StepperReconciliationGroup\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "StepperReconciliationCandidate_profileId_groupId_idx": "unique=false|valid=true|definition=CREATE INDEX \"StepperReconciliationCandidate_profileId_groupId_idx\" ON public.\"StepperReconciliationCandidate\" USING btree (\"profileId\", \"groupId\")",
  "StepperReconciliationCandidate_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"StepperReconciliationCandidate_profileId_id_key\" ON public.\"StepperReconciliationCandidate\" USING btree (\"profileId\", id)",
  "StepperReconciliationCandidate_profileId_manualWorkoutId_fkey": "f|validated=true|table=\"StepperReconciliationCandidate\"|definition=FOREIGN KEY (\"profileId\", \"manualWorkoutId\") REFERENCES \"Workout\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StepperReconciliationCandidate_profileId_manualWorkoutId_ga_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"StepperReconciliationCandidate_profileId_manualWorkoutId_ga_key\" ON public.\"StepperReconciliationCandidate\" USING btree (\"profileId\", \"manualWorkoutId\", \"garminWorkoutId\")",
  "StepperReconciliationGroup.profileId": "integer|nullable=false|default=",
  "StepperReconciliationGroup.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "StepperReconciliationGroup_profileId_fkey": "f|validated=true|table=\"StepperReconciliationGroup\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StepperReconciliationGroup_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"StepperReconciliationGroup_profileId_id_key\" ON public.\"StepperReconciliationGroup\" USING btree (\"profileId\", id)",
  "StepperReconciliationGroup_profileId_provisionalWorkoutId_fkey": "f|validated=true|table=\"StepperReconciliationGroup\"|definition=FOREIGN KEY (\"profileId\", \"provisionalWorkoutId\") REFERENCES \"Workout\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StrengthDiarySession.profileId": "integer|nullable=false|default=",
  "StrengthDiarySession.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "StrengthDiarySession_id_currentSnapshotRevision_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"StrengthDiarySession_id_currentSnapshotRevision_key\" ON public.\"StrengthDiarySession\" USING btree (id, \"currentSnapshotRevision\")",
  "StrengthDiarySession_profileId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StrengthDiarySession_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"StrengthDiarySession_profileId_id_key\" ON public.\"StrengthDiarySession\" USING btree (\"profileId\", id)",
  "StrengthDiarySession_profileId_matchedWorkoutId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"profileId\", \"matchedWorkoutId\") REFERENCES \"Workout\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StrengthDiarySession_profileId_matchedWorkoutId_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"StrengthDiarySession_profileId_matchedWorkoutId_key\" ON public.\"StrengthDiarySession\" USING btree (\"profileId\", \"matchedWorkoutId\")",
  "StrengthDiarySession_profileId_programId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"profileId\", \"programId\") REFERENCES \"TrainingProgram\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StrengthDiarySession_profileId_programVersionId_fkey": "f|validated=true|table=\"StrengthDiarySession\"|definition=FOREIGN KEY (\"profileId\", \"programVersionId\") REFERENCES \"TrainingProgramVersion\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StrengthSessionAccountingOperation.status": "\"StrengthAccountingOperationStatus\"|nullable=false|default=",
  "StrengthSessionAccountingOperation_sessionId_idempotencyKey_key": "u|validated=true|table=\"StrengthSessionAccountingOperation\"|definition=UNIQUE (\"sessionId\", \"idempotencyKey\")",
  "StrengthSessionAccountingOperation_sessionId_status_created_idx": "unique=false|valid=true|definition=CREATE INDEX \"StrengthSessionAccountingOperation_sessionId_status_created_idx\" ON public.\"StrengthSessionAccountingOperation\" USING btree (\"sessionId\", status, \"createdAt\")",
  "StrengthSessionAccountingSnapshot_sessionId_accountingInput_idx": "unique=false|valid=true|definition=CREATE INDEX \"StrengthSessionAccountingSnapshot_sessionId_accountingInput_idx\" ON public.\"StrengthSessionAccountingSnapshot\" USING btree (\"sessionId\", \"accountingInputRevision\")",
  "StrengthSessionAccountingSnapshot_sessionId_inputFingerprin_idx": "unique=false|valid=true|definition=CREATE INDEX \"StrengthSessionAccountingSnapshot_sessionId_inputFingerprin_idx\" ON public.\"StrengthSessionAccountingSnapshot\" USING btree (\"sessionId\", \"inputFingerprint\")",
  "StrengthSessionAccountingSnapshot_sessionId_snapshotRevisio_key": "u|validated=true|table=\"StrengthSessionAccountingSnapshot\"|definition=UNIQUE (\"sessionId\", \"snapshotRevision\")",
  "StrengthSessionExercise.profileId": "integer|nullable=false|default=",
  "StrengthSessionExercise.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "StrengthSessionExercise_profileId_fkey": "f|validated=true|table=\"StrengthSessionExercise\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StrengthSessionExercise_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"StrengthSessionExercise_profileId_id_key\" ON public.\"StrengthSessionExercise\" USING btree (\"profileId\", id)",
  "StrengthSessionExercise_profileId_sessionId_fkey": "f|validated=true|table=\"StrengthSessionExercise\"|definition=FOREIGN KEY (\"profileId\", \"sessionId\") REFERENCES \"StrengthDiarySession\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "StrengthSessionExercise_profileId_sourceExerciseCatalogId_fkey": "f|validated=true|table=\"StrengthSessionExercise\"|definition=FOREIGN KEY (\"profileId\", \"sourceExerciseCatalogId\") REFERENCES \"ExerciseCatalog\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "StrengthSet.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "TrainingProgram.profileId": "integer|nullable=false|default=",
  "TrainingProgram.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "TrainingProgramVersion.profileId": "integer|nullable=false|default=",
  "TrainingProgramVersion_profileId_fkey": "f|validated=true|table=\"TrainingProgramVersion\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "TrainingProgramVersion_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"TrainingProgramVersion_profileId_id_key\" ON public.\"TrainingProgramVersion\" USING btree (\"profileId\", id)",
  "TrainingProgramVersion_profileId_programId_fkey": "f|validated=true|table=\"TrainingProgramVersion\"|definition=FOREIGN KEY (\"profileId\", \"programId\") REFERENCES \"TrainingProgram\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE CASCADE",
  "TrainingProgramVersion_profileId_programId_versionNumber_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"TrainingProgramVersion_profileId_programId_versionNumber_key\" ON public.\"TrainingProgramVersion\" USING btree (\"profileId\", \"programId\", \"versionNumber\")",
  "TrainingProgram_profileId_currentVersionId_fkey": "f|validated=true|table=\"TrainingProgram\"|definition=FOREIGN KEY (\"profileId\", \"currentVersionId\") REFERENCES \"TrainingProgramVersion\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "TrainingProgram_profileId_currentVersionId_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"TrainingProgram_profileId_currentVersionId_key\" ON public.\"TrainingProgram\" USING btree (\"profileId\", \"currentVersionId\")",
  "TrainingProgram_profileId_fkey": "f|validated=true|table=\"TrainingProgram\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "TrainingProgram_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"TrainingProgram_profileId_id_key\" ON public.\"TrainingProgram\" USING btree (\"profileId\", id)",
  "UnifiedExperimentalPhysiologyState.profileId": "integer|nullable=false|default=",
  "UnifiedExperimentalPhysiologyState.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "UnifiedExperimentalPhysiologyStateV2.profileId": "integer|nullable=false|default=",
  "UnifiedExperimentalPhysiologyStateV2.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisod_fkey": "f|validated=true|table=\"UnifiedExperimentalPhysiologyStateV2\"|definition=FOREIGN KEY (\"profileId\", \"modelEpisodeId\") REFERENCES \"ModelEpisode\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_idx": "unique=false|valid=true|definition=CREATE INDEX \"UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_idx\" ON public.\"UnifiedExperimentalPhysiologyStateV2\" USING btree (\"profileId\", \"modelEpisodeId\", \"boundaryAt\")",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"UnifiedExperimentalPhysiologyStateV2_profileId_modelEpisode_key\" ON public.\"UnifiedExperimentalPhysiologyStateV2\" USING btree (\"profileId\", \"modelEpisodeId\", date)",
  "UnifiedExperimentalPhysiologyStateV2_profileId_modelRevisio_idx": "unique=false|valid=true|definition=CREATE INDEX \"UnifiedExperimentalPhysiologyStateV2_profileId_modelRevisio_idx\" ON public.\"UnifiedExperimentalPhysiologyStateV2\" USING btree (\"profileId\", \"modelRevision\", \"updatedAt\")",
  "UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatu_idx": "unique=false|valid=true|definition=CREATE INDEX \"UnifiedExperimentalPhysiologyStateV2_profileId_qualityStatu_idx\" ON public.\"UnifiedExperimentalPhysiologyStateV2\" USING btree (\"profileId\", \"qualityStatus\", \"boundaryAt\")",
  "UnifiedExperimentalPhysiologyStateV2_profileId_resultFinger_idx": "unique=false|valid=true|definition=CREATE INDEX \"UnifiedExperimentalPhysiologyStateV2_profileId_resultFinger_idx\" ON public.\"UnifiedExperimentalPhysiologyStateV2\" USING btree (\"profileId\", \"resultFingerprint\")",
  "UnifiedExperimentalPhysiologyState_profileId_modelRevision__idx": "unique=false|valid=true|definition=CREATE INDEX \"UnifiedExperimentalPhysiologyState_profileId_modelRevision__idx\" ON public.\"UnifiedExperimentalPhysiologyState\" USING btree (\"profileId\", \"modelRevision\", \"updatedAt\")",
  "UnifiedExperimentalPhysiologyState_profileId_qualityStatus__idx": "unique=false|valid=true|definition=CREATE INDEX \"UnifiedExperimentalPhysiologyState_profileId_qualityStatus__idx\" ON public.\"UnifiedExperimentalPhysiologyState\" USING btree (\"profileId\", \"qualityStatus\", date)",
  "UnifiedExperimentalPhysiologyState_profileId_resultFingerpr_idx": "unique=false|valid=true|definition=CREATE INDEX \"UnifiedExperimentalPhysiologyState_profileId_resultFingerpr_idx\" ON public.\"UnifiedExperimentalPhysiologyState\" USING btree (\"profileId\", \"resultFingerprint\")",
  "UnifiedPublicationBlock.updatedAt": "timestamp(3) with time zone|nullable=false|default=",
  "User": "relkind=r",
  "User.createdAt": "timestamp(3) without time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "User.email": "character varying(320)|nullable=false|default=",
  "User.emailVerified": "boolean|nullable=false|default=false",
  "User.id": "character varying(36)|nullable=false|default=",
  "User.image": "text|nullable=true|default=",
  "User.name": "character varying(120)|nullable=false|default=",
  "User.passwordChangeRequired": "boolean|nullable=false|default=false",
  "User.updatedAt": "timestamp(3) without time zone|nullable=false|default=",
  "User_email_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"User_email_key\" ON public.\"User\" USING btree (email)",
  "User_pkey": "p|validated=true|table=\"User\"|definition=PRIMARY KEY (id)",
  "Verification": "relkind=r",
  "Verification.createdAt": "timestamp(3) without time zone|nullable=false|default=CURRENT_TIMESTAMP",
  "Verification.expiresAt": "timestamp(3) without time zone|nullable=false|default=",
  "Verification.id": "character varying(36)|nullable=false|default=",
  "Verification.identifier": "character varying(320)|nullable=false|default=",
  "Verification.updatedAt": "timestamp(3) without time zone|nullable=false|default=",
  "Verification.value": "text|nullable=false|default=",
  "Verification_identifier_idx": "unique=false|valid=true|definition=CREATE INDEX \"Verification_identifier_idx\" ON public.\"Verification\" USING btree (identifier)",
  "Verification_pkey": "p|validated=true|table=\"Verification\"|definition=PRIMARY KEY (id)",
  "WorkInterval.profileId": "integer|nullable=false|default=",
  "WorkInterval_profileId_fkey": "f|validated=true|table=\"WorkInterval\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "Workout.profileId": "integer|nullable=false|default=",
  "Workout_profileId_dailyHealthDataId_fkey": "f|validated=true|table=\"Workout\"|definition=FOREIGN KEY (\"profileId\", \"dailyHealthDataId\") REFERENCES \"DailyHealthData\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "Workout_profileId_dailyHealthDataId_sourceIdentity_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"Workout_profileId_dailyHealthDataId_sourceIdentity_key\" ON public.\"Workout\" USING btree (\"profileId\", \"dailyHealthDataId\", \"sourceIdentity\")",
  "Workout_profileId_fkey": "f|validated=true|table=\"Workout\"|definition=FOREIGN KEY (\"profileId\") REFERENCES \"Profile\"(id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "Workout_profileId_id_key": "unique=true|valid=true|definition=CREATE UNIQUE INDEX \"Workout_profileId_id_key\" ON public.\"Workout\" USING btree (\"profileId\", id)",
  "Workout_profileId_supersededByWorkoutId_fkey": "f|validated=true|table=\"Workout\"|definition=FOREIGN KEY (\"profileId\", \"supersededByWorkoutId\") REFERENCES \"Workout\"(\"profileId\", id) ON UPDATE CASCADE ON DELETE RESTRICT",
  "profile_id_seq": "sequence=bigint|start=1|increment=1|min=1|max=9223372036854775807|ownedBy=Profile.id"
});
const AUTH_MULTIUSER_BASELINE_TABLES = Object.freeze([
  "ActivationRollbackEntry",
  "ActiveEnergyCandidate",
  "ActiveEnergyCanonicalEvent",
  "ActiveEnergyEventAlias",
  "ActiveEnergyResolutionRevision",
  "DailyHealthData",
  "ExerciseCatalog",
  "ExerciseLoadConfiguration",
  "ExperimentalCessationDetrainingShadow",
  "ExperimentalFatWeightUncertaintyShadow",
  "ExperimentalFfmRetentionShadow",
  "ExperimentalGlycogenAssociatedWaterShadow",
  "ExperimentalGlycogenRepletionShadow",
  "ExperimentalGlycogenStateShadow",
  "ExperimentalLocalHypertrophyResponseShadow",
  "ExperimentalSkeletalMuscleDeltaShadow",
  "ExperimentalStepperActiveEnergyShadow",
  "ExperimentalStepperGlycogenDemandShadow",
  "ExperimentalStrengthEnergyShadow",
  "ExperimentalStrengthGlycogenDemandShadow",
  "ExperimentalTransientExerciseWaterShadow",
  "FatWeightShadowV1Result",
  "HealthActivityInterval",
  "HealthMetricSample",
  "HealthSyncAudit",
  "HealthSyncRefreshJob",
  "HealthSyncSnapshot",
  "HeartRateSample",
  "ModelEpisode",
  "PhysiologyV7DailyResult",
  "PhysiologyV7Lifecycle",
  "PhysiologyV7ShadowDiagnostic",
  "Profile",
  "ProgramExercise",
  "RestingHeartRateSample",
  "SleepSegment",
  "StepperEquipmentAssignment",
  "StepperReconciliationCandidate",
  "StepperReconciliationGroup",
  "StrengthDiarySession",
  "StrengthSessionAccountingOperation",
  "StrengthSessionExercise",
  "StrengthSet",
  "TrainingProgram",
  "TrainingProgramVersion",
  "UnifiedExperimentalPhysiologyState",
  "UnifiedExperimentalPhysiologyStateV2",
  "UnifiedPublicationBlock",
  "WorkInterval",
  "Workout",
  "_prisma_migrations"
]);
const AUTH_MULTIUSER_DDL_LOCK_TARGETS = Object.freeze([
  {
    "tableName": "ActivationRollbackEntry",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ActiveEnergyCandidate",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ActiveEnergyCanonicalEvent",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ActiveEnergyEventAlias",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ActiveEnergyResolutionRevision",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "DailyHealthData",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExerciseCatalog",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExerciseLoadConfiguration",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalCessationDetrainingShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalFatWeightUncertaintyShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalFfmRetentionShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalGlycogenAssociatedWaterShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalGlycogenRepletionShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalGlycogenStateShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalLocalHypertrophyResponseShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalSkeletalMuscleDeltaShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalStepperActiveEnergyShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalStepperGlycogenDemandShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalStrengthEnergyShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalStrengthGlycogenDemandShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ExperimentalTransientExerciseWaterShadow",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "FatWeightShadowV1Result",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "HealthActivityInterval",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "HealthMetricSample",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "HealthSyncAudit",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "HealthSyncRefreshJob",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "HealthSyncSnapshot",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "HeartRateSample",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ModelEpisode",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "PhysiologyV7DailyResult",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "PhysiologyV7Lifecycle",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "PhysiologyV7ShadowDiagnostic",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "Profile",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "ProgramExercise",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "RestingHeartRateSample",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "SleepSegment",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "StepperEquipmentAssignment",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "StepperReconciliationCandidate",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "StepperReconciliationGroup",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "StrengthDiarySession",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "StrengthSessionAccountingOperation",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "StrengthSessionExercise",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "StrengthSet",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "TrainingProgram",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "TrainingProgramVersion",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "UnifiedExperimentalPhysiologyState",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "UnifiedExperimentalPhysiologyStateV2",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "UnifiedPublicationBlock",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "WorkInterval",
    "requiredLockMode": "AccessExclusiveLock"
  },
  {
    "tableName": "Workout",
    "requiredLockMode": "AccessExclusiveLock"
  }
].map(Object.freeze));

export const AUTH_MULTIUSER_MANIFEST = Object.freeze({
  id: "auth-multiuser-v1",
  cutbackSupported: false,
  requireCompleteReleaseTree: true,
  migrationOriginSha: AUTH_MULTIUSER_MIGRATION_BASELINE_SHA,
  migrations: AUTH_MULTIUSER_MIGRATIONS,
  requiredAppliedMigrations: AUTH_MULTIUSER_PREDECESSORS,
  requiredTablesBefore: AUTH_MULTIUSER_BASELINE_TABLES,
  requiredObjectsBefore: Object.freeze([
    ...TRAINING_MUTATION_LEDGER_MANIFEST.postflightObjects,
    ...AUTH_MULTIUSER_REMOVED_OBJECTS,
  ]),
  requiredObjectSignatureIncludes: TRAINING_MUTATION_LEDGER_MANIFEST.postflightSignatureIncludes,
  requiredObjectSignatureEquals: TRAINING_MUTATION_LEDGER_MANIFEST.postflightSignatureEquals,
  partialObjects: AUTH_MULTIUSER_NEW_OBJECTS,
  requiredAbsentObjectsBefore: AUTH_MULTIUSER_NEW_OBJECTS,
  postflightAbsentObjects: Object.freeze([
    ...TRAINING_MUTATION_LEDGER_MANIFEST.postflightAbsentObjects,
    ...AUTH_MULTIUSER_REMOVED_OBJECTS,
  ]),
  postflightSignatureIncludes: Object.freeze({
    ...TRAINING_MUTATION_LEDGER_MANIFEST.postflightSignatureIncludes,
    ...AUTH_MULTIUSER_POSTFLIGHT_SIGNATURES,
  }),
  postflightSignatureEquals: Object.freeze({
    ...TRAINING_MUTATION_LEDGER_MANIFEST.postflightSignatureEquals,
    ...AUTH_MULTIUSER_POSTFLIGHT_SIGNATURES,
  }),
  postflightObjects: Object.freeze([
    ...TRAINING_MUTATION_LEDGER_MANIFEST.postflightObjects,
    ...AUTH_MULTIUSER_POSTFLIGHT_OBJECTS,
  ]),
  ddlLockTargets: AUTH_MULTIUSER_DDL_LOCK_TARGETS,
});

export const PRODUCTION_MIGRATION_MANIFESTS = Object.freeze({
  [ACTIVE_ENERGY_UNIFIED_MANIFEST.id]: ACTIVE_ENERGY_UNIFIED_MANIFEST,
  [V4_REPUBLICATION_MANIFEST.id]: V4_REPUBLICATION_MANIFEST,
  [DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST.id]: DYNAMIC_WORKOUT_HEALTH_SYNC_MANIFEST,
  [TRAINING_MUTATION_LEDGER_MANIFEST.id]: TRAINING_MUTATION_LEDGER_MANIFEST,
  [AUTH_MULTIUSER_MANIFEST.id]: AUTH_MULTIUSER_MANIFEST,
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
