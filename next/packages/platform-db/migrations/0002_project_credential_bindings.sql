CREATE TABLE project_credential_bindings (
  project_id uuid NOT NULL,
  credential_type text NOT NULL,
  credential_id text NOT NULL,
  subject_id text,
  api_key_mode text,
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT project_credential_bindings_pk
    PRIMARY KEY (project_id, credential_type, credential_id),
  CONSTRAINT project_credential_bindings_project_fk
    FOREIGN KEY (project_id)
    REFERENCES projects (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT project_credential_bindings_type_valid CHECK (
    credential_type IN ('session', 'user', 'api_key')
  ),
  CONSTRAINT project_credential_bindings_credential_id_valid CHECK (
    credential_id = btrim(credential_id)
    AND credential_id !~ '^[[:space:]]|[[:space:]]$'
    AND char_length(credential_id) BETWEEN 1 AND 256
  ),
  CONSTRAINT project_credential_bindings_subject_id_valid CHECK (
    subject_id IS NULL
    OR (
      subject_id = btrim(subject_id)
      AND subject_id !~ '^[[:space:]]|[[:space:]]$'
      AND char_length(subject_id) BETWEEN 1 AND 256
    )
  ),
  CONSTRAINT project_credential_bindings_api_key_mode_valid CHECK (
    api_key_mode IS NULL OR api_key_mode IN ('admin', 'console')
  ),
  CONSTRAINT project_credential_bindings_identity_shape_valid CHECK (
    (
      credential_type = 'session'
      AND subject_id IS NOT NULL
      AND api_key_mode IS NULL
    )
    OR (
      credential_type = 'user'
      AND subject_id IS NULL
      AND api_key_mode IS NULL
    )
    OR (
      credential_type = 'api_key'
      AND subject_id IS NULL
      AND api_key_mode IS NOT NULL
    )
  ),
  CONSTRAINT project_credential_bindings_expiry_valid CHECK (
    expires_at IS NULL OR expires_at > created_at
  ),
  CONSTRAINT project_credential_bindings_revocation_valid CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX project_credential_bindings_active_project_lookup_idx
  ON project_credential_bindings (project_id, credential_type, credential_id)
  WHERE enabled = true AND revoked_at IS NULL;

CREATE INDEX project_credential_bindings_credential_lookup_idx
  ON project_credential_bindings (credential_type, credential_id, project_id);

REVOKE ALL PRIVILEGES ON TABLE project_credential_bindings FROM PUBLIC;
