import type { Metadata } from "next";
import { FromWorkoutClient } from "./from-workout-client";

export const metadata: Metadata = {
  title: "Add historical training · BodyCast",
  description: "Create a retrospective Training Diary entry for a Garmin strength workout.",
};

type PageProps = {
  params: Promise<{ workoutId: string }>;
};

export default async function FromWorkoutPage({ params }: PageProps) {
  const { workoutId } = await params;
  const id = Number(workoutId);
  return <FromWorkoutClient workoutId={Number.isFinite(id) && id > 0 ? id : 0} />;
}
