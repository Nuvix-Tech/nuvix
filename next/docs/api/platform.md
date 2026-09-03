# Platform API Contract

The Platform API provides control-plane management for projects, platform API keys,
authentication settings, and database metadata introspection.

## Authentication & Authorization

- Platform endpoints require root/admin authorization.
- Headers: `Authorization: Bearer <token>` or `x-nuvix-platform-key: <key>`.

## Endpoints

### 1. Projects Management

#### Create Project
- `POST /v2/platform/projects`
- **Request Body**:
  ```json
  {
    "projectId": "string (optional, min: 1, max: 64)",
    "name": "string (min: 1, max: 128)",
    "description": "string (optional, max: 512)",
    "enabled": "boolean (default: true)"
  }
  ```
- **Response 201**:
  ```json
  {
    "$id": "string",
    "name": "string",
    "description": "string",
    "publicId": "string",
    "enabled": true,
    "$createdAt": "string (ISO 8601)",
    "$updatedAt": "string (ISO 8601)"
  }
  ```

#### List Projects
- `GET /v2/platform/projects`
- **Response 200**:
  ```json
  {
    "total": 1,
    "projects": [ ... ]
  }
  ```

#### Get Project
- `GET /v2/platform/projects/:projectId`
- **Response 200**: Project object
- **Response 404**: `project_not_found`

#### Update Project
- `PUT /v2/platform/projects/:projectId`
- **Request Body**:
  ```json
  {
    "name": "string (optional)",
    "description": "string (optional)",
    "enabled": "boolean (optional)"
  }
  ```
- **Response 200**: Project object

#### Delete Project
- `DELETE /v2/platform/projects/:projectId`
- **Response 204**: Empty

---

### 2. Project Auth Settings

#### Get Auth Settings
- `GET /v2/platform/projects/:projectId/auth`
- **Response 200**:
  ```json
  {
    "sessionDurationSeconds": 86400,
    "maxActiveSessions": 10,
    "passwordMinLength": 8,
    "passwordRequireSymbols": false,
    "oauth2Providers": {}
  }
  ```

#### Update Auth Settings
- `PUT /v2/platform/projects/:projectId/auth`
- **Request Body**:
  ```json
  {
    "sessionDurationSeconds": 604800,
    "maxActiveSessions": 5,
    "passwordMinLength": 10
  }
  ```
- **Response 200**: Updated auth settings object

---

### 3. Database Metadata Introspection (`pg-meta` over Bun.sql)

#### Introspect Schemas
- `GET /v2/platform/projects/:projectId/metadata/schemas`
- **Response 200**:
  ```json
  {
    "schemas": [
      {
        "schema_name": "public"
      }
    ]
  }
  ```

#### Introspect Tables
- `GET /v2/platform/projects/:projectId/metadata/tables`
- **Query Parameters**:
  - `schema`: string (default: `'public'`)
- **Response 200**:
  ```json
  {
    "tables": [
      {
        "table_schema": "public",
        "table_name": "users",
        "table_type": "BASE TABLE"
      }
    ]
  }
  ```

#### Introspect Columns
- `GET /v2/platform/projects/:projectId/metadata/columns`
- **Query Parameters**:
  - `schema`: string (default: `'public'`)
  - `table`: string
- **Response 200**:
  ```json
  {
    "columns": [
      {
        "table_name": "users",
        "column_name": "email",
        "data_type": "character varying",
        "is_nullable": "NO",
        "column_default": null
      }
    ]
  }
  ```
