import { readJson, validationResponse } from "@/modules/days/day.http";
import { WorkIntervalOverlapError } from "@/modules/work-intervals/work-interval.errors";
import { workIntervalRepository } from "@/modules/work-intervals/work-interval.repository";
import {
  CreateWorkIntervalSchema,
  WorkIntervalListQuerySchema,
} from "@/modules/work-intervals/work-interval.schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const query = WorkIntervalListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return validationResponse(query.error);
  try {
    return Response.json({ intervals: await workIntervalRepository.list(query.data.date) });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = CreateWorkIntervalSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    return Response.json({ interval: await workIntervalRepository.create(parsed.data) }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkIntervalOverlapError) {
      return Response.json({ error: "interval_overlap" }, { status: 409 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
