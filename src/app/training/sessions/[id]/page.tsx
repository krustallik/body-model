import type { Metadata } from "next";
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
  if (!Number.isFinite(sessionId) || sessionId < 1) {
    return <SessionClient sessionId={0} />;
  }
  return <SessionClient sessionId={sessionId} />;
}
