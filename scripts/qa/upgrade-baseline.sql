INSERT INTO "Profile" (id, sex, "dateOfBirth", "heightCm", locale)
VALUES (1, 'male', '1990-01-01', 180, 'en')
ON CONFLICT (id) DO NOTHING;

INSERT INTO "DailyHealthData" (date, "weightKg", "caloriesKcal", "rawPayload", "createdAt", "updatedAt")
VALUES ('2099-01-01', 80, 2000, '{"marker":"upgrade-baseline"}', NOW(), NOW())
ON CONFLICT (date) DO UPDATE SET "weightKg" = 80, "caloriesKcal" = 2000;

INSERT INTO "Workout" (
  "dailyHealthDataId", "sourceIdentity", type, "startAt", "endAt",
  "durationMinutes", "activeEnergyKcal", "hiddenFromHistory", "createdAt", "updatedAt"
)
SELECT id, 'ext:upgrade-baseline', 'Stair Climbing',
  '2099-01-01T10:00:00Z', '2099-01-01T11:00:00Z', 60, 300, false, NOW(), NOW()
FROM "DailyHealthData"
WHERE date = '2099-01-01'
ON CONFLICT DO NOTHING;
