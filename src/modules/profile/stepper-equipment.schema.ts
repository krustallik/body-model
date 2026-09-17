import { z } from "zod";

export const STEPPER_MACHINE_FAMILY = "DOMYOS_MS100" as const;
export const STEPPER_CONFIGURATION = "fixed" as const;

export const StepperEquipmentAssignmentInputSchema = z.object({
  effectiveFrom: z.string().datetime({ offset: true }),
}).strict();

export type StepperEquipmentAssignmentInput = z.infer<typeof StepperEquipmentAssignmentInputSchema>;
export type StepperEquipmentAssignmentDto = {
  id: number;
  machineFamily: typeof STEPPER_MACHINE_FAMILY;
  configuration: typeof STEPPER_CONFIGURATION;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
};
