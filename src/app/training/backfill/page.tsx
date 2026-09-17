import type { Metadata } from "next";
import { BackfillClient } from "./backfill-client";

export const metadata: Metadata = {
  title: "Training history backfill · BodyCast",
  description: "Reconstruct historical Garmin strength workouts in the Training Diary.",
};

export default function TrainingBackfillPage() {
  return <BackfillClient />;
}
