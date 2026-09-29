import type { Metadata } from "next";
import { DashboardClient } from "./dashboard-client";
import { isLocalDemoMode } from "@/modules/demo/local-demo-mode";

export const metadata: Metadata = {
  title: "Dashboard · BodyCast",
  description: "Today's health metrics, sync status, and recent BodyCast history.",
};

export default function DashboardPage() {
  return <DashboardClient demoMode={isLocalDemoMode()} />;
}
