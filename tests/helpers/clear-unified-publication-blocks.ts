import type { PrismaClient } from "@prisma/client";
import { PhysiologyV7PersistenceRepository } from "@/modules/model-episodes/physiology-v7-persistence.repository";

export type UnifiedPublicationBlockSource = "health" | "training" | "day" | "stepper";

export interface UnifiedPublicationBlockIdentity {
  profileId: number;
  source: UnifiedPublicationBlockSource;
  sourceKey: string;
}

/** Clear only durable fences created by the owning integration fixture. */
export async function clearUnifiedPublicationBlockFixtures(
  client: PrismaClient,
  identities: readonly UnifiedPublicationBlockIdentity[],
): Promise<void> {
  const repository = new PhysiologyV7PersistenceRepository(client);
  for (const identity of identities) {
    const token = await repository.readUnifiedPublicationBlockToken(identity);
    if (!token) continue;
    const cleared = await repository.clearUnifiedPublicationBlock({
      ...identity,
      expectedRevision: token.revision,
      expectedFromDate: token.fromDate,
    });
    if (!cleared || await repository.readUnifiedPublicationBlockToken(identity)) {
      throw new Error("Unified publication fixture fence changed during cleanup.");
    }
  }
}
