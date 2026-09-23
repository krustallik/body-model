import type { Metadata } from "next";
import { StepperDiagnosticClient } from "./stepper-diagnostic-client";

export const metadata: Metadata = {
  title: "Stepper diagnostics · BodyCast",
  description: "Observed workout, steps, device energy, and heart-rate diagnostics.",
};

export default async function StepperDiagnosticPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StepperDiagnosticClient workoutId={id} />;
}
