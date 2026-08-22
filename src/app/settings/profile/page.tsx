import type { Metadata } from "next";
import { ProfileClient } from "./profile-client";

export const metadata: Metadata = {
  title: "Profile settings · BodyCast",
  description: "Manage the personal inputs and weight goal used by BodyCast.",
};

export default function ProfilePage() {
  return <ProfileClient />;
}
