import type { Metadata } from "next";
import { Workspace } from "../../ui/Workspace";
import { sampleDocumentFor } from "../../lib/sample-document";

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
  const sample = sampleDocumentFor(documentId);
  /* `demo` drives a fork that renders page-1 blocks written into the component
     for one specific document. Only that document may claim it; another sample
     under the same flag would show LLaMA's parsed text beside its own pages.
     The rest open the ordinary workspace over their real PDF. */
  const demo = documentId === "demo";
  const fileName = sample ? sample.pdfFileName : "Local PDF";
  return (
    <Workspace
      documentId={documentId}
      demo={demo}
      sample={Boolean(sample)}
      fileName={fileName}
    />
  );
}
