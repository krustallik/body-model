import { notFound } from "next/navigation";
import BodyMapPrototype from "./BodyMapPrototype";

export const dynamic = "force-dynamic";

export default function BodyMapPrototypePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BodyMapPrototype />;
}
