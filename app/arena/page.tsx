import type { Metadata } from "next";
import { ArenaBattle } from "../ui/ArenaBattle";

export const metadata: Metadata = {
  title: "Arena · Parser Arena",
  description:
    "Blind parser battle: judge two anonymous results on the same document, then reveal who parsed it.",
};

export default function ArenaPage() {
  return <ArenaBattle />;
}
