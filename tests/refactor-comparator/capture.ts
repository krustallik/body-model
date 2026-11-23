import { appendFileSync } from "node:fs";

export type EvidenceValue =
  | null
  | boolean
  | number
  | string
  | { readonly [key: string]: EvidenceValue }
  | readonly EvidenceValue[];

function toEvidenceValue(value: unknown, seen: Set<object>): EvidenceValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "undefined") return { $type: "undefined" };
  if (typeof value === "bigint") return { $type: "bigint", value: value.toString() };
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $type: "number", value: "NaN" };
    if (value === Infinity) return { $type: "number", value: "Infinity" };
    if (value === -Infinity) return { $type: "number", value: "-Infinity" };
    if (Object.is(value, -0)) return { $type: "number", value: "-0" };
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError("Comparator evidence cannot contain functions or symbols.");
  }
  if (typeof value !== "object") throw new TypeError("Comparator evidence contains an unsupported value.");

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError("Comparator evidence contains an invalid Date.");
    return { $type: "date", value: value.toISOString() };
  }
  if (Buffer.isBuffer(value)) return { $type: "buffer", value: value.toString("base64") };
  if (value instanceof Uint8Array) return { $type: "uint8array", value: Buffer.from(value).toString("base64") };
  if (seen.has(value)) throw new TypeError("Comparator evidence cannot contain circular references.");

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) => (
        Object.hasOwn(value, index)
          ? toEvidenceValue(value[index], seen)
          : { $type: "array-hole" }
      ));
    }

    const constructorName = value.constructor?.name;
    if (constructorName === "Decimal" && "toString" in value && typeof value.toString === "function") {
      return { $type: "decimal", value: value.toString() };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Comparator evidence cannot serialize ${constructorName ?? "unknown"} objects.`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Comparator evidence cannot contain symbol-keyed properties.");
    }

    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, toEvidenceValue(entry, seen)]));
  } finally {
    seen.delete(value);
  }
}

export function toCanonicalEvidence(value: unknown): EvidenceValue {
  return toEvidenceValue(value, new Set());
}

export function recordRefactorObservation(caseId: string, value: unknown): void {
  const target = process.env.BODYCAST_REFACTOR_CAPTURE_FILE;
  if (!target) return;
  if (!/^[A-Z0-9][A-Za-z0-9._/-]{1,180}$/.test(caseId)) {
    throw new TypeError("Comparator observation case ID is invalid.");
  }

  const observation = toCanonicalEvidence({ caseId, value });
  appendFileSync(target, `${JSON.stringify(observation)}\n`, { encoding: "utf8", flag: "a" });
}
