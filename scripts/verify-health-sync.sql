SELECT date, "weightKg", steps, "rawPayload"
FROM "DailyHealthData"
ORDER BY date;

SELECT COUNT(*) AS daily_count FROM "DailyHealthData";
SELECT COUNT(*) AS workout_count FROM "Workout";

SELECT d.date, w.type, w."externalId", w."energyKcal"
FROM "Workout" w
JOIN "DailyHealthData" d ON d.id = w."dailyHealthDataId"
ORDER BY d.date, w.id;
