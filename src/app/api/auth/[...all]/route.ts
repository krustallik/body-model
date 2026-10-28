import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { readBoundedRequestBody } from "@/modules/auth/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(request: Request): Promise<Response> {
  const body = await readBoundedRequestBody(request);
  if (body instanceof Response) return body;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const buffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(buffer).set(body);
  return handlers.POST(new Request(request.url, { method: "POST", headers, body: buffer }));
}
