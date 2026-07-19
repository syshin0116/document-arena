import type { Metadata } from "next";
import { Workspace } from "../../ui/Workspace";

export const metadata: Metadata = {
  title: "Document workspace · Parser Arena",
  description: "Inspect and compare parser results against the source PDF.",
};

export default async function DocumentWorkspace({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const demo = documentId === "demo";
  const fileName = demo ? "attention-is-all-you-need.pdf" : "Local PDF";
  return (
    <Workspace documentId={documentId} demo={demo} fileName={fileName} />
  );
}
