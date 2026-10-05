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
    'Workout', jsonb_build_object('rowCount', (SELECT count(*) FROM public."Workout")),
    'Profile', jsonb_build_object('rowCount', (SELECT count(*) FROM public."Profile")),
    'ModelEpisode', jsonb_build_object('rowCount', (SELECT count(*) FROM public."ModelEpisode")),
    'PhysiologyV7Lifecycle', jsonb_build_object('rowCount', (SELECT count(*) FROM public."PhysiologyV7Lifecycle")),
    'DailyModelState', jsonb_build_object('rowCount', (SELECT count(*) FROM public."DailyModelState")),
    'StrengthDiarySession', jsonb_build_object('rowCount', (SELECT count(*) FROM public."StrengthDiarySession")),
    'ExerciseCatalog', jsonb_build_object('rowCount', (SELECT count(*) FROM public."ExerciseCatalog"))
  )
)::text;
COMMIT;
