import type { Metadata } from "next";
import { Workspace } from "../../ui/Workspace";
import { SAMPLE_PDF_FILE_NAME } from "../../lib/sample-document";

export const metadata: Metadata = {
  title: "Document workspace · Document Arena",
  description: "Inspect and compare parser results against the source PDF.",
};

export default async function DocumentWorkspace({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const demo = documentId === "demo";
  const fileName = demo ? SAMPLE_PDF_FILE_NAME : "Local PDF";
  return (
    <Workspace documentId={documentId} demo={demo} fileName={fileName} />
  );
}
