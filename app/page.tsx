import type { Metadata } from "next";
import { UploadLanding } from "./ui/UploadLanding";

export const metadata: Metadata = {
  title: "Parser Arena · Compare document parsers",
  description:
    "Upload a PDF, inspect source-linked parser evidence, and compare results side by side.",
};

export default function Home() {
  return <UploadLanding />;
}
