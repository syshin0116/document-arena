import type { Metadata } from "next";
import { UploadLanding } from "./ui/UploadLanding";

export const metadata: Metadata = {
  title: "Document Arena · Compare document pipelines",
  description:
    "Upload a document, inspect source-linked evidence, and compare pipeline results side by side.",
};

export default function Home() {
  return <UploadLanding />;
}
