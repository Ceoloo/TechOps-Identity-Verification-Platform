# TechOps Identity Verification Platform

A configurable, **multi-tenant** identity verification (KYC/KYB) platform that
verifies identity using **licensed, consented** third-party APIs (Stripe
Identity, Persona, OFAC, business registries, Twilio). No scraping, OSINT, or
reconnaissance — all identity data comes from licensed provider adapters.

The platform is a **template**: verification tiers, required checks, risk
thresholds, branding, consent language, and provider integrations are all
per-tenant configuration edited through the admin UI — not hardcoded — so one
codebase serves many business instances.

## Monorepo layout

```
/backend      Node.js + Express API, data layer, migrations, field-level crypto
/frontend     React + Tailwind app (built in later phases)
/migrations   Ordered SQL migrations (authoritative schema)
/docs         Documentation — start with docs/README.md
```

## Quick start

```bash
npm install
cp backend/.env.example backend/.env      # set DATABASE_URL + PII_ENCRYPTION_KEY
createdb techops_kyc
npm run migrate                            # apply schema
npm --workspace backend run seed           # optional demo tenant
npm test
```

Full documentation — the config-driven tenant model, the data model, field-level
encryption, and how to add a verification provider adapter — is in
[`docs/README.md`](docs/README.md).

## Build phases

1. **Data model & multi-tenant schema** — ✅ implemented (`/migrations`)
2. **Verification provider adapters** (licensed sources only) — ✅ implemented
3. **Rules engine** (data-driven from tier config) — ✅ implemented
4. **Consent & public intake flow** — ✅ implemented
5. **Admin dashboard** (backend APIs) — ✅ implemented
6. **Manual review queue** (backend APIs) — ✅ implemented
7. **Audit log viewer & data-subject-rights tooling** (backend APIs) — ✅ implemented
8. **Retention automation** — ✅ implemented

The React + Tailwind frontend (`/frontend`) implements the public intake flow,
admin console, and review queue against these APIs.

## Demo

After `npm run migrate && npm --workspace backend run seed`, start the backend
(`npm --workspace backend start`) and frontend (`npm --workspace frontend run
dev`), then:

- Public intake: `http://localhost:5173/verify/<businessId>`
- Admin console: `http://localhost:5173/login` — `admin@acme.example` / `password123`
