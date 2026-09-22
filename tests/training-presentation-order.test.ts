import { describe, expect, it } from "vitest";

describe("training presentation order", () => {
  it("shows current sets newest first without changing set numbers", () => {
    const sets = [{ setNumber: 1 }, { setNumber: 4 }, { setNumber: 2 }, { setNumber: 3 }];
    expect(sets.slice().sort((left, right) => right.setNumber - left.setNumber).map((set) => set.setNumber)).toEqual([4, 3, 2, 1]);
    expect(sets.map((set) => set.setNumber)).toEqual([1, 4, 2, 3]);
  });
});
