BEGIN READ ONLY;
SELECT jsonb_build_object(
  'migrationHistory', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', migration_name,
      'checksum', checksum,
      'startedAt', started_at,
      'finishedAt', finished_at,
      'rolledBackAt', rolled_back_at,
      'hasLogs', logs IS NOT NULL,
      'logsFingerprint', md5(COALESCE(logs, ''))
    ) ORDER BY migration_name, started_at)
    FROM public."_prisma_migrations"
  ), '[]'::jsonb),
  'readability', jsonb_build_object(
    'StrengthDiarySession', jsonb_build_object(
      'rowCount', (SELECT count(*) FROM public."StrengthDiarySession")
    ),
    'ExerciseCatalog', jsonb_build_object(
      'rowCount', (SELECT count(*) FROM public."ExerciseCatalog")
    )
  )
)::text;
COMMIT;
