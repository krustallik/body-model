import { notFound } from "next/navigation";
import BodyMapExperience from "@/components/body-map/body-map-experience";

export const dynamic = "force-dynamic";

export default function BodyMapPrototypePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BodyMapExperience delivery="development" />;
}
