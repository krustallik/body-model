import type { Metadata } from "next";
import { ProgramEditorClient } from "../../program-editor";

export const metadata: Metadata = {
  title: "New program · BodyCast",
  description: "Create a strength training program.",
};

export default function NewProgramPage() {
  return <ProgramEditorClient />;
}
