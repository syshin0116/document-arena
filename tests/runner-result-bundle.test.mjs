import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  sha256File,
  validateResultBundle,
} from "../services/runner/run-local.mjs";

const componentId = "opendataloader-pdf";
const sourceArtifactId = "sha256:source-document";
const sourceSha256 = createHash("sha256")
  .update("source document")
  .digest("hex");
const manifest = {
  metadata: {
    id: componentId,
  },
};

async function descriptor(outputRoot, path, mediaType) {
  const absolutePath = resolve(outputRoot, path);
  const contents = await readFile(absolutePath);
  return {
    path,
    mediaType,
    sizeBytes: contents.length,
    sha256: await sha256File(absolutePath),
  };
}

test("validateResultBundle accepts intact artifacts and rejects descriptor tampering", async (t) => {
  const outputRoot = await mkdtemp(resolve(tmpdir(), "parser-arena-bundle-"));
  t.after(async () => {
    await rm(outputRoot, { recursive: true, force: true });
  });

  await mkdir(resolve(outputRoot, "primary"));
  await mkdir(resolve(outputRoot, "raw"));

  const canonicalDocument = {
    apiVersion: "parser-arena.dev/parsed-document/v1alpha1",
    sourceArtifactRef: sourceArtifactId,
    pages: [
      {
        pageNumber: 1,
        width: 612,
        height: 792,
        blocks: [
          {
            id: "block-1",
            kind: "paragraph",
            sourceRegions: [
              {
                pageNumber: 1,
                bbox: [0.1, 0.2, 0.8, 0.3],
                provenance: "native",
                native: {
                  bbox: [61.2, 554.4, 489.6, 633.6],
                  coordinateSystem: "pdf-bottom-left-points",
                  artifactId: "artifact:raw-opendataloader-json",
                  jsonPointer: "/kids/0",
                },
              },
            ],
          },
        ],
      },
    ],
  };

  await writeFile(
    resolve(outputRoot, "primary/parsed-document.json"),
    `${JSON.stringify(canonicalDocument)}\n`,
  );
  await writeFile(
    resolve(outputRoot, "raw/opendataloader.json"),
    '{"kids":[]}\n',
  );
  await writeFile(
    resolve(outputRoot, "raw/opendataloader.md"),
    "Parsed markdown\n",
  );

  const bundle = {
    apiVersion: "parser-arena.dev/result-bundle/v1alpha1",
    status: "completed",
    component: {
      id: componentId,
    },
    source: {
      artifactId: sourceArtifactId,
      sha256: sourceSha256,
    },
    progress: {
      mode: "phase",
      partialResults: "none",
    },
    primary: await descriptor(
      outputRoot,
      "primary/parsed-document.json",
      "application/vnd.parser-arena.parsed-document+json",
    ),
    rawArtifacts: [
      await descriptor(
        outputRoot,
        "raw/opendataloader.json",
        "application/json",
      ),
      await descriptor(
        outputRoot,
        "raw/opendataloader.md",
        "text/markdown",
      ),
    ],
  };

  async function writeBundle(value) {
    await writeFile(
      resolve(outputRoot, "bundle.json"),
      `${JSON.stringify(value)}\n`,
    );
  }

  await writeBundle(bundle);
  const result = await validateResultBundle({
    outputRoot,
    manifest,
    sourceArtifactId,
    sourceSha256,
  });

  assert.equal(result.blockCount, 1);
  assert.equal(result.nativeRegionCount, 1);
  assert.equal(result.rawArtifacts.length, 2);

  const badHashBundle = structuredClone(bundle);
  badHashBundle.primary.sha256 = "0".repeat(64);
  await writeBundle(badHashBundle);
  await assert.rejects(
    validateResultBundle({
      outputRoot,
      manifest,
      sourceArtifactId,
      sourceSha256,
    }),
    /primary SHA-256 does not match its descriptor/,
  );

  const traversalBundle = structuredClone(bundle);
  traversalBundle.rawArtifacts[0].path = "../outside.json";
  await writeBundle(traversalBundle);
  await assert.rejects(
    validateResultBundle({
      outputRoot,
      manifest,
      sourceArtifactId,
      sourceSha256,
    }),
    /Artifact path escapes the output directory/,
  );
});
