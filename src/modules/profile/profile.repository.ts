import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ProfileInput } from "./profile.schema";
import type { ProfileDto } from "./profile.types";

const SINGLETON_PROFILE_ID = 1;

const profileSelect = {
  id: true,
  locale: true,
  sex: true,
  dateOfBirth: true,
  heightCm: true,
  targetWeightKg: true,
  targetDate: true,
  autoAdvanceExercises: true,
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
    locale: record.locale as ProfileDto["locale"],
    sex: record.sex as ProfileDto["sex"],
    dateOfBirth: calendarDate(record.dateOfBirth),
    heightCm: record.heightCm.toNumber(),
    targetWeightKg: record.targetWeightKg?.toNumber() ?? null,
    targetDate: record.targetDate ? calendarDate(record.targetDate) : null,
    autoAdvanceExercises: record.autoAdvanceExercises ?? false,
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
    const profileData = {
      locale: input.locale,
      sex: input.sex,
      dateOfBirth: asDatabaseDate(input.dateOfBirth),
      heightCm: input.heightCm,
      autoAdvanceExercises: input.autoAdvanceExercises ?? false,
    };
    // Goal fields remain in the profile DTO for legacy API clients. New profile writes
    // omit them, so only an explicitly supplied legacy value may update those columns.
    const legacyGoalUpdate = {
      ...(input.targetWeightKg !== undefined ? { targetWeightKg: input.targetWeightKg } : {}),
      ...(input.targetDate !== undefined
        ? { targetDate: input.targetDate === null ? null : asDatabaseDate(input.targetDate) }
        : {}),
    };
    const record = await this.client.profile.upsert({
      where: { id: SINGLETON_PROFILE_ID },
      create: {
        id: SINGLETON_PROFILE_ID,
        ...profileData,
        targetWeightKg: input.targetWeightKg ?? null,
        targetDate: input.targetDate ? asDatabaseDate(input.targetDate) : null,
      },
      update: { ...profileData, ...legacyGoalUpdate },
      select: profileSelect,
    });
    return toDto(record);
  }
}

export const profileRepository = new ProfileRepository();
