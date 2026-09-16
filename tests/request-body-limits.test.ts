import { describe, expect, it } from "vitest";
import { readJson } from "@/modules/days/day.http";

describe("JSON request limits", () => {
  it("rejects a declared oversized request before parsing", async () => {
    const response = await readJson(new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1048577" },
      body: "{}",
    }));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(413);
  });
});
