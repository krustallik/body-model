import type { Metadata } from "next";
import { Suspense } from "react";
import { SessionEditClient } from "./session-edit-client";

export const metadata: Metadata = {
  title: "Edit training diary · BodyCast",
  description: "Edit historical, completed, or cancelled strength diary sessions.",
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SessionEditPage({ params }: PageProps) {
  const { id } = await params;
  const sessionId = Number(id);
  return (
    <Suspense fallback={null}>
      <SessionEditClient sessionId={Number.isFinite(sessionId) && sessionId > 0 ? sessionId : 0} />
    </Suspense>
  );
}
