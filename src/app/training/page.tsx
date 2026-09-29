import type { Metadata } from "next";
import { Suspense } from "react";
import { TrainingClient } from "./training-client";

export const metadata: Metadata = {
  title: "Training · BodyCast",
  description: "Strength training diary, programs, and Garmin matching.",
};

export default function TrainingPage() {
  return <Suspense fallback={<main aria-busy="true" />}><TrainingClient /></Suspense>;
}
