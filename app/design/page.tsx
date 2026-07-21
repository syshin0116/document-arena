import type { Metadata } from "next";
import { DesignReference } from "./DesignReference";

export const metadata: Metadata = {
  title: "Design tokens · Document Arena",
  description: "A living reference for the project's colour, type, radius, motion, and spacing tokens.",
};

export default function DesignPage() {
  return <DesignReference />;
}
