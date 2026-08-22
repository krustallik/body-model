/**
 * Gross standard MET bands for level, firm-surface walking from the 2024
 * Adult Compendium. Rounded gaps are conservatively assigned to the lower band.
 * https://pacompendium.com/walking/
 */
export const WALKING_MET_BANDS = [
  { minimumSpeedKmh: 0, met: 2.3 },
  { minimumSpeedKmh: 3.2, met: 2.8 },
  { minimumSpeedKmh: 4.0, met: 3.0 },
  { minimumSpeedKmh: 4.8, met: 3.8 },
  { minimumSpeedKmh: 5.6, met: 4.8 },
  { minimumSpeedKmh: 6.4, met: 5.5 },
  { minimumSpeedKmh: 7.2, met: 7.0 },
  { minimumSpeedKmh: 8.0, met: 8.5 },
] as const;

export const MAX_SUPPORTED_WALKING_SPEED_KMH = 8.9;

/** Standard MET convention used by the Adult Compendium. */
export const RESTING_MET = 1;

/** Conservative default for varied-resistance, multiple-exercise lifting. */
export const DEFAULT_STRENGTH_MET = 3.5;
