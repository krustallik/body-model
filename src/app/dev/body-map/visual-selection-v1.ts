export type SelectableVisualRegionV1 = {
  visualRegionId: string;
  anatomyId: string;
  anatomyIds?: readonly string[];
};

/**
 * A ray hit may originate from either physical side, but selection resolves
 * through taxonomy IDs and always includes every represented bilateral mesh.
 */
export function resolveSelectedVisualRegionIdsV1(
  regions: readonly SelectableVisualRegionV1[],
  selectedAnatomyIds: ReadonlySet<string>,
  pickedVisualRegionId: string | null,
): string[] {
  if (pickedVisualRegionId) {
    const pickedRegion = regions.find(({ visualRegionId }) => visualRegionId === pickedVisualRegionId);
    const pickedAnatomyIds = pickedRegion?.anatomyIds ?? (pickedRegion ? [pickedRegion.anatomyId] : []);
    if (pickedRegion && pickedAnatomyIds.some((anatomyId) => selectedAnatomyIds.has(anatomyId))) {
      return regions
        .filter(({ anatomyId, anatomyIds }) =>
          (anatomyIds ?? [anatomyId]).some((id) => pickedAnatomyIds.includes(id) && selectedAnatomyIds.has(id)),
        )
        .map(({ visualRegionId }) => visualRegionId);
    }
  }

  return regions
    .filter(({ anatomyId, anatomyIds }) => (anatomyIds ?? [anatomyId]).some((id) => selectedAnatomyIds.has(id)))
    .map(({ visualRegionId }) => visualRegionId);
}
