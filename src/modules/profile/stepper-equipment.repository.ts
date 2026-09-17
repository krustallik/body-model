import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  STEPPER_CONFIGURATION,
  STEPPER_MACHINE_FAMILY,
  type StepperEquipmentAssignmentDto,
} from "./stepper-equipment.schema";

const PROFILE_ID = 1;
const assignmentSelect = {
  id: true,
  machineFamily: true,
  configuration: true,
  effectiveFrom: true,
  effectiveTo: true,
  createdAt: true,
} satisfies Prisma.StepperEquipmentAssignmentSelect;

type AssignmentRecord = Prisma.StepperEquipmentAssignmentGetPayload<{ select: typeof assignmentSelect }>;

function toDto(record: AssignmentRecord): StepperEquipmentAssignmentDto {
  if (record.machineFamily !== STEPPER_MACHINE_FAMILY || record.configuration !== STEPPER_CONFIGURATION) {
    throw new Error("Unsupported persisted stepper equipment assignment");
  }
  return {
    id: record.id,
    machineFamily: STEPPER_MACHINE_FAMILY,
    configuration: STEPPER_CONFIGURATION,
    effectiveFrom: record.effectiveFrom.toISOString(),
    effectiveTo: record.effectiveTo?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

/** A configuration change closes history and creates a new immutable interval. */
export class StepperEquipmentRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async list(): Promise<StepperEquipmentAssignmentDto[]> {
    const records = await this.client.stepperEquipmentAssignment.findMany({
      where: { profileId: PROFILE_ID },
      orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
      select: assignmentSelect,
    });
    return records.map(toDto);
  }

  async configureMs100(effectiveFrom: string): Promise<StepperEquipmentAssignmentDto> {
    const at = new Date(effectiveFrom);
    return this.client.$transaction(async (transaction) => {
      const current = await transaction.stepperEquipmentAssignment.findFirst({
        where: { profileId: PROFILE_ID, effectiveTo: null },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      });
      if (current && current.effectiveFrom.getTime() >= at.getTime()) {
        throw new Error("Stepper equipment effectiveFrom must be later than the current assignment");
      }
      if (current) {
        await transaction.stepperEquipmentAssignment.update({
          where: { id: current.id }, data: { effectiveTo: at },
        });
      }
      const created = await transaction.stepperEquipmentAssignment.create({
        data: {
          profileId: PROFILE_ID,
          machineFamily: STEPPER_MACHINE_FAMILY,
          configuration: STEPPER_CONFIGURATION,
          effectiveFrom: at,
        },
        select: assignmentSelect,
      });
      return toDto(created);
    });
  }
}

export const stepperEquipmentRepository = new StepperEquipmentRepository();
