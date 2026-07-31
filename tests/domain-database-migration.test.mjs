import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "bun:test";

const migrationPath = path.join(
  process.cwd(),
  "services/orchestrator/db/migrations/0001_domain_documents.sql",
);
const migration = await readFile(migrationPath, "utf8");

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

  test("does not persist document bytes, provider URLs, or signed capabilities", () => {
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

  test("enforces hashes, sizes, remote-only scope, and retryable cleanup", () => {
    expect(migration).toContain("sha256 ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("CHECK (byte_size > 0)");
    expect(migration).toContain("CHECK (source_kind = 'remote_execution')");
    expect(migration).toContain(
      "CHECK (retention_mode = 'temporary_execution')",
    );
    expect(migration).toContain("cleanup_attempts integer NOT NULL DEFAULT 0");
    expect(migration).toContain("remote_artifact_cleanup_idx");
  });

  test("allows identical bytes in distinct workspaces", () => {
    expect(migration).toContain(
      "UNIQUE (owner_subject, client_workspace_id)",
    );
    expect(migration).toContain(
      "ON domain.documents (owner_subject, sha256)",
    );
    expect(migration).not.toContain("UNIQUE (owner_subject, sha256)");
  });
});
