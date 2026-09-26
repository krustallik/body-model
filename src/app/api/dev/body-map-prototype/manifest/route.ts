import { readBodyMapPrototypeManifest } from "../manifest-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  try {
    const { content } = await readBodyMapPrototypeManifest(process.cwd());
    return new Response(content, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Prototype manifest is not generated yet.", { status: 503 });
  }
}
