import type { Metadata } from "next";
import { Suspense } from "react";
import { ProgramEditorClient } from "../../program-editor";

export const metadata: Metadata = {
  title: "Edit program · BodyCast",
  description: "Edit a strength training program.",
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditProgramPage({ params }: PageProps) {
  const { id } = await params;
  const programId = Number(id);
  if (!Number.isFinite(programId) || programId < 1) {
    return (
      <Suspense fallback={<p role="status">Loading program editor…</p>}>
        <ProgramEditorClient />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<p role="status">Loading program editor…</p>}>
      <ProgramEditorClient programId={programId} />
    </Suspense>
  );
}
