import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const migration = await readFile(
  path.join(
    process.cwd(),
    "services/orchestrator/db/migrations/0001_domain_documents.sql",
  ),
  "utf8",
);

describe("domain document migration", () => {
  test("separates document metadata, immutable artifacts, and temporary storage", () => {
    expect(migration).toContain("CREATE TABLE domain.documents");
    expect(migration).toContain("CREATE TABLE domain.artifacts");
    expect(migration).toContain("CREATE TABLE domain.remote_artifact_ledger");
    expect(migration).toContain(
      "REFERENCES domain.documents (id) ON DELETE RESTRICT",
    );
    expect(migration).toContain(
      "REFERENCES domain.artifacts (id) ON DELETE RESTRICT",
    );
  });

  test("does not define columns for bytes, providers, or signed capabilities", () => {
    const sqlStructure = migration
      .replace(/--.*$/gm, "")
      .replace(/'(?:''|[^'])*'/g, "''");

    expect(sqlStructure).not.toMatch(
      /\b(pdf_bytes|document_bytes|body|content)\b/i,
    );
    expect(sqlStructure).not.toMatch(
      /\b(gcs|r2|s3|provider|signed_url|url)\b/i,
    );
    expect(migration).toContain("blob_bucket text NOT NULL");
    expect(migration).toContain("blob_key text NOT NULL");
  });

  test("allows identical bytes in distinct browser workspaces", () => {
    expect(migration).toContain(
      "UNIQUE (owner_subject, client_workspace_id)",
    );
    expect(migration).toContain(
      "ON domain.documents (owner_subject, sha256)",
    );
    expect(migration).not.toContain("UNIQUE (owner_subject, sha256)");
  });
});
