import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { instantToLocalDateTime, localDateTimeToInstant } from "@/model/time-zone";
import { WorkIntervalOverlapError } from "./work-interval.errors";
import {
  PersistedWorkIntervalSchema,
  type CreateWorkIntervalInput,
  type PersistedWorkIntervalInput,
  type UpdateWorkIntervalInput,
} from "./work-interval.schema";

const workIntervalSelect = {
  id: true,
  date: true,
  startAt: true,
  endAt: true,
  timezone: true,
  category: true,
  breakMinutes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkIntervalSelect;

type WorkIntervalRecord = Prisma.WorkIntervalGetPayload<{ select: typeof workIntervalSelect }>;

export type WorkIntervalDto = {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  timezone: string;
  category: string;
  breakMinutes: number | null;
  breakSource: "user-entered" | "legacy-unreported";
  createdAt: string;
  updatedAt: string;
};

function toDto(record: WorkIntervalRecord): WorkIntervalDto {
  return {
    id: record.id,
    date: record.date,
    startTime: instantToLocalDateTime(record.startAt, record.timezone).time,
    endTime: instantToLocalDateTime(record.endAt, record.timezone).time,
    startAt: record.startAt.toISOString(),
    endAt: record.endAt.toISOString(),
    timezone: record.timezone,
    category: record.category,
    breakMinutes: record.breakMinutes,
    breakSource: record.breakMinutes === null ? "legacy-unreported" : "user-entered",
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function resolved(input: CreateWorkIntervalInput | PersistedWorkIntervalInput) {
  return {
    date: input.date,
    startAt: localDateTimeToInstant(input.date, input.startTime, input.timezone),
    endAt: localDateTimeToInstant(input.date, input.endTime, input.timezone),
    timezone: input.timezone,
    category: input.category,
    breakMinutes: input.breakMinutes,
  };
}

async function assertNoOverlap(
  transaction: Prisma.TransactionClient,
  startAt: Date,
  endAt: Date,
  excludedId?: number,
): Promise<void> {
  const overlap = await transaction.workInterval.findFirst({
    where: {
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(excludedId ? { id: { not: excludedId } } : {}),
    },
    select: { id: true },
  });
  if (overlap) throw new WorkIntervalOverlapError();
}

function isExclusionViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error.code === "P2004" || error.code === "P2010");
}

export class WorkIntervalRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async list(date?: string): Promise<WorkIntervalDto[]> {
    const records = await this.client.workInterval.findMany({
      where: date ? { date } : undefined,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      select: workIntervalSelect,
    });
    return records.map(toDto);
  }

  async create(input: CreateWorkIntervalInput): Promise<WorkIntervalDto> {
    const data = resolved(input);
    try {
      const record = await this.client.$transaction(async (transaction) => {
        await assertNoOverlap(transaction, data.startAt, data.endAt);
        return transaction.workInterval.create({ data, select: workIntervalSelect });
      });
      return toDto(record);
    } catch (error) {
      if (isExclusionViolation(error)) throw new WorkIntervalOverlapError();
      throw error;
    }
  }

  async update(id: number, patch: UpdateWorkIntervalInput): Promise<WorkIntervalDto | null> {
    try {
      const record = await this.client.$transaction(async (transaction) => {
        const current = await transaction.workInterval.findUnique({
          where: { id }, select: workIntervalSelect,
        });
        if (!current) return null;
        const currentDto = toDto(current);
        const merged = PersistedWorkIntervalSchema.parse({
          date: patch.date ?? currentDto.date,
          startTime: patch.startTime ?? currentDto.startTime,
          endTime: patch.endTime ?? currentDto.endTime,
          timezone: patch.timezone ?? currentDto.timezone,
          category: patch.category ?? currentDto.category,
          breakMinutes: patch.breakMinutes ?? currentDto.breakMinutes,
        });
        const data = resolved(merged);
        await assertNoOverlap(transaction, data.startAt, data.endAt, id);
        return transaction.workInterval.update({ where: { id }, data, select: workIntervalSelect });
      });
      return record ? toDto(record) : null;
    } catch (error) {
      if (isExclusionViolation(error)) throw new WorkIntervalOverlapError();
      throw error;
    }
  }

  async delete(id: number): Promise<boolean> {
    return (await this.client.workInterval.deleteMany({ where: { id } })).count > 0;
  }
}

export const workIntervalRepository = new WorkIntervalRepository();
