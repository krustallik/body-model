import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ProfileInput } from "./profile.schema";
import type { ProfileDto } from "./profile.types";

const SINGLETON_PROFILE_ID = 1;

const profileSelect = {
  id: true,
  sex: true,
  dateOfBirth: true,
  heightCm: true,
  targetWeightKg: true,
  targetDate: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProfileSelect;

type ProfileRecord = Prisma.ProfileGetPayload<{ select: typeof profileSelect }>;

function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toDto(record: ProfileRecord): ProfileDto {
  return {
    id: record.id,
    sex: record.sex as ProfileDto["sex"],
    dateOfBirth: calendarDate(record.dateOfBirth),
    heightCm: record.heightCm.toNumber(),
    targetWeightKg: record.targetWeightKg?.toNumber() ?? null,
    targetDate: record.targetDate ? calendarDate(record.targetDate) : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function asDatabaseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export class ProfileRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async get(): Promise<ProfileDto | null> {
    const record = await this.client.profile.findUnique({
      where: { id: SINGLETON_PROFILE_ID },
      select: profileSelect,
    });
    return record ? toDto(record) : null;
  }

  async upsert(input: ProfileInput): Promise<ProfileDto> {
    const data = {
      sex: input.sex,
      dateOfBirth: asDatabaseDate(input.dateOfBirth),
      heightCm: input.heightCm,
      targetWeightKg: input.targetWeightKg ?? null,
      targetDate: input.targetDate ? asDatabaseDate(input.targetDate) : null,
    };
    const record = await this.client.profile.upsert({
      where: { id: SINGLETON_PROFILE_ID },
      create: { id: SINGLETON_PROFILE_ID, ...data },
      update: data,
      select: profileSelect,
    });
    return toDto(record);
  }
}

export const profileRepository = new ProfileRepository();
