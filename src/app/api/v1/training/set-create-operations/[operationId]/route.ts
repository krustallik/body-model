import { trainingService } from "@/modules/training/training.service";
import { trainingErrorResponse, trainingInternalError } from "@/modules/training/training.http";
import { SetCreateOperationConflictError } from "@/modules/training/training.errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ operationId: string }> },
): Promise<Response> {
  const parsed = z.string().uuid().safeParse((await params).operationId);
  if (!parsed.success) return Response.json({ error: "invalid_operation_id" }, { status: 400 });

  const requestedDigest = new URL(request.url).searchParams.get("digest");
  const digest = requestedDigest === null ? undefined : z.string().regex(/^[a-f0-9]{64}$/i).safeParse(requestedDigest);
  if (requestedDigest !== null && !digest?.success) {
    return Response.json({ error: "invalid_payload_digest" }, { status: 400 });
  }

  try {
    const result = await trainingService.getSetCreateOperation(parsed.data, undefined, digest?.success ? digest.data : undefined);
    if (result.state === "NOT_FOUND") {
      return Response.json({ operationId: parsed.data, state: "NOT_FOUND" }, { status: 404 });
    }
    if (result.state === "TOMBSTONED") {
      return Response.json({ operationId: parsed.data, state: "TOMBSTONED" }, { status: 410 });
    }
    if (result.state === "REJECTED") {
      return Response.json({
        operationId: parsed.data,
        state: "REJECTED",
        error: "set_create_operation_rejected",
      }, { status: 409 });
    }
    if (result.state === "PENDING") {
      return Response.json({ operationId: parsed.data, state: "PENDING" }, { status: 202 });
    }
    return Response.json({ operationId: parsed.data, state: "COMMITTED", set: result.set });
  } catch (error) {
    if (error instanceof SetCreateOperationConflictError) {
      return Response.json({ error: error.code }, { status: 409 });
    }
    return trainingErrorResponse(error) ?? trainingInternalError();
  }
}
