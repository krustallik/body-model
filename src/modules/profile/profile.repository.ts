import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ProfileInput } from "./profile.schema";
import type { ProfileDto } from "./profile.types";

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

function calendarDate(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function toDto(record: ProfileRecord): ProfileDto {
  return {
    id: record.id,
    locale: record.locale as ProfileDto["locale"],
    sex: record.sex as ProfileDto["sex"],
    dateOfBirth: calendarDate(record.dateOfBirth),
    heightCm: record.heightCm?.toNumber() ?? null,
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

  async get(profileId: number): Promise<ProfileDto | null> {
    const record = await this.client.profile.findUnique({
      where: { id: profileId },
      select: profileSelect,
    });
    return record ? toDto(record) : null;
  }

  async update(profileId: number, input: ProfileInput): Promise<ProfileDto> {
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
    const record = await this.client.profile.update({
      where: { id: profileId },
      data: { ...profileData, ...legacyGoalUpdate },
      select: profileSelect,
    });
    return toDto(record);
  }
}

export const profileRepository = new ProfileRepository();
