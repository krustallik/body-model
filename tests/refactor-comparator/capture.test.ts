import { describe, expect, it } from "vitest";
import { toCanonicalEvidence } from "./capture";

describe("refactor comparator evidence serialization", () => {
  it("keeps object values explicit and preserves array order", () => {
    expect(toCanonicalEvidence({
      nullValue: null,
      undefinedValue: undefined,
      zero: 0,
      values: ["first", "second"],
    })).toEqual({
      nullValue: null,
      undefinedValue: { $type: "undefined" },
      zero: 0,
      values: ["first", "second"],
    });
  });

  it("preserves special numeric, date, bigint, decimal, and byte values", () => {
    const decimal = { constructor: { name: "Decimal" }, toString: () => "1.2300" };
    expect(toCanonicalEvidence({
      negativeZero: -0,
      notANumber: Number.NaN,
      positiveInfinity: Infinity,
      instant: new Date("2026-01-02T03:04:05.000Z"),
      integer: BigInt("9007199254740993"),
      decimal,
      bytes: new Uint8Array([1, 2, 3]),
    })).toEqual({
      bytes: { $type: "uint8array", value: "AQID" },
      decimal: { $type: "decimal", value: "1.2300" },
      instant: { $type: "date", value: "2026-01-02T03:04:05.000Z" },
      integer: { $type: "bigint", value: "9007199254740993" },
      negativeZero: { $type: "number", value: "-0" },
      notANumber: { $type: "number", value: "NaN" },
      positiveInfinity: { $type: "number", value: "Infinity" },
    });
  });

  it("does not conflate sparse array holes with null values", () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = null;
    expect(toCanonicalEvidence(sparse)).toEqual([
      { $type: "array-hole" },
      null,
    ]);
  });

  it("fails closed on cycles, symbols, functions, and invalid dates", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => toCanonicalEvidence(cycle)).toThrow(/circular/);
    expect(() => toCanonicalEvidence({ [Symbol("hidden")]: "value" })).toThrow(/symbol-keyed/);
    expect(() => toCanonicalEvidence(() => undefined)).toThrow(/functions or symbols/);
    expect(() => toCanonicalEvidence(new Date(Number.NaN))).toThrow(/invalid Date/);
  });
});
