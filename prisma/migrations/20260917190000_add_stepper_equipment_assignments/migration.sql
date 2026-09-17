CREATE TABLE "StepperEquipmentAssignment" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL DEFAULT 1,
    "machineFamily" VARCHAR(64) NOT NULL,
    "configuration" VARCHAR(32) NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepperEquipmentAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StepperEquipmentAssignment_profileId_effectiveFrom_effectiveTo_idx"
ON "StepperEquipmentAssignment"("profileId", "effectiveFrom", "effectiveTo");

ALTER TABLE "StepperEquipmentAssignment"
ADD CONSTRAINT "StepperEquipmentAssignment_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
