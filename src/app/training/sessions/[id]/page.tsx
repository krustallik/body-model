import type { Metadata } from "next";
import { Suspense } from "react";
import { SessionClient } from "./session-client";

export const metadata: Metadata = {
  title: "Training session · BodyCast",
  description: "Live strength session or diary match details.",
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function TrainingSessionPage({ params }: PageProps) {
  const { id } = await params;
  const sessionId = Number(id);
  const resolved = Number.isFinite(sessionId) && sessionId >= 1 ? sessionId : 0;
  return (
    <Suspense fallback={null}>
      <SessionClient sessionId={resolved} />
    </Suspense>
  );
}
