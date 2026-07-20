"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, FileText, LockKeyhole } from "lucide-react";
import { m } from "motion/react";
import {
  listLocalDocuments,
  saveLocalDocument,
  type LocalDocumentSummary,
} from "../local-document-store";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dropzone,
  DropZoneArea,
  DropzoneDescription,
  DropzoneMessage,
  DropzoneTrigger,
  useDropzone,
} from "@/components/ui/dropzone";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { motionTransition } from "@/lib/motion";
import { ModeToggle } from "@/components/mode-toggle";
import { Brand } from "./Brand";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function UploadLanding() {
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Recent workspaces are device-local, so they can only be read after mount.
  // Until then the shelf renders nothing rather than a placeholder, because a
  // first-time visitor has none and should not be shown an empty frame.
  const [recent, setRecent] = useState<LocalDocumentSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    listLocalDocuments().then((documents) => {
      if (!cancelled) setRecent(documents);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dropzone = useDropzone<{ documentId: string }, string>({
    validation: {
      accept: { "application/pdf": [".pdf"] },
      minSize: 1,
      maxSize: MAX_FILE_SIZE,
      maxFiles: 1,
    },
    onRootError: (message) => setError(message ?? null),
    onDropFile: async (file) => {
      setError(null);
      setPreparing(true);
      try {
        const document = await saveLocalDocument(file);
        window.location.assign(`/documents/${document.id}`);
        return { status: "success", result: { documentId: document.id } };
      } catch {
        const message =
          "This browser could not save the local PDF. Check available storage and try again.";
        setError(message);
        setPreparing(false);
        return { status: "error", error: message };
      }
    },
  });

  return (
    <m.main
      className="landing-shell landing-shell-v2"
      initial={false}
      animate={{ opacity: 1 }}
      transition={motionTransition.enter}
    >
      <header className="landing-header">
        <Brand />
        {/* Arena and standings used to be reachable only from inside a
            document workspace, so a first visit gave no sign that blind
            comparison exists at all. They are navigation, not a decision the
            upload flow asks the visitor to make, so the page can name them
            without taking on the parser choice this page still keeps out. */}
        <nav className="landing-nav landing-nav-v2" aria-label="Product surfaces">
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            href="/arena"
          >
            Arena
          </Link>
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            href="/leaderboard"
          >
            Leaderboard
          </Link>
          <ModeToggle />
        </nav>
      </header>

      <section className="landing-main" aria-labelledby="landing-title">
        <m.div
          className="landing-copy"
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={motionTransition.enter}
        >
          <Badge variant="outline" className="landing-kicker">
            Evidence-first document review
          </Badge>
          <h1 id="landing-title">Parse first. Compare with evidence.</h1>
          <p className="landing-lede">
            Open a PDF, run the recommended parser, and inspect every block
            beside the page it came from.
          </p>
        </m.div>

        <m.div
          className="upload-card-wrap"
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...motionTransition.enter, delay: 0.06 }}
        >
          <Dropzone {...dropzone}>
            <DropZoneArea className="upload-card" aria-busy={preparing}>
              <div className="upload-icon" aria-hidden="true">
                <FileText />
              </div>
              <div className="upload-copy">
                <h2>{preparing ? "Preparing your workspace" : "Bring your PDF into focus"}</h2>
                <DropzoneDescription>
                  One document, up to 50 MB. Nothing is uploaded yet.
                </DropzoneDescription>
              </div>
              <DropzoneTrigger
                aria-label="Choose a PDF document"
                className={cn(buttonVariants({ size: "lg" }), "upload-trigger")}
              >
                {preparing ? "Preparing…" : "Choose PDF"}
                {!preparing && <ArrowRight data-icon="inline-end" />}
              </DropzoneTrigger>
              <DropzoneMessage className="upload-error">
                {error ?? ""}
              </DropzoneMessage>
            </DropZoneArea>
          </Dropzone>
        </m.div>

        <div className="privacy-note">
          <LockKeyhole aria-hidden="true" />
          <span>Your document stays in this browser until you choose a runner.</span>
        </div>

        {/* docs/PAGES.md asks for a sample document and a device-local recent
            list on this page; neither had been built, so a visitor with no PDF
            to hand had nothing to try and a returning one had no way back. */}
        <div className="landing-shelves">
          <section aria-labelledby="sample-heading">
            <h2 id="sample-heading" className="landing-shelf-heading">
              No PDF handy?
            </h2>
            <ItemGroup>
              <Item size="sm" variant="outline" render={<Link href="/documents/demo" />}>
                <ItemMedia variant="icon">
                  <FileText />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>Sample document</ItemTitle>
                  <ItemDescription>12 pages · digital text</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ArrowRight />
                </ItemActions>
              </Item>
            </ItemGroup>
          </section>

          {recent.length > 0 && (
            <section aria-labelledby="recent-heading">
              <h2 id="recent-heading" className="landing-shelf-heading">
                Recent workspaces
              </h2>
              <ItemGroup>
                {recent.map((document) => (
                  <Item
                    key={document.id}
                    size="sm"
                    render={<Link href={`/documents/${document.id}`} />}
                  >
                    <ItemMedia variant="icon">
                      <Clock />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{document.name}</ItemTitle>
                      <ItemDescription>{formatSize(document.size)}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <ArrowRight />
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </section>
          )}
        </div>
      </section>

      <section className="landing-proof landing-proof-v2" aria-label="Review workflow">
        <article>
          <span className="proof-index">01</span>
          <div>
            <h2>Upload once</h2>
            <p>Create the document workspace before choosing a parser.</p>
          </div>
        </article>
        <article>
          <span className="proof-index">02</span>
          <div>
            <h2>Inspect evidence</h2>
            <p>Native regions link the original page to parsed blocks.</p>
          </div>
        </article>
        <article>
          <span className="proof-index">03</span>
          <div>
            <h2>Add one comparison</h2>
            <p>Keep the same source visible when another result is useful.</p>
          </div>
        </article>
      </section>
    </m.main>
  );
}
