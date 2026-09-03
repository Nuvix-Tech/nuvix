# Nuvix v2 — Storage API Contract

> Status: Contract drafted, ready for Phase 5 implementation  
> Single source of truth for the Storage module (`/v2/storage`).

---

## 1. Scope & Capabilities

The Storage module manages binary files and buckets. Storage files are stored on a
centrally configured storage device (Local filesystem, S3, Wasabi, or MinIO) via
`@nuvix/storage`. File and bucket metadata are persisted in the tenant PostgreSQL database.

Auth requirements:
- Buckets management: `buckets.read`, `buckets.write` (admin / API-key with scopes, or project owner)
- File operations: `files.read`, `files.write`, or granted by document-level permissions (e.g. `read("any")`, `read("users")`, `write("user:{userId}")`).

---

## 2. Types & Schema

### Bucket Response
```json
{
  "$id": "bucket_avatars",
  "$createdAt": "2026-09-03T12:00:00.000Z",
  "$updatedAt": "2026-09-03T12:00:00.000Z",
  "$permissions": ["read(\"any\")", "write(\"users\")"],
  "name": "User Avatars",
  "enabled": true,
  "maximumFileSize": 10485760,
  "allowedFileExtensions": ["jpg", "png", "webp"],
  "compression": "none",
  "encryption": true,
  "antivirus": false,
  "fileSecurity": true
}
```

### File Response
```json
{
  "$id": "file_profile_123",
  "$createdAt": "2026-09-03T12:00:00.000Z",
  "$updatedAt": "2026-09-03T12:00:00.000Z",
  "$permissions": ["read(\"any\")"],
  "bucketId": "bucket_avatars",
  "name": "avatar.png",
  "signature": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "mimeType": "image/png",
  "sizeOriginal": 102400,
  "chunksTotal": 1,
  "chunksUploaded": 1
}
```

---

## 3. Endpoints — Buckets (`/v2/storage/buckets`)

### `POST /v2/storage/buckets`

Create a new storage bucket.

- **Headers**: `x-nuvix-publishable-key`, plus auth (`x-nuvix-key` with `buckets.write` or session with owner role)
- **Request Body**:
  ```json
  {
    "bucketId": "avatars",
    "name": "User Avatars",
    "permissions": ["read(\"any\")"],
    "fileSecurity": true,
    "enabled": true,
    "maximumFileSize": 10485760,
    "allowedFileExtensions": ["jpg", "png", "webp"],
    "compression": "none",
    "encryption": true,
    "antivirus": false
  }
  ```
  *Note: `bucketId` may be omitted or `"unique()"` to generate an ID.*
- **Response** (`201 Created`): `BucketResponse`
- **Errors**:
  - `400 /errors/bad-request` (`validation_failed`): Invalid parameters.
  - `409 /errors/conflict` (`bucket_already_exists`): Bucket ID already exists.

### `GET /v2/storage/buckets`

List storage buckets.

- **Query Parameters**:
  - `queries`: optional JSON query filters
  - `search`: optional search term
  - `limit`: default 25, max 100
  - `offset`: default 0
- **Response** (`200 OK`):
  ```json
  {
    "data": [BucketResponse],
    "meta": { "total": 1, "limit": 25, "offset": 0 }
  }
  ```

### `GET /v2/storage/buckets/:bucketId`

Get a specific bucket by ID.

- **Response** (`200 OK`): `BucketResponse`
- **Errors**:
  - `404 /errors/not-found` (`bucket_not_found`): Bucket not found.

### `PUT /v2/storage/buckets/:bucketId`

Update bucket configuration.

- **Request Body**:
  ```json
  {
    "name": "Avatars Updated",
    "permissions": ["read(\"any\")"],
    "fileSecurity": true,
    "enabled": true,
    "maximumFileSize": 20971520,
    "allowedFileExtensions": ["jpg", "png", "webp", "gif"],
    "compression": "none",
    "encryption": true,
    "antivirus": false
  }
  ```
- **Response** (`200 OK`): `BucketResponse`
- **Errors**:
  - `404 /errors/not-found` (`bucket_not_found`): Bucket not found.

### `DELETE /v2/storage/buckets/:bucketId`

Delete a bucket and cascade-delete all files contained within it.

- **Response** (`204 No Content`): empty
- **Errors**:
  - `404 /errors/not-found` (`bucket_not_found`): Bucket not found.

---

## 4. Endpoints — Files (`/v2/storage/buckets/:bucketId/files`)

### `POST /v2/storage/buckets/:bucketId/files`

Upload a file into a bucket.

- **Headers**: `Content-Type: multipart/form-data`
- **Multipart Form Fields**:
  - `fileId`: string (`unique()` or custom ID)
  - `file`: binary file payload (Elysia `t.File()`)
  - `permissions`: optional JSON array or repeated strings, e.g. `["read(\"any\")"]`
- **Validation**:
  - Bucket must exist and `enabled === true`.
  - File size must be `<= maximumFileSize`.
  - File extension (if `allowedFileExtensions` is non-empty) must be included.
- **Response** (`201 Created`): `FileResponse`
- **Errors**:
  - `400 /errors/bad-request` (`file_size_exceeded`): Exceeds bucket size limit.
  - `400 /errors/bad-request` (`file_extension_not_allowed`): Extension not permitted.
  - `404 /errors/not-found` (`bucket_not_found`): Target bucket does not exist.
  - `409 /errors/conflict` (`file_already_exists`): File ID already exists.

### `GET /v2/storage/buckets/:bucketId/files`

List files in a bucket.

- **Query Parameters**:
  - `search`: optional search term
  - `limit`: default 25, max 100
  - `offset`: default 0
- **Response** (`200 OK`):
  ```json
  {
    "data": [FileResponse],
    "meta": { "total": 1, "limit": 25, "offset": 0 }
  }
  ```

### `GET /v2/storage/buckets/:bucketId/files/:fileId`

Get file metadata.

- **Response** (`200 OK`): `FileResponse`
- **Errors**:
  - `404 /errors/not-found` (`file_not_found`): File does not exist.

### `GET /v2/storage/buckets/:bucketId/files/:fileId/download`

Download file binary content.

- **Headers**: Supports standard `Range: bytes=start-end` header.
- **Response Headers**:
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename="<fileName>"`
  - `Content-Length: <size>`
  - `Accept-Ranges: bytes`
- **Status**: `200 OK` (or `206 Partial Content` if `Range` header is provided).

### `GET /v2/storage/buckets/:bucketId/files/:fileId/view`

View file inline (for images, pdfs, audio, video).

- **Response Headers**:
  - `Content-Type: <file.mimeType>`
  - `Content-Disposition: inline`
  - `Content-Length: <size>`
  - `Accept-Ranges: bytes`
- **Status**: `200 OK` (or `206 Partial Content` if `Range` header is provided).

### `PUT /v2/storage/buckets/:bucketId/files/:fileId`

Update file permissions.

- **Request Body**:
  ```json
  {
    "permissions": ["read(\"any\")", "update(\"user:123\")"]
  }
  ```
- **Response** (`200 OK`): `FileResponse`
- **Errors**:
  - `404 /errors/not-found` (`file_not_found`): File not found.

### `DELETE /v2/storage/buckets/:bucketId/files/:fileId`

Delete file from storage device and remove its metadata.

- **Response** (`204 No Content`): empty
- **Errors**:
  - `404 /errors/not-found` (`file_not_found`): File not found.
