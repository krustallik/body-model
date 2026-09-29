import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  STAGE01_PULL_ROWS_V1,
  STAGE01_PUSH_ROWS_V1,
  type Stage01GoldenRowV1,
} from "./fixtures/training-load-accounting-stage01-golden-v1";

const stage01ExpectedPath = resolve(
  process.cwd(),
  "tests/fixtures/training-history-stage01/expected-v1.ts",
);
const stage01MergedFixtureCommit = "387a08ce84e393bba2f6285bc84de87e97e82216";
const stage01ExpectedText = existsSync(stage01ExpectedPath)
  ? readFileSync(stage01ExpectedPath, "utf8")
  : (() => {
    try {
      return execFileSync("git", [
        "show",
        `${stage01MergedFixtureCommit}:tests/fixtures/training-history-stage01/expected-v1.ts`,
      ], { encoding: "utf8" });
    } catch {
      return null;
    }
  })();

function unwrapExpression(expression: ts.Expression | null): ts.Expression | null {
  let value = expression;
  while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) {
    value = value.expression;
  }
  return value;
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  const match = object.properties.find((entry) => (
    ts.isPropertyAssignment(entry)
    && ts.isIdentifier(entry.name)
    && entry.name.text === name
  ));
  return match && ts.isPropertyAssignment(match) ? match.initializer : null;
}

function rowsFromMergedStage01(): {
  pull: Stage01GoldenRowV1[];
  push: Stage01GoldenRowV1[];
} {
  const source = ts.createSourceFile(
    stage01ExpectedPath,
    stage01ExpectedText ?? "",
    ts.ScriptTarget.Latest,
    true,
  );
  let expected: ts.Expression | null = null;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)
          && declaration.name.text === "EXPECTED_GOLDEN_V1") {
        expected = unwrapExpression(declaration.initializer ?? null);
      }
    }
  }
  if (!expected || !ts.isObjectLiteralExpression(expected)) {
    throw new Error("Merged Stage 01 EXPECTED_GOLDEN_V1 fixture was not found");
  }

  const sectionRows = (sectionName: "pull" | "push"): Stage01GoldenRowV1[] => {
    const section = property(expected as ts.ObjectLiteralExpression, sectionName);
    if (!section || !ts.isObjectLiteralExpression(section)) {
      throw new Error(`Merged Stage 01 ${sectionName} fixture was not found`);
    }
    const rows = property(section, "rows");
    if (!rows || !ts.isArrayLiteralExpression(rows)) {
      throw new Error(`Merged Stage 01 ${sectionName} rows were not found`);
    }
    return rows.elements.map((row) => JSON.parse(row.getText(source)) as Stage01GoldenRowV1);
  };

  return { pull: sectionRows("pull"), push: sectionRows("push") };
}

describe("Stage 01 golden fixture compatibility", () => {
  it.skipIf(stage01ExpectedText === null)(
    "keeps every Stage 02 literal row identical to merged Stage 01 expected rows",
    () => {
      const expected = rowsFromMergedStage01();
      expect(STAGE01_PULL_ROWS_V1).toEqual(expected.pull);
      expect(STAGE01_PUSH_ROWS_V1).toEqual(expected.push);
    },
  );
});
