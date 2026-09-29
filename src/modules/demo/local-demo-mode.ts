/** Server-only switch for the explicit local visual QA mode. */
export function isLocalDemoMode(): boolean {
  return (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")
    && process.env.BODYCAST_DEMO_MODE === "1";
}

export function localDemoReadOnlyResponse(): Response {
  return Response.json({ error: "demo_read_only" }, { status: 409 });
}
