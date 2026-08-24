import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE, PATCH } from "@/app/api/v1/work-intervals/[id]/route";
import { GET, POST } from "@/app/api/v1/work-intervals/route";

const prisma = new PrismaClient();
const date = "2040-02-01";
const jsonRequest = (url: string, body: unknown) => new Request(url, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("work interval CRUD with PostgreSQL", () => {
  beforeAll(() => prisma.workInterval.deleteMany({ where: { date } }));
  afterAll(async () => {
    await prisma.workInterval.deleteMany({ where: { date } });
    await prisma.$disconnect();
  });

  it("creates timezone-aware intervals and prevents overlap", async () => {
    const first = await POST(jsonRequest("http://localhost/api/v1/work-intervals", {
      date, startTime: "08:00", endTime: "12:00", category: "standingLight",
      timezone: "Europe/Bratislava", breakMinutes: 30,
    }));
    expect(first.status).toBe(201);
    const created = (await first.json()).interval;
    expect(created).toMatchObject({
      startTime: "08:00", endTime: "12:00", startAt: "2040-02-01T07:00:00.000Z",
      breakMinutes: 30, breakSource: "user-entered",
    });

    const invalidBreak = await POST(jsonRequest("http://localhost/api/v1/work-intervals", {
      date, startTime: "16:00", endTime: "20:00", category: "standingLight",
      breakMinutes: 240,
    }));
    expect(invalidBreak.status).toBe(400);
    await expect(prisma.workInterval.create({
      data: {
        date,
        startAt: new Date("2040-02-01T15:00:00.000Z"),
        endAt: new Date("2040-02-01T19:00:00.000Z"),
        timezone: "Europe/Bratislava",
        category: "standingLight",
        breakMinutes: 240,
      },
    })).rejects.toThrow();

    const overlap = await POST(jsonRequest("http://localhost/api/v1/work-intervals", {
      date, startTime: "11:00", endTime: "13:00", category: "manualLight",
      breakMinutes: 0,
    }));
    expect(overlap.status).toBe(409);

    const adjacent = await POST(jsonRequest("http://localhost/api/v1/work-intervals", {
      date, startTime: "12:00", endTime: "16:00", category: "manualLight",
      breakMinutes: 0,
    }));
    expect(adjacent.status).toBe(201);
    const adjacentId = (await adjacent.json()).interval.id as number;

    const list = await GET(new Request(`http://localhost/api/v1/work-intervals?date=${date}`));
    expect((await list.json()).intervals).toHaveLength(2);

    const patched = await PATCH(
      jsonRequest("http://localhost", { category: "manualModerate" }),
      context(adjacentId),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).interval.category).toBe("manualModerate");
    expect((await DELETE(new Request("http://localhost"), context(adjacentId))).status).toBe(204);
  });
});
