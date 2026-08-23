import { readJson, validationResponse } from "@/modules/days/day.http";
import { WorkIntervalOverlapError } from "@/modules/work-intervals/work-interval.errors";
import { workIntervalRepository } from "@/modules/work-intervals/work-interval.repository";
import {
  UpdateWorkIntervalSchema,
  WorkIntervalIdParamsSchema,
} from "@/modules/work-intervals/work-interval.schema";

async function parseId(params: Promise<{ id: string }>): Promise<number | Response> {
  const parsed = WorkIntervalIdParamsSchema.safeParse(await params);
  return parsed.success ? parsed.data.id : validationResponse(parsed.error);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = await parseId(params);
  if (id instanceof Response) return id;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const parsed = UpdateWorkIntervalSchema.safeParse(body);
  if (!parsed.success) return validationResponse(parsed.error);
  try {
    const interval = await workIntervalRepository.update(id, parsed.data);
    return interval
      ? Response.json({ interval })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    if (error instanceof WorkIntervalOverlapError) {
      return Response.json({ error: "interval_overlap" }, { status: 409 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const id = await parseId(params);
  if (id instanceof Response) return id;
  try {
    return await workIntervalRepository.delete(id)
      ? new Response(null, { status: 204 })
      : Response.json({ error: "not_found" }, { status: 404 });
  } catch {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
