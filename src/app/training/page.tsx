import type { Metadata } from "next";
import { TrainingClient } from "./training-client";

export const metadata: Metadata = {
  title: "Training · BodyCast",
  description: "Strength training diary, programs, and Garmin matching.",
};

export default function TrainingPage() {
  return <TrainingClient />;
}
