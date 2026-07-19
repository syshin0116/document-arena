import type { Metadata } from "next";
import { LeaderboardView } from "../ui/LeaderboardView";

export const metadata: Metadata = {
  title: "Leaderboard · Parser Arena",
  description:
    "Per-document-type parser rankings aggregated from blind votes only.",
};

export default function LeaderboardPage() {
  return <LeaderboardView />;
}
