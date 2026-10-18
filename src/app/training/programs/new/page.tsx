import type { Metadata } from "next";
import { Suspense } from "react";
import { ProgramEditorClient } from "../../program-editor";

export const metadata: Metadata = {
  title: "New program · BodyCast",
  description: "Create a strength training program.",
};

export default function NewProgramPage() {
  return (
    <Suspense fallback={<p role="status">Loading program editor…</p>}>
      <ProgramEditorClient />
    </Suspense>
  );
}
