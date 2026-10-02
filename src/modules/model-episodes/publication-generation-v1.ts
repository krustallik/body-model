export type PhysiologyPublicationGenerationV1 = {
  invalidationGeneration: number;
  productionStaleFromDate: string | null;
  productionPublishedGeneration: number | null;
  unifiedPublishedGeneration?: number | null;
};

export function isProductionGenerationCurrentV1(
  lifecycle: PhysiologyPublicationGenerationV1 | null,
): lifecycle is PhysiologyPublicationGenerationV1 & { productionPublishedGeneration: number } {
  return lifecycle !== null
    && lifecycle.productionStaleFromDate === null
    && lifecycle.productionPublishedGeneration !== null
    && lifecycle.productionPublishedGeneration === lifecycle.invalidationGeneration;
}

export function isUnifiedGenerationCurrentV1(
  lifecycle: PhysiologyPublicationGenerationV1 | null,
): lifecycle is PhysiologyPublicationGenerationV1 & {
  productionPublishedGeneration: number;
  unifiedPublishedGeneration: number;
} {
  return isProductionGenerationCurrentV1(lifecycle)
    && lifecycle.unifiedPublishedGeneration !== null
    && lifecycle.unifiedPublishedGeneration === lifecycle.productionPublishedGeneration;
}
