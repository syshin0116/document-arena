import type { Metadata } from "next";
import { Workspace } from "../../ui/Workspace";
import { sampleDocumentFor } from "../../lib/sample-document";
import { DEFAULT_SAMPLE_DOCUMENT } from "../../lib/sample-documents-meta";

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
  /* `demo` drives a fork that renders page-1 blocks written into the component.
     Those blocks are real OpenDataLoader output for the default sample, so that
     sample may claim the fork under either of its ids — /documents/demo is the
     older URL and /documents/llama is what the shelf links to. Any OTHER sample
     under the same flag would show the default sample's parsed text beside its
     own pages, which is why this is an equality check and not `Boolean(sample)`. */
  const demo =
    documentId === "demo" || sample?.id === DEFAULT_SAMPLE_DOCUMENT.id;
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
