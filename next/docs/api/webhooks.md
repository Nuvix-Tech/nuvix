# Webhooks API Contract (Phase 5)

## 1. Overview

The Webhooks API allows projects to configure HTTP push callbacks triggered by
platform and tenant events (such as user creation, document updates, storage
changes, and messaging dispatches).

Every webhook belongs to a tenant project and defines:
- **Target URL**: A validated public HTTP/HTTPS URL protected against SSRF.
- **Event Filters**: Wildcard-capable event patterns (e.g., `users.*`, `database.documents.*`, `*`).
- **Cryptographic Signature Key**: A dedicated HMAC-SHA256 secret key rotated on demand.
- **Security Policy**: Configurable TLS certificate verification and optional HTTP Basic authentication.
- **Delivery Logging**: Full audit trail of delivery attempts, HTTP status codes, durations, and responses.

## 2. Authentication and Scopes

All endpoints require project selection via `x-nuvix-publishable-key` and an
authenticated tenant caller (`x-nuvix-key`, `x-nuvix-jwt`, or `x-nuvix-session`).

| Scope            | Allowed Operations                                              |
| ---------------- | --------------------------------------------------------------- |
| `webhooks.read`  | List webhooks, get webhook details, list delivery logs          |
| `webhooks.write` | Create, update, rotate signature, delete, trigger test dispatch |

## 3. Cryptographic Signature & Headers

Every outgoing webhook delivery contains standard headers defined in
`docs/api/_conventions.md`:

| Header                | Format / Description                                        |
| --------------------- | ----------------------------------------------------------- |
| `Content-Type`        | `application/json`                                          |
| `x-nuvix-timestamp`   | Unix timestamp in seconds of payload transmission           |
| `x-nuvix-nonce`       | Unique transmission ID / UUID                               |
| `x-nuvix-signature`   | `sha256=<hex_hmac_sha256>` computed over payload string     |
| `X-Webhook-Signature` | `sha256=<hex_hmac_sha256>` (compatibility mirror)           |
| `X-Webhook-Event`     | The exact event string that triggered the delivery          |
| `X-Webhook-ID`        | The unique webhook identifier                               |
| `Authorization`       | `Basic <base64>` when `httpUser` and `httpPass` are defined |

### Payload Structure

```json
{
  "event": "users.create",
  "timestamp": "2026-09-03T12:00:00.000Z",
  "data": {
    "userId": "usr_123",
    "name": "Alice Example"
  }
}
```

## 4. SSRF URL Guard

All webhook URLs are validated before persistence and before dispatch:
- Supported protocols: `http:`, `https:`.
- Embedded credentials in URLs are rejected (use `httpUser`/`httpPass`).
- Blocked target IP ranges:
  - IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`.
  - IPv6: `::`, `::1`, `::ffff:*`, Unique-Local `fc00::/7`, Link-Local `fe80::/10`.
- Blocked hostnames: `localhost`, `*.localhost`, `*.local`, `*.internal`.

## 5. Endpoints

### 5.1 Create Webhook
`POST /v2/webhooks` (Scope: `webhooks.write`)

#### Request Body
```json
{
  "webhookId": "wh_alerts",
  "name": "Production Alerts",
  "events": ["users.*", "storage.*"],
  "url": "https://api.example.com/webhooks/nuvix",
  "security": true,
  "httpUser": "webhook_client",
  "httpPass": "client_secret",
  "enabled": true
}
```

#### Response: `201 Created`
```json
{
  "$id": "wh_alerts",
  "$createdAt": "2026-09-03T12:00:00.000Z",
  "$updatedAt": "2026-09-03T12:00:00.000Z",
  "name": "Production Alerts",
  "events": ["users.*", "storage.*"],
  "url": "https://api.example.com/webhooks/nuvix",
  "security": true,
  "httpUser": "webhook_client",
  "signatureKey": "a9f3b...",
  "enabled": true,
  "attempts": 0,
  "logs": ""
}
```

---

### 5.2 List Webhooks
`GET /v2/webhooks` (Scope: `webhooks.read`)

#### Response: `200 OK`
```json
{
  "total": 1,
  "webhooks": [
    {
      "$id": "wh_alerts",
      "$createdAt": "2026-09-03T12:00:00.000Z",
      "$updatedAt": "2026-09-03T12:00:00.000Z",
      "name": "Production Alerts",
      "events": ["users.*", "storage.*"],
      "url": "https://api.example.com/webhooks/nuvix",
      "security": true,
      "httpUser": "webhook_client",
      "signatureKey": "a9f3b...",
      "enabled": true,
      "attempts": 0,
      "logs": ""
    }
  ]
}
```

---

### 5.3 Get Webhook
`GET /v2/webhooks/:webhookId` (Scope: `webhooks.read`)

#### Response: `200 OK`
Returns single `WebhookResponse`.

---

### 5.4 Update Webhook
`PUT /v2/webhooks/:webhookId` (Scope: `webhooks.write`)

#### Request Body
```json
{
  "name": "Renamed Alerts",
  "events": ["users.create"],
  "url": "https://api.example.com/v2/webhooks",
  "enabled": true
}
```

#### Response: `200 OK`
Returns updated `WebhookResponse`.

---

### 5.5 Rotate Signature Key
`PATCH /v2/webhooks/:webhookId/signature` (Scope: `webhooks.write`)

#### Response: `200 OK`
Generates a new random 64-byte hex HMAC key and returns the updated `WebhookResponse`.

---

### 5.6 Delete Webhook
`DELETE /v2/webhooks/:webhookId` (Scope: `webhooks.write`)

#### Response: `204 No Content`

---

### 5.7 Trigger Test Dispatch
`POST /v2/webhooks/:webhookId/test` (Scope: `webhooks.write`)

#### Request Body (optional)
```json
{
  "event": "test.ping",
  "data": { "hello": "world" }
}
```

#### Response: `200 OK`
```json
{
  "success": true,
  "statusCode": 200,
  "durationMs": 45,
  "response": "{\"ok\":true}",
  "error": null
}
```

---

### 5.8 List Delivery Logs
`GET /v2/webhooks/:webhookId/logs` (Scope: `webhooks.read`)

#### Response: `200 OK`
```json
{
  "total": 1,
  "logs": [
    {
      "$id": "log_123",
      "webhookId": "wh_alerts",
      "event": "test.ping",
      "success": true,
      "statusCode": 200,
      "response": "{\"ok\":true}",
      "error": null,
      "durationMs": 45,
      "timestamp": "2026-09-03T12:00:01.000Z"
    }
  ]
}
```
