import type { Metadata } from "next";
import { HistoryClient } from "./history-client";

export const metadata: Metadata = {
  title: "Daily history · BodyCast",
  description: "View and manually manage daily BodyCast health metrics.",
};

export default function HistoryPage() {
  return <HistoryClient />;
}
