BEGIN READ ONLY;

\if :{?BODYCAST_WRITER_TOPOLOGY_JSON}
\else
\set BODYCAST_WRITER_TOPOLOGY_JSON null
\endif

WITH expected(name) AS (
  SELECT jsonb_array_elements_text('__EXPECTED_SCHEMA_OBJECTS_JSON__'::jsonb)
), object_inventory AS (
  SELECT e.name,
    CASE
      WHEN strpos(e.name, '.') > 0 THEN EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = split_part(e.name, '.', 1)
          AND c.column_name = split_part(e.name, '.', 2)
      )
      WHEN EXISTS (SELECT 1 FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.conname = e.name) THEN TRUE
      WHEN to_regclass(format('public.%I', e.name)) IS NOT NULL THEN TRUE
      WHEN EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = e.name) THEN TRUE
      ELSE FALSE
    END AS present,
    CASE
      WHEN strpos(e.name, '.') > 0 THEN 'column'
      WHEN EXISTS (SELECT 1 FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.conname = e.name) THEN 'constraint'
      WHEN to_regclass(format('public.%I', e.name)) IS NOT NULL THEN (
        SELECT CASE cl.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned-table' WHEN 'i' THEN 'index' WHEN 'I' THEN 'partitioned-index' WHEN 'S' THEN 'sequence' ELSE cl.relkind::text END
        FROM pg_class cl WHERE cl.oid = to_regclass(format('public.%I', e.name))
      )
      WHEN EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = e.name) THEN 'type'
      ELSE 'missing'
    END AS kind,
    CASE
      WHEN strpos(e.name, '.') > 0 THEN (
        SELECT format_type(a.atttypid, a.atttypmod) || '|nullable=' || (NOT a.attnotnull)::text || '|default=' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = to_regclass(format('public.%I', split_part(e.name, '.', 1)))
          AND a.attname = split_part(e.name, '.', 2) AND a.attnum > 0 AND NOT a.attisdropped
      )
      WHEN EXISTS (SELECT 1 FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.conname = e.name) THEN (
        SELECT c.contype::text || '|validated=' || c.convalidated::text || '|table=' || c.conrelid::regclass::text || '|definition=' || pg_get_constraintdef(c.oid, true)
        FROM pg_constraint c WHERE c.connamespace = 'public'::regnamespace AND c.conname = e.name
      )
      WHEN to_regclass(format('public.%I', e.name)) IS NOT NULL THEN (
        SELECT CASE
          WHEN cl.relkind IN ('i', 'I') THEN 'unique=' || i.indisunique::text || '|valid=' || i.indisvalid::text || '|definition=' || pg_get_indexdef(cl.oid)
          WHEN cl.relkind = 'S' THEN 'sequence=' || format_type(s.seqtypid, NULL) || '|start=' || s.seqstart::text || '|increment=' || s.seqincrement::text || '|min=' || s.seqmin::text || '|max=' || s.seqmax::text || '|ownedBy=' || COALESCE((
            SELECT owner.relname || '.' || att.attname
            FROM pg_depend dep
            LEFT JOIN pg_class owner ON owner.oid = dep.refobjid
            LEFT JOIN pg_attribute att ON att.attrelid = dep.refobjid AND att.attnum = dep.refobjsubid
            WHERE dep.classid = 'pg_class'::regclass AND dep.objid = cl.oid
              AND dep.refclassid = 'pg_class'::regclass AND dep.deptype IN ('a','i')
            ORDER BY dep.refobjid, dep.refobjsubid
            LIMIT 1
          ), '')
          ELSE 'relkind=' || cl.relkind::text
        END
        FROM pg_class cl
        LEFT JOIN pg_index i ON i.indexrelid = cl.oid
        LEFT JOIN pg_sequence s ON s.seqrelid = cl.oid
        WHERE cl.oid = to_regclass(format('public.%I', e.name))
      )
      WHEN EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = e.name) THEN (
        SELECT t.typtype::text || '|labels=' || COALESCE(string_agg(en.enumlabel, ',' ORDER BY en.enumsortorder), '')
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace LEFT JOIN pg_enum en ON en.enumtypid = t.oid
        WHERE n.nspname = 'public' AND t.typname = e.name GROUP BY t.typtype
      )
      ELSE NULL
    END AS signature
  FROM expected e
), migration_rows AS (
  SELECT migration_name AS name, checksum, started_at AS "startedAt", finished_at AS "finishedAt",
    rolled_back_at AS "rolledBackAt", logs IS NOT NULL AS "hasLogs", md5(COALESCE(logs, '')) AS "logsFingerprint"
  FROM public."_prisma_migrations"
), baseline_targets(table_name) AS (
  VALUES ('Workout'), ('Profile'), ('ModelEpisode'), ('PhysiologyV7Lifecycle'), ('DailyModelState'), ('StrengthDiarySession'), ('ExerciseCatalog'),
    ('ExperimentalSkeletalMuscleDeltaShadow'), ('ExperimentalCessationDetrainingShadow'), ('_prisma_migrations')
), target_tables AS (
  SELECT b.table_name, to_regclass(format('public.%I', b.table_name)) IS NOT NULL AS exists,
    COALESCE(c.reltuples::bigint, 0) AS "estimatedRows",
    COALESCE(pg_total_relation_size(c.oid), 0) AS "totalBytes"
  FROM baseline_targets b LEFT JOIN pg_class c ON c.oid = to_regclass(format('public.%I', b.table_name))
), ddl_targets(table_name, required_lock_mode) AS (
  VALUES
    -- CREATE TABLE ... FOREIGN KEY requires SHARE ROW EXCLUSIVE on each referenced parent.
    ('Workout', 'ShareRowExclusiveLock'),
    ('Profile', 'ShareRowExclusiveLock'),
    ('ModelEpisode', 'ShareRowExclusiveLock'),
    ('ExperimentalSkeletalMuscleDeltaShadow', 'AccessExclusiveLock'),
    ('ExperimentalCessationDetrainingShadow', 'AccessExclusiveLock'),
    -- Existing migration SQL adds columns to these relations; ALTER TABLE takes ACCESS EXCLUSIVE.
    ('PhysiologyV7Lifecycle', 'AccessExclusiveLock'),
    ('DailyModelState', 'AccessExclusiveLock')
), conflicting_locks AS (
  SELECT a.pid, c.relname AS relation, l.mode, l.granted,
    t.required_lock_mode AS "requiredLockMode",
    CASE WHEN l.pid IS NULL THEN 'prepared-transaction' ELSE 'backend' END AS "blockerType",
    a.state, a.wait_event_type AS "waitEventType", a.wait_event AS "waitEvent",
    floor(extract(epoch FROM (clock_timestamp() - a.xact_start)))::bigint AS "xactAgeSeconds"
  FROM pg_locks l
  JOIN pg_class c ON c.oid = l.relation
  LEFT JOIN pg_stat_activity a ON a.pid = l.pid
  JOIN ddl_targets t ON t.table_name = c.relname
  WHERE l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND (l.pid IS NULL OR l.pid <> pg_backend_pid())
    AND (
      (t.required_lock_mode = 'ShareRowExclusiveLock' AND l.mode IN (
        'RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareLock',
        'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'
      ))
      OR (t.required_lock_mode = 'AccessExclusiveLock' AND l.mode IN (
        'AccessShareLock', 'RowShareLock', 'RowExclusiveLock', 'ShareUpdateExclusiveLock',
        'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'
      ))
    )
), prepared_transactions AS (
  SELECT gid, transaction::text AS transaction, prepared AS "preparedAt", database
  FROM pg_prepared_xacts
), long_transactions AS (
  SELECT pid, state, floor(extract(epoch FROM (clock_timestamp() - xact_start)))::bigint AS "xactAgeSeconds",
    wait_event_type AS "waitEventType", wait_event AS "waitEvent"
  FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL
    AND xact_start < clock_timestamp() - interval '5 minutes'
), other_client_backends AS (
  -- The observer pid is the one explicitly identified preflight/migration
  -- connection. Every other client backend blocks, regardless of claimed
  -- application_name or client_addr; proxy/NAT identity is never inferred.
  -- Export presence only. The gate intentionally blocks every other client
  -- backend, but user/app/address/pid details are neither needed nor safe to
  -- publish in the signed preflight artifact or workflow summary.
  SELECT true AS present
  FROM pg_stat_activity
  WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()
)
SELECT json_build_object(
  'identity', json_build_object(
    'database', current_database(),
    'databaseOid', (SELECT oid::bigint FROM pg_database WHERE datname = current_database()),
    'clusterSystemIdentifier', (SELECT system_identifier::text FROM pg_control_system()),
    'role', current_user,
    'serverVersion', current_setting('server_version'),
    'serverAddress', inet_server_addr()::text,
    'serverPort', inet_server_port()
  ),
  'writerDrain', json_build_object(
    'schemaVersion', 1,
    'observerPid', pg_backend_pid(),
    'observerApplicationName', current_setting('application_name'),
    'observedAt', clock_timestamp(),
    'identityPolicy', 'no-other-client-backends',
    'topology', :'BODYCAST_WRITER_TOPOLOGY_JSON'::json,
    'activeClientBackends', COALESCE((SELECT json_agg(to_jsonb(c)) FROM other_client_backends c), '[]'::json)
  ),
  'migrations', COALESCE((SELECT json_agg(to_jsonb(m) ORDER BY m.name, m."startedAt") FROM migration_rows m), '[]'::json),
  'objects', COALESCE((SELECT json_agg(to_jsonb(o) ORDER BY o.name) FROM object_inventory o), '[]'::json),
  'tables', COALESCE((SELECT json_object_agg(t.table_name, json_build_object('exists', t.exists, 'estimatedRows', t."estimatedRows", 'totalBytes', t."totalBytes")) FROM target_tables t), '{}'::json),
  'readability', json_build_object(
    'Workout', json_build_object('rowCount', (SELECT count(*) FROM public."Workout")),
    'Profile', json_build_object('rowCount', (SELECT count(*) FROM public."Profile")),
    'ModelEpisode', json_build_object('rowCount', (SELECT count(*) FROM public."ModelEpisode")),
    'PhysiologyV7Lifecycle', json_build_object('rowCount', (SELECT count(*) FROM public."PhysiologyV7Lifecycle")),
    'DailyModelState', json_build_object('rowCount', (SELECT count(*) FROM public."DailyModelState")),
    'StrengthDiarySession', json_build_object('rowCount', (SELECT count(*) FROM public."StrengthDiarySession")),
    'ExerciseCatalog', json_build_object('rowCount', (SELECT count(*) FROM public."ExerciseCatalog"))
  ),
  'conflictingLocks', COALESCE((SELECT json_agg(to_jsonb(l)) FROM conflicting_locks l), '[]'::json),
  'preparedTransactions', COALESCE((SELECT json_agg(to_jsonb(p)) FROM prepared_transactions p), '[]'::json),
  'longTransactions', COALESCE((SELECT json_agg(to_jsonb(t)) FROM long_transactions t), '[]'::json)
);

COMMIT;
