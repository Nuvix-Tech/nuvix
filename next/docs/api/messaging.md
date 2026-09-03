# Nuvix v2 — Messaging API Contract

> Status: Contract drafted, ready for Phase 5 implementation  
> Single source of truth for the Messaging module (`/v2/messaging`).

---

## 1. Scope & Capabilities

The Messaging module provides unified multi-channel messaging (Email, SMS, and Push Notifications)
powered by `@nuvix/messaging`.

Core components:
- **Providers**: Configured delivery gateways (Mailgun, SendGrid, SMTP, Twilio, Vonage, Msg91, Telesign, TextMagic, FCM, APNS).
- **Topics**: Publish/subscribe channels that categorize messaging audiences.
- **Subscribers**: User and target bindings connected to specific topics.
- **Messages & Templates**: Multi-channel message creation, Handlebars template compilation, and live dispatch.

Auth requirements:
- Providers management: `providers.read`, `providers.write` (API key or project owner)
- Topics management: `topics.read`, `topics.write` (API key or project owner)
- Subscribers management: `subscribers.read`, `subscribers.write` (API key, project owner, or authenticated user for their own targets)
- Messages management: `messages.read`, `messages.write`

---

## 2. Types & Schema

### Provider Response
```json
{
  "$id": "provider_sendgrid",
  "$createdAt": "2026-09-03T12:00:00.000Z",
  "$updatedAt": "2026-09-03T12:00:00.000Z",
  "name": "Production Sendgrid",
  "type": "email",
  "adapter": "sendgrid",
  "enabled": true,
  "options": {
    "apiKey": "SG.xxx"
  }
}
```

### Topic Response
```json
{
  "$id": "topic_announcements",
  "$createdAt": "2026-09-03T12:00:00.000Z",
  "$updatedAt": "2026-09-03T12:00:00.000Z",
  "$permissions": ["read(\"any\")"],
  "name": "Announcements",
  "description": "General platform announcements",
  "total": 42
}
```

### Subscriber Response
```json
{
  "$id": "sub_123",
  "$createdAt": "2026-09-03T12:00:00.000Z",
  "$updatedAt": "2026-09-03T12:00:00.000Z",
  "topicId": "topic_announcements",
  "userId": "user_456",
  "userName": "Jane Doe",
  "targetId": "target_789",
  "target": "jane@example.com",
  "providerType": "email"
}
```

### Message Response
```json
{
  "$id": "msg_001",
  "$createdAt": "2026-09-03T12:00:00.000Z",
  "$updatedAt": "2026-09-03T12:00:00.000Z",
  "channel": "email",
  "topics": ["topic_announcements"],
  "users": [],
  "targets": ["jane@example.com"],
  "status": "completed",
  "deliveredTo": 1,
  "total": 1,
  "data": {
    "subject": "Welcome to Nuvix v2",
    "content": "Hello {{name}}, welcome to Nuvix!"
  },
  "deliveryErrors": []
}
```

---

## 3. Endpoints — Providers (`/v2/messaging/providers`)

- `POST /v2/messaging/providers`: Create delivery provider.
- `GET /v2/messaging/providers`: List providers.
- `GET /v2/messaging/providers/:providerId`: Get provider details.
- `PUT /v2/messaging/providers/:providerId`: Update provider configuration.
- `DELETE /v2/messaging/providers/:providerId`: Remove provider.

---

## 4. Endpoints — Topics (`/v2/messaging/topics`)

- `POST /v2/messaging/topics`: Create topic.
- `GET /v2/messaging/topics`: List topics.
- `GET /v2/messaging/topics/:topicId`: Get topic.
- `PUT /v2/messaging/topics/:topicId`: Update topic.
- `DELETE /v2/messaging/topics/:topicId`: Delete topic and unsubscribe members.

---

## 5. Endpoints — Subscribers (`/v2/messaging/topics/:topicId/subscribers`)

- `POST /v2/messaging/topics/:topicId/subscribers`: Add subscriber to topic.
- `GET /v2/messaging/topics/:topicId/subscribers`: List subscribers for a topic.
- `GET /v2/messaging/topics/:topicId/subscribers/:subscriberId`: Get subscriber.
- `DELETE /v2/messaging/topics/:topicId/subscribers/:subscriberId`: Remove subscriber from topic.

---

## 6. Endpoints — Messages (`/v2/messaging/messages`)

- `POST /v2/messaging/messages/email`: Create and optionally send Email.
- `POST /v2/messaging/messages/sms`: Create and optionally send SMS.
- `POST /v2/messaging/messages/push`: Create and optionally send Push Notification.
- `GET /v2/messaging/messages`: List messages.
- `GET /v2/messaging/messages/:messageId`: Get message.
- `DELETE /v2/messaging/messages/:messageId`: Delete message.
- `POST /v2/messaging/messages/:messageId/send`: Dispatch a drafted/pending message.
