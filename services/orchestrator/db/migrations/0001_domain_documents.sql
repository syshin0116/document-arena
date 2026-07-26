BEGIN;

CREATE SCHEMA IF NOT EXISTS domain;

CREATE TABLE domain.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject text NOT NULL,
  client_workspace_id text NOT NULL,
  filename text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL,
  sha256 text NOT NULL,
  page_count integer,
  source_kind text NOT NULL DEFAULT 'remote_execution',
  retention_mode text NOT NULL DEFAULT 'temporary_execution',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT documents_owner_subject_not_blank
    CHECK (owner_subject = btrim(owner_subject) AND owner_subject <> ''),
  CONSTRAINT documents_client_workspace_id_not_blank
    CHECK (client_workspace_id = btrim(client_workspace_id) AND client_workspace_id <> ''),
  CONSTRAINT documents_filename_is_label
    CHECK (
      filename = btrim(filename)
      AND filename <> ''
      AND filename !~ '[\x00-\x1f\x7f]'
      AND filename !~ '[/\\]'
    ),
  CONSTRAINT documents_media_type_is_pdf CHECK (media_type = 'application/pdf'),
  CONSTRAINT documents_byte_size_positive CHECK (byte_size > 0),
  CONSTRAINT documents_sha256_lower_hex CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT documents_page_count_positive CHECK (page_count IS NULL OR page_count > 0),
  CONSTRAINT documents_source_kind_remote_only CHECK (source_kind = 'remote_execution'),
  CONSTRAINT documents_retention_mode_temporary_only CHECK (retention_mode = 'temporary_execution'),
  CONSTRAINT documents_updated_after_created CHECK (updated_at >= created_at),
  CONSTRAINT documents_deleted_after_created CHECK (deleted_at IS NULL OR deleted_at >= created_at),
  CONSTRAINT documents_owner_workspace_unique UNIQUE (owner_subject, client_workspace_id)
);

CREATE INDEX documents_owner_created_idx
  ON domain.documents (owner_subject, created_at DESC);

-- Intentionally non-unique: identical bytes may be registered in multiple
-- browser workspaces or submitted again as a distinct run.
CREATE INDEX documents_owner_sha256_idx
  ON domain.documents (owner_subject, sha256);

CREATE TABLE domain.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES domain.documents (id) ON DELETE RESTRICT,
  artifact_type text NOT NULL,
  media_type text NOT NULL,
  schema_version text,
  sha256 text NOT NULL,
  byte_size bigint NOT NULL,
  created_by_stage_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_type_not_blank
    CHECK (artifact_type = btrim(artifact_type) AND artifact_type <> ''),
  CONSTRAINT artifacts_media_type_not_blank
    CHECK (media_type = btrim(media_type) AND media_type <> ''),
  CONSTRAINT artifacts_schema_version_not_blank
    CHECK (schema_version IS NULL OR (schema_version = btrim(schema_version) AND schema_version <> '')),
  CONSTRAINT artifacts_sha256_lower_hex CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT artifacts_byte_size_nonnegative CHECK (byte_size >= 0)
);

CREATE INDEX artifacts_document_created_idx
  ON domain.artifacts (document_id, created_at);
CREATE INDEX artifacts_sha256_idx ON domain.artifacts (sha256);

CREATE TYPE domain.remote_artifact_state AS ENUM (
  'pending_upload',
  'available',
  'imported',
  'delete_pending',
  'deleted',
  'expired'
);

CREATE TABLE domain.remote_artifact_ledger (
  artifact_id uuid PRIMARY KEY REFERENCES domain.artifacts (id) ON DELETE RESTRICT,
  blob_bucket text NOT NULL,
  blob_key text NOT NULL,
  state domain.remote_artifact_state NOT NULL DEFAULT 'pending_upload',
  expires_at timestamptz NOT NULL,
  imported_at timestamptz,
  delete_requested_at timestamptz,
  deleted_at timestamptz,
  cleanup_attempts integer NOT NULL DEFAULT 0,
  last_cleanup_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remote_artifact_bucket_valid CHECK (
    blob_bucket = btrim(blob_bucket)
    AND blob_bucket <> ''
    AND blob_bucket !~ '[/\\\x00-\x1f\x7f]'
  ),
  CONSTRAINT remote_artifact_key_valid CHECK (
    blob_key <> ''
    AND blob_key !~ '^/'
    AND blob_key !~ '/$'
    AND blob_key !~ '(^|/)\.\.?(/|$)'
    AND blob_key !~ '[\x00-\x1f\x7f]'
  ),
  CONSTRAINT remote_artifact_ref_unique UNIQUE (blob_bucket, blob_key),
  CONSTRAINT remote_artifact_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT remote_artifact_imported_after_creation CHECK (imported_at IS NULL OR imported_at >= created_at),
  CONSTRAINT remote_artifact_delete_requested_after_creation CHECK (delete_requested_at IS NULL OR delete_requested_at >= created_at),
  CONSTRAINT remote_artifact_deleted_after_creation CHECK (deleted_at IS NULL OR deleted_at >= created_at),
  CONSTRAINT remote_artifact_cleanup_attempts_nonnegative CHECK (cleanup_attempts >= 0),
  CONSTRAINT remote_artifact_deleted_state_consistent CHECK ((state = 'deleted') = (deleted_at IS NOT NULL)),
  CONSTRAINT remote_artifact_imported_state_consistent CHECK (state <> 'imported' OR imported_at IS NOT NULL),
  CONSTRAINT remote_artifact_delete_pending_state_consistent CHECK (state <> 'delete_pending' OR delete_requested_at IS NOT NULL),
  CONSTRAINT remote_artifact_updated_after_created CHECK (updated_at >= created_at)
);

CREATE INDEX remote_artifact_cleanup_idx
  ON domain.remote_artifact_ledger (state, expires_at)
  WHERE state <> 'deleted';

COMMENT ON TABLE domain.documents IS
  'Metadata for authenticated remote-execution submissions. Browser-only documents do not create rows here.';
COMMENT ON COLUMN domain.documents.owner_subject IS
  'Stable authenticated subject identifier; deliberately not coupled to the auth schema.';
COMMENT ON COLUMN domain.documents.client_workspace_id IS
  'Opaque browser workspace identifier. It is not a local OPFS path or document content.';
COMMENT ON TABLE domain.artifacts IS
  'Immutable artifact descriptors. Artifact bytes are not stored in PostgreSQL.';
COMMENT ON TABLE domain.remote_artifact_ledger IS
  'Temporary provider-neutral BlobRef ledger used for transfer cleanup; signed URLs are never persisted.';
COMMENT ON COLUMN domain.remote_artifact_ledger.blob_bucket IS
  'BlobStore bucket identifier, not a provider name or URL.';
COMMENT ON COLUMN domain.remote_artifact_ledger.blob_key IS
  'BlobStore object key, never a signed URL.';

COMMIT;
