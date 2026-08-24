import type { Metadata } from "next";
import { GoalClient } from "./goal-client";

export const metadata: Metadata = {
  title: "Goal planner · BodyCast",
  description: "Explore a modeled weight goal under explicit nutrition and activity assumptions.",
};

export default function GoalPage() {
  return <GoalClient />;
}
