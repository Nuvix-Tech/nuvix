import { describe, expect, test } from 'bun:test'

import { createMigrationCatalog, MigrationCatalogError, migrations } from '../src/migrations'

describe('migration catalog', () => {
  test('publishes forward-only migrations with stable identities and ordering', () => {
    expect(migrations.map((migration) => migration.id)).toEqual([
      '0001_platform_projects',
      '0002_project_credential_bindings',
    ])
    expect(Object.isFrozen(migrations)).toBe(true)
    expect(Object.isFrozen(migrations[0])).toBe(true)
  })

  test('sorts valid definitions by stable migration identity', () => {
    const catalog = createMigrationCatalog([
      { id: '0010_later_change', sql: 'SELECT 10;' },
      { id: '0002_earlier_change', sql: 'SELECT 2;' },
    ])

    expect(catalog.map((migration) => migration.id)).toEqual([
      '0002_earlier_change',
      '0010_later_change',
    ])
  })

  test('rejects duplicate migration identities', () => {
    const definitions = [
      { id: '0001_repeated', sql: 'SELECT 1;' },
      { id: '0001_repeated', sql: 'SELECT 2;' },
    ]

    expect(() => createMigrationCatalog(definitions)).toThrow(MigrationCatalogError)
  })

  test.each([
    null,
    {},
    { id: '', sql: 'SELECT 1;' },
    { id: '1_invalid', sql: 'SELECT 1;' },
    { id: '0001_INVALID', sql: 'SELECT 1;' },
    { id: '0001_valid', sql: '' },
    { id: '0001_valid', sql: '   ' },
  ])('rejects malformed migration definition %#', (definition) => {
    expect(() => createMigrationCatalog([definition])).toThrow(MigrationCatalogError)
  })

  test('rejects a malformed catalog container', () => {
    expect(() => createMigrationCatalog({})).toThrow(MigrationCatalogError)
  })
})

describe('initial platform schema', () => {
  const sql = migrations[0]?.sql ?? ''

  test('defines safe projects and one connection row per project', () => {
    expect(sql).toContain('CREATE TABLE projects')
    expect(sql).toContain('public_id text NOT NULL UNIQUE')
    expect(sql).toContain('enabled boolean NOT NULL DEFAULT true')
    expect(sql).toContain('CREATE TABLE project_connections')
    expect(sql).toContain('project_id uuid PRIMARY KEY')
    expect(sql).toContain('FOREIGN KEY (project_id)')
    expect(sql).toContain('REFERENCES projects (id)')
    expect(sql).toContain('ON DELETE RESTRICT')
  })

  test('stores only versioned encrypted connection metadata', () => {
    expect(sql).toContain('encryption_version smallint NOT NULL')
    expect(sql).toContain('key_version text NOT NULL')
    expect(sql).toContain('nonce bytea NOT NULL')
    expect(sql).toContain('octet_length(nonce) = 12')
    expect(sql).toContain('ciphertext bytea NOT NULL')
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE project_connections FROM PUBLIC')
  })

  test('contains no plaintext connection, provisioning, rollback, or tenant creation schema', () => {
    expect(sql).not.toMatch(/\b(uri|url|dsn|connection_string)\b/i)
    expect(sql).not.toMatch(/\b(provision|tenant|rollback)\w*\b/i)
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i)
  })
})

describe('project credential binding schema', () => {
  const sql =
    migrations.find((migration) => migration.id === '0002_project_credential_bindings')?.sql ?? ''
  const normalizedSql = sql.replaceAll(/\s+/g, ' ').trim()

  test('defines one constrained credential-binding relation', () => {
    expect(sql).toContain('CREATE TABLE project_credential_bindings')
    expect(sql).toContain('project_id uuid NOT NULL')
    expect(sql).toContain('credential_type text NOT NULL')
    expect(sql).toContain("credential_type IN ('session', 'user', 'api_key')")
    expect(sql).toContain('credential_id text NOT NULL')
    expect(sql).toContain('subject_id text')
    expect(sql).toContain('api_key_mode text')
    expect(sql).toContain("api_key_mode IS NULL OR api_key_mode IN ('admin', 'console')")
    expect(sql).toContain('PRIMARY KEY (project_id, credential_type, credential_id)')
  })

  test('enforces normalized bounded identifiers and credential-specific field shapes', () => {
    expect(sql).toContain('credential_id = btrim(credential_id)')
    expect(sql).toContain("credential_id !~ '^[[:space:]]|[[:space:]]$'")
    expect(sql).toContain('char_length(credential_id) BETWEEN 1 AND 256')
    expect(sql).toContain('subject_id = btrim(subject_id)')
    expect(sql).toContain("subject_id !~ '^[[:space:]]|[[:space:]]$'")
    expect(sql).toContain('char_length(subject_id) BETWEEN 1 AND 256')
    expect(normalizedSql).toContain(
      "credential_type = 'session' AND subject_id IS NOT NULL AND api_key_mode IS NULL",
    )
    expect(normalizedSql).toContain(
      "credential_type = 'user' AND subject_id IS NULL AND api_key_mode IS NULL",
    )
    expect(normalizedSql).toContain(
      "credential_type = 'api_key' AND subject_id IS NULL AND api_key_mode IS NOT NULL",
    )
  })

  test('defines lifecycle fields, restrictive ownership, lookup indexes, and public revocation', () => {
    expect(sql).toContain('enabled boolean NOT NULL DEFAULT true')
    expect(sql).toContain('expires_at timestamptz')
    expect(sql).toContain('revoked_at timestamptz')
    expect(sql).toContain('expires_at IS NULL OR expires_at > created_at')
    expect(sql).toContain('revoked_at IS NULL OR revoked_at >= created_at')
    expect(sql).toContain('FOREIGN KEY (project_id)')
    expect(sql).toContain('REFERENCES projects (id)')
    expect(sql).toContain('ON UPDATE RESTRICT')
    expect(sql).toContain('ON DELETE RESTRICT')
    expect(normalizedSql).toContain(
      'CREATE INDEX project_credential_bindings_active_project_lookup_idx ON project_credential_bindings (project_id, credential_type, credential_id) WHERE enabled = true AND revoked_at IS NULL',
    )
    expect(normalizedSql).toContain(
      'CREATE INDEX project_credential_bindings_credential_lookup_idx ON project_credential_bindings (credential_type, credential_id, project_id)',
    )
    expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE project_credential_bindings FROM PUBLIC')
  })

  test('contains no provisioning operations or credential secrets', () => {
    expect(sql).not.toMatch(/\b(?:DROP\s+TABLE|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i)
    expect(sql).not.toMatch(/\b(password|token|secret|hash|plaintext)\b/i)
  })
})
