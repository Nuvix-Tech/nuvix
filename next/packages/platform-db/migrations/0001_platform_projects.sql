CREATE TABLE projects (
  id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT projects_public_id_valid CHECK (
    public_id = btrim(public_id)
    AND char_length(public_id) BETWEEN 1 AND 128
  )
);

CREATE TABLE project_connections (
  project_id uuid PRIMARY KEY,
  encryption_version smallint NOT NULL,
  key_version text NOT NULL,
  nonce bytea NOT NULL,
  ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT project_connections_project_fk
    FOREIGN KEY (project_id)
    REFERENCES projects (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT project_connections_encryption_version_valid CHECK (encryption_version > 0),
  CONSTRAINT project_connections_key_version_valid CHECK (
    key_version = btrim(key_version)
    AND char_length(key_version) BETWEEN 1 AND 128
  ),
  CONSTRAINT project_connections_nonce_size CHECK (octet_length(nonce) = 12),
  CONSTRAINT project_connections_ciphertext_size CHECK (octet_length(ciphertext) > 16)
);

REVOKE ALL PRIVILEGES ON TABLE project_connections FROM PUBLIC;
