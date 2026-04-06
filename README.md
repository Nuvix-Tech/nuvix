<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/gh/nuvix-dev/.github@main/images/hero_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://cdn.jsdelivr.net/gh/nuvix-dev/.github@main/images/hero_light.png">
  <img src="https://cdn.jsdelivr.net/gh/nuvix-dev/.github@main/images/hero_dark.png" width="100%" alt="Nuvix">
</picture>

# 🚀 Nuvix

### The open-source backend for secure, AI-ready applications.

**Auth · Database · Storage · Messaging**
One platform. Self-host anywhere. Built for scale.

<br>

[![License: FSL-1.1-Apache-2.0](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-blue)](LICENSE)
[![Discord](https://img.shields.io/discord/1417928996003250320?label=discord&logo=discord&logoColor=white)](https://discord.gg/rHKCXu7cYW)
[![GitHub Issues](https://img.shields.io/github/issues/nuvix-dev/nuvix)](https://github.com/nuvix-dev/nuvix/issues)
[![Docs](https://img.shields.io/badge/docs-read%20the%20docs-blueviolet)](https://nuvix-docs.vercel.app)

[📖 Documentation](https://nuvix-docs.vercel.app) · [💬 Discord](https://discord.gg/rHKCXu7cYW) · [🐛 Report Bug](https://github.com/nuvix-dev/nuvix/issues) · [✨ Request Feature](https://github.com/nuvix-dev/nuvix/issues)

</div>

---

## What is Nuvix?

Most apps need the same backend building blocks: auth, a database, file storage, and messaging. The usual answer is **4 different vendors**, **4 dashboards**, and **4 billing pages** before you write a single line of product code.

**Nuvix replaces all of that.**

✅ One unified backend
✅ Single permission model
✅ Fully self-hostable
✅ Security-first by design
✅ Built for AI-powered products

Stop managing multiple services. Start building products.

---

## ✨ Core Features

### 🔐 Authentication
Multi-tenant auth with user accounts, sessions, teams, and role-based access. Security isn't a config option—it's the default.

**Includes:** OAuth/Social login, MFA, session management, team roles, permissions

### 🗄️ Database
PostgreSQL under the hood. Three schema modes so you pick the right fit for each use case:

| Mode | Best For | What You Get |
|------|----------|--------------|
| 📋 **Document** | Prototyping, MVPs | NoSQL-style flexibility, no SQL needed |
| ⚙️ **Managed** | Production apps | Auto-generated CRUD + Row-Level Security policies |
| 🔧 **Unmanaged** | Custom logic | Raw SQL, full control, no guardrails |

Mix and match across the same project. All three share one unified API.

### 💾 Storage
Permission-aware file system with S3-compatible drivers or local storage. The same permission rules that govern your database govern your files.

**Includes:** Local & S3-compatible storage, permission inheritance, signed URLs, CDN-ready

### 📬 Messaging
Email, SMS, and push notifications through a single API. No need to wire up SendGrid, Twilio, and Firebase separately.

**Includes:** Email templates, SMS delivery, push notifications, delivery tracking, scheduling

### 🤖 AI-Ready
Purpose-built for AI products. Secure data layers, granular permissions, session management, and file handling for ML pipelines. Store embeddings, manage context, enforce access rules on every request.

---

## 🚀 Getting Started

### ⚡ Quickest Start: CLI

Get up and running in seconds with the Nuvix CLI.

```bash
curl -fsSL https://raw.githubusercontent.com/nuvix-dev/cli/main/install.sh | bash
```

Then run:

```bash
nuvix local init
nuvix local up
```

Open **`http://localhost:3000`** and start building! 🎉

> **Requirements:** [Docker](https://docs.docker.com/get-docker/)

### 🐳 Alternative: Docker Compose

```bash
git clone https://github.com/nuvix-dev/docker.git nuvix
cd nuvix
cp .env.example .env
docker compose up -d
```

📚 [Full self-hosting instructions](https://docs.nuvix.in/self-hosting)

### 💻 Local Development

```bash
bun install
bun run dev     # Start dev server with auto-reload
bun run test    # Run full test suite
bun run lint    # Format & lint with Biome
```

---

## 📦 Web SDK Installation

Use the Nuvix client SDK in your web projects:

### npm

```bash
npm install @nuvix/client
```

### bun

```bash
bun add @nuvix/client
```

### Quick Usage

```typescript
import { Client } from '@nuvix/client';

const nx = new Client()
    .setEndpoint('https://api.nuvix.in/v1')

// Authentication
const session = await nx.account.createAnonymousSession();

// Database queries
const todos = await nx.db.from('todos').select('*');
```

---

## 📐 Architecture

```
nuvix/
├── apps/
│   ├── server              Core API server (Fastify)
│   └── platform            Platform services
├── libs/
│   ├── core                Shared core logic
│   ├── pg-meta             PostgreSQL metadata layer
│   └── utils               Common utilities
├── configs/                Default configurations
├── docs/                   Documentation source
└── scripts/                Build & deployment scripts
```

---

## 🔒 Security Model

Security isn't an afterthought. Every request in Nuvix passes through the same permission pipeline.

- **🛡️ Managed Schemas** - Auto-generate Row-Level Security policies. You don't write them by hand.
- **🔐 Project Isolation** - Tenant data is separated at the database level.
- **🏠 Self-Hosted** - Your data never leaves your infrastructure.
- **⚡ Unified Pipeline** - Same permission model for database, storage, and messaging.

> Security in Nuvix is always on. You don't enable it—it's the default.

---

## 🗺️ Roadmap

Exciting features coming soon:

- [ ] Realtime subscriptions (WebSocket support)
- [ ] Edge functions (Deploy functions at the edge)
- [ ] Python SDK
- [ ] Vector / embeddings support (AI-optimized)
- [ ] Multi-region self-hosting guide

Have an idea? [Open an issue](https://github.com/nuvix-dev/nuvix/issues) or [join our Discord](https://discord.gg/2fWv2T6RzK) 💙

---

## 🤝 Contributing

We ❤️ contributions! Whether it's code, docs, bug reports, or ideas—we'd love your input.

1. 📖 Read the [Contributing Guide](CONTRIBUTING.md)
2. 🔍 Browse [open issues](https://github.com/nuvix-dev/nuvix/issues)
3. 💬 Join our [Discord community](https://discord.gg/2fWv2T6RzK)

> By submitting a pull request, you agree that Nuvix may use, modify, copy, and redistribute the contribution under terms of its choosing.

---

## 🐛 Bugs & Security

**Found a bug?** We'd appreciate a detailed [issue on GitHub](https://github.com/nuvix-dev/nuvix/issues) with steps to reproduce.

**Found a security vulnerability?** Please **do not** open a public issue. Email [security@nuvix.in](mailto:security@nuvix.in) instead. We'll work with you to patch it before any public disclosure.

---

## 📚 Resources & Links

| Resource | Purpose |
|----------|---------|
| 📖 [Documentation](https://nuvix-docs.vercel.app) | Guides, API reference, tutorials, examples |
| 🖥️ [Console](https://github.com/nuvix-dev/console) | Admin dashboard (self-hosted or managed) |
| 💬 [Discord Community](https://discord.gg/rHKCXu7cYW) | Get help, ask questions, share ideas |
| 🐦 [X / Twitter](https://x.com/nuvix_dev) | Latest updates and announcements |
| 📝 [Blog](#) | Tutorials, case studies, releases |

---

## 📄 License

[FSL-1.1-Apache-2.0](LICENSE)

---

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=nuvix-dev/nuvix&type=Date)](https://star-history.com/#nuvix-dev/nuvix&Date)

### **If Nuvix helps you build better products, drop a star ⭐**

It helps us grow and lets the world know you find this useful.

</div>
