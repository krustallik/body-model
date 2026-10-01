BEGIN READ ONLY;

WITH object_inventory(name, present) AS (
  VALUES
    ('ExerciseCatalog.currentLoadAccountingConfigId', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ExerciseCatalog' AND column_name = 'currentLoadAccountingConfigId')),
    ('ExerciseLoadConfiguration', to_regclass('public."ExerciseLoadConfiguration"') IS NOT NULL),
    ('ExerciseCatalog_currentLoadAccountingConfigId_key', to_regclass('public."ExerciseCatalog_currentLoadAccountingConfigId_key"') IS NOT NULL),
    ('ExerciseLoadConfiguration_exerciseCatalogId_configVersion_key', to_regclass('public."ExerciseLoadConfiguration_exerciseCatalogId_configVersion_key"') IS NOT NULL),
    ('ExerciseLoadConfiguration_exerciseCatalogId_createdAt_idx', to_regclass('public."ExerciseLoadConfiguration_exerciseCatalogId_createdAt_idx"') IS NOT NULL),
    ('ExerciseLoadConfiguration_pkey', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."ExerciseLoadConfiguration"') AND conname = 'ExerciseLoadConfiguration_pkey')),
    ('ExerciseLoadConfiguration_exerciseCatalogId_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."ExerciseLoadConfiguration"') AND conname = 'ExerciseLoadConfiguration_exerciseCatalogId_fkey')),
    ('ExerciseCatalog_currentLoadAccountingConfigId_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."ExerciseCatalog"') AND conname = 'ExerciseCatalog_currentLoadAccountingConfigId_fkey')),
    ('ProgramExercise.loadAccountingConfigSnapshot', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ProgramExercise' AND column_name = 'loadAccountingConfigSnapshot')),
    ('StrengthSessionExercise.loadAccountingConfigSnapshot', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StrengthSessionExercise' AND column_name = 'loadAccountingConfigSnapshot')),
    ('StrengthSet.loadAccountingOverride', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StrengthSet' AND column_name = 'loadAccountingOverride')),
    ('HealthMetricSample.source', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'HealthMetricSample' AND column_name = 'source')),
    ('StrengthAccountingOperationStatus', EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = 'StrengthAccountingOperationStatus')),
    ('StrengthDiarySession.accountingInputRevision', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StrengthDiarySession' AND column_name = 'accountingInputRevision')),
    ('StrengthDiarySession.effectiveAccountingAt', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StrengthDiarySession' AND column_name = 'effectiveAccountingAt')),
    ('StrengthDiarySession.accountingTimeZone', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StrengthDiarySession' AND column_name = 'accountingTimeZone')),
    ('StrengthDiarySession.accountingTimeZoneProvenance', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StrengthDiarySession' AND column_name = 'accountingTimeZoneProvenance')),
    ('StrengthDiarySession.currentSnapshotRevision', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StrengthDiarySession' AND column_name = 'currentSnapshotRevision')),
    ('StrengthDiarySession_accountingInputRevision_positive', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthDiarySession"') AND conname = 'StrengthDiarySession_accountingInputRevision_positive')),
    ('StrengthSessionAccountingSnapshot', to_regclass('public."StrengthSessionAccountingSnapshot"') IS NOT NULL),
    ('StrengthSessionAccountingSnapshot_session_input_revision_idx', to_regclass('public."StrengthSessionAccountingSnapshot_session_input_revision_idx"') IS NOT NULL),
    ('StrengthSessionAccountingSnapshot_session_fingerprint_idx', to_regclass('public."StrengthSessionAccountingSnapshot_session_fingerprint_idx"') IS NOT NULL),
    ('StrengthSessionAccountingSnapshot_pkey', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingSnapshot"') AND conname = 'StrengthSessionAccountingSnapshot_pkey')),
    ('StrengthSessionAccountingSnapshot_sessionId_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingSnapshot"') AND conname = 'StrengthSessionAccountingSnapshot_sessionId_fkey')),
    ('StrengthSessionAccountingSnapshot_session_revision_key', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingSnapshot"') AND conname = 'StrengthSessionAccountingSnapshot_session_revision_key')),
    ('StrengthSessionAccountingSnapshot_positive_revisions', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingSnapshot"') AND conname = 'StrengthSessionAccountingSnapshot_positive_revisions')),
    ('StrengthSessionAccountingSnapshot_fingerprint_hex', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingSnapshot"') AND conname = 'StrengthSessionAccountingSnapshot_fingerprint_hex')),
    ('StrengthSessionAccountingOperation', to_regclass('public."StrengthSessionAccountingOperation"') IS NOT NULL),
    ('StrengthSessionAccountingOperation_session_status_created_idx', to_regclass('public."StrengthSessionAccountingOperation_session_status_created_idx"') IS NOT NULL),
    ('StrengthSessionAccountingOperation_pkey', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingOperation"') AND conname = 'StrengthSessionAccountingOperation_pkey')),
    ('StrengthSessionAccountingOperation_sessionId_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingOperation"') AND conname = 'StrengthSessionAccountingOperation_sessionId_fkey')),
    ('StrengthSessionAccountingOperation_session_key_key', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingOperation"') AND conname = 'StrengthSessionAccountingOperation_session_key_key')),
    ('StrengthSessionAccountingOperation_digest_hex', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingOperation"') AND conname = 'StrengthSessionAccountingOperation_digest_hex')),
    ('StrengthSessionAccountingOperation_completed_has_result', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingOperation"') AND conname = 'StrengthSessionAccountingOperation_completed_has_result')),
    ('StrengthDiarySession_current_snapshot_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthDiarySession"') AND conname = 'StrengthDiarySession_current_snapshot_fkey')),
    ('StrengthSessionAccountingOperation_result_snapshot_fkey', EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid = to_regclass('public."StrengthSessionAccountingOperation"') AND conname = 'StrengthSessionAccountingOperation_result_snapshot_fkey'))
), migration_rows AS (
  SELECT migration_name AS name, checksum, started_at AS "startedAt", finished_at AS "finishedAt",
    rolled_back_at AS "rolledBackAt", logs IS NOT NULL AS "hasLogs",
    md5(COALESCE(logs, '')) AS "logsFingerprint"
  FROM public."_prisma_migrations"
), target_tables(table_name) AS (
  VALUES ('StrengthDiarySession'), ('ExerciseCatalog')
), long_transactions AS (
  SELECT pid, state,
    floor(extract(epoch FROM (clock_timestamp() - xact_start)))::bigint AS "xactAgeSeconds",
    wait_event_type AS "waitEventType", wait_event AS "waitEvent"
  FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid()
    AND xact_start IS NOT NULL AND xact_start < clock_timestamp() - interval '5 minutes'
), alter_table_targets(table_name) AS (
  VALUES
    ('ExerciseCatalog'),
    ('ProgramExercise'),
    ('StrengthSessionExercise'),
    ('StrengthSet'),
    ('HealthMetricSample'),
    ('StrengthDiarySession')
), relevant_locks AS (
  SELECT a.pid, c.relname AS relation, l.mode, l.granted,
    CASE WHEN l.pid IS NULL THEN 'prepared-transaction' ELSE 'backend' END AS "blockerType",
    CASE WHEN l.pid IS NULL THEN 'prepared' ELSE a.state END AS state,
    l.virtualtransaction AS "virtualTransaction",
    CASE WHEN l.pid IS NULL THEN NULL
      ELSE floor(extract(epoch FROM (clock_timestamp() - a.xact_start)))::bigint
    END AS "xactAgeSeconds",
    CASE WHEN l.pid IS NULL THEN NULL ELSE cardinality(pg_blocking_pids(a.pid)) END AS "blockerCount",
    a.wait_event_type AS "waitEventType", a.wait_event AS "waitEvent"
  FROM pg_locks l
  LEFT JOIN pg_stat_activity a ON a.pid = l.pid
  JOIN pg_class c ON c.oid = l.relation
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN alter_table_targets target ON target.table_name = c.relname
  WHERE n.nspname = 'public'
    AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND (
      (a.pid IS NOT NULL AND a.datname = current_database() AND a.pid <> pg_backend_pid())
      OR l.pid IS NULL
    )
    -- Stage 02 ALTER TABLE statements acquire ACCESS EXCLUSIVE, which conflicts
    -- with every granted relation lock mode. Awaiting relation locks also block readiness.
    -- Prepared relation lock rows have NULL pid. PostgreSQL may retain the originating
    -- backend virtualtransaction there, so do not attribute a prepared GID or age per lock.
)
SELECT jsonb_build_object(
  'identity', jsonb_build_object(
    'database', current_database(),
    'databaseOid', (SELECT oid FROM pg_database WHERE datname = current_database()),
    'role', current_user,
    'serverVersion', current_setting('server_version'),
    'clusterName', current_setting('cluster_name', true)
  ),
  'migrations', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.name, m."startedAt") FROM migration_rows m), '[]'::jsonb),
  'objects', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'present', present) ORDER BY name) FROM object_inventory), '[]'::jsonb),
  'tables', COALESCE((
    SELECT jsonb_object_agg(t.table_name, jsonb_build_object(
      'exists', c.oid IS NOT NULL,
      'estimatedRows', COALESCE(s.n_live_tup, 0)::bigint,
      'totalBytes', CASE WHEN c.oid IS NULL THEN NULL ELSE pg_total_relation_size(c.oid) END
    ))
    FROM target_tables t
    LEFT JOIN pg_class c ON c.oid = to_regclass(format('public.%I', t.table_name))
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  ), '{}'::jsonb),
  'longTransactions', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t."xactAgeSeconds" DESC) FROM long_transactions t), '[]'::jsonb),
  'preparedTransactions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'gid', p.gid,
      'transaction', p.transaction,
      'preparedAt', p.prepared,
      'database', p.database
    ) ORDER BY p.prepared, p.gid)
    FROM pg_prepared_xacts p
    WHERE p.database = current_database()
  ), '[]'::jsonb),
  'relevantLocks', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l."blockerCount" DESC, l."xactAgeSeconds" DESC NULLS LAST, l.pid)
    FROM (SELECT * FROM relevant_locks ORDER BY "blockerCount" DESC, "xactAgeSeconds" DESC NULLS LAST, pid LIMIT 100) l), '[]'::jsonb)
)::text;

COMMIT;
