CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "sex" VARCHAR(6) NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "heightCm" DECIMAL(6,2) NOT NULL,
    "targetWeightKg" DECIMAL(6,2),
    "targetDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Profile_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "Profile_sex_check" CHECK ("sex" IN ('male', 'female')),
    CONSTRAINT "Profile_height_check" CHECK ("heightCm" > 0 AND "heightCm" <= 300),
    CONSTRAINT "Profile_target_weight_check" CHECK (
        "targetWeightKg" IS NULL OR ("targetWeightKg" > 0 AND "targetWeightKg" <= 500)
    )
);
