import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BodyCast cursor styles", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const interactiveCursor = readFileSync("public/bodycast-cursor-interactive.svg", "utf8");

  it("uses the branded interactive cursor only on fine pointers with a system pointer fallback", () => {
    expect(css).toContain("--bodycast-cursor-interactive: url(\"/bodycast-cursor-interactive.svg\") 3 2, pointer;");
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(interactiveCursor).toContain("data:image/png;base64,");
  });

  it("keeps text-entry, disabled, and busy cursor semantics", () => {
    expect(css).toContain("html body :where(");
    expect(css).toContain("cursor: text !important;");
    expect(css).toContain("cursor: not-allowed !important;");
    expect(css).toContain("cursor: progress !important;");
    expect(css.indexOf("@media (hover: hover) and (pointer: fine)")).toBeLessThan(css.indexOf("cursor: text !important;"));
    expect(css.indexOf("cursor: text !important;")).toBeLessThan(css.indexOf("cursor: not-allowed !important;"));
    expect(css.indexOf("cursor: not-allowed !important;")).toBeLessThan(css.indexOf("cursor: progress !important;"));
  });
});
