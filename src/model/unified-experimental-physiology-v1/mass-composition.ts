import type { UnifiedNumericEnvelopeV1 } from "./contracts";

export function envelope(
  point: number | null,
  lower: number | null = point,
  upper: number | null = point,
): UnifiedNumericEnvelopeV1 {
  return { point, lower, upper, representation: "engineering-range" };
}

export function subtractEnvelope(current: UnifiedNumericEnvelopeV1 | null, prior: UnifiedNumericEnvelopeV1 | null): UnifiedNumericEnvelopeV1 | null {
  if (current === null || prior === null || current.point === null || prior.point === null) return null;
  if (current.lower === null || current.upper === null || prior.lower === null || prior.upper === null) return null;
  return envelope(current.point - prior.point, current.lower - prior.lower, current.upper - prior.upper);
}

export function addEnvelopes(parts: readonly (UnifiedNumericEnvelopeV1 | null)[]): UnifiedNumericEnvelopeV1 | null {
  if (parts.some((part) => part === null || part.point === null || part.lower === null || part.upper === null)) return null;
  const defined = parts as UnifiedNumericEnvelopeV1[];
  return envelope(
    defined.reduce((sum, part) => sum + part.point!, 0),
    defined.reduce((sum, part) => sum + part.lower!, 0),
    defined.reduce((sum, part) => sum + part.upper!, 0),
  );
}
