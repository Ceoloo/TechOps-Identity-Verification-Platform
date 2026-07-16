# TechOps Identity Verification Platform

A configurable, **multi-tenant** identity verification (KYC/KYB) platform. It
verifies identity using **licensed, consented** third-party APIs (Stripe
Identity, Persona, OFAC, business registries, Twilio). It performs **no**
scraping, OSINT, or reconnaissance — every piece of identity data comes from a
licensed provider adapter.

The platform is built as a **template**: business rules, verification tiers,
required data points, branding, consent language, and provider integrations are
all stored as per-tenant configuration in the database and edited through the
admin UI — not hardcoded. The same codebase serves many business instances.

> **Status:** Phase 1 (data model & multi-tenant schema) is implemented and
> verified. Later phases (provider adapters, rules engine, intake flow, admin
> dashboard, review queue, audit tooling, retention automation) build on this
> foundation.

---

## Monorepo layout

```
/backend      Node.js + Express API, data layer, migrations runner, crypto
/frontend     React + Tailwind app (built in later phases)
/migrations   Ordered SQL migrations (source of truth for the schema)
/docs         This documentation
```

---

## The config-driven, multi-tenant model

Every tenant is a row in `businesses`. **Every tenant-owned row carries a
`business_id`**, and all queries are expected to be scoped by it — that is the
isolation boundary. Indexes exist on `business_id` (and on `status` for
verifications) to keep tenant-scoped queries fast.

What would normally be hardcoded per business is instead **data**:

| Concern | Where it lives | Edited in (phase) |
| --- | --- | --- |
| Branding (logo, colors) | `businesses.branding` (jsonb) | Admin settings (5) |
| Which checks are required | `verification_tiers.required_checks` (jsonb) | Tier builder (5) |
| Risk decision thresholds | `verification_tiers.risk_thresholds` (jsonb) | Tier builder (5) |
| Provider API keys | `provider_integrations.config_encrypted` | Integration settings (5) |
| Consent language | `consent_documents` (versioned) | Consent editor (5) |
| Data retention windows | `retention_policies` | Retention settings (5/8) |

Because the rules engine (Phase 3) reads `required_checks` and
`risk_thresholds` straight from the tier config, an admin can change
verification behavior by editing config in the UI — **no code deploy required**.

### Two-schema PII isolation

Personally identifiable information is kept in a **separate `pii` schema**,
isolated from operational/CRM data in `public`:

- `pii.subjects` — the encrypted PII payload for each verification subject.
- Operational tables (`verifications`, `consent_records`, …) reference subjects
  by id and never store raw PII inline.

In production, the `pii` schema is intended to be granted to a narrower database
role than the operational tables.

---

## Data model (Phase 1)

Operational / config (`public` schema):

- **businesses** — tenant root: name, industry, jurisdiction, branding (jsonb).
- **users** — internal users with role `admin` or `reviewer`, scoped to a business.
- **verification_tiers** — `required_checks` + `risk_thresholds` (both jsonb).
- **provider_integrations** — per-business provider config; secrets encrypted in
  `config_encrypted`, never returned by any API.
- **consent_documents** — editable, versioned consent text; one active per business.
- **retention_policies** — `retention_days` per `data_type`.
- **consent_records** — immutable snapshot of a consent event (text version,
  ip, timestamp).
- **verifications** — a verification run: tier, subject, `subject_type`,
  `status` (pending / approved / rejected / manual_review), decision fields.
- **verification_checks** — one row per provider check; `raw_result_encrypted`
  holds the encrypted raw provider payload.
- **audit_log** — append-only trail of who did what to which target.

PII (`pii` schema):

- **pii.subjects** — `pii_encrypted` (AES-256-GCM envelope), plus a keyed
  `lookup_hash` for data-subject search without storing identifiers in plaintext.

See `/migrations` for the authoritative DDL (columns, checks, indexes).

---

## Field-level encryption

`backend/src/crypto/encryption.js` provides AES-256-GCM authenticated
encryption at the **application/field level** (independent of disk encryption):

- Used for `pii.subjects.pii_encrypted`, `verification_checks.raw_result_encrypted`,
  and `provider_integrations.config_encrypted`.
- Ciphertext is a **self-describing envelope** carrying its key id, so keys can
  be **rotated** without a data migration (old data opens with the embedded key
  id; new data seals with the current key).
- Supports **AAD** (additional authenticated data) to bind a ciphertext to a
  context such as `business:<id>`, so an encrypted blob cannot be silently moved
  between tenants/records.

The key is supplied as a base64-encoded 32-byte value in `PII_ENCRYPTION_KEY`.
Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Verification providers (Phase 2)

All identity data comes from **licensed provider adapters**. Every adapter
extends `VerificationProvider` (`backend/src/providers/base.js`) and implements:

```js
async submit(subjectData)   // -> CheckResult
async getStatus(referenceId) // -> CheckResult
```

Each returns the same normalised `CheckResult` shape (`provider`, `checkType`,
`outcome`, `score`, `reference`, `raw`, `meta`) so the rules engine (Phase 3)
never needs provider-specific knowledge. `raw` holds the provider payload and is
encrypted before it lands in `verification_checks.raw_result_encrypted`.

Implemented adapters:

| Provider key | Check type | Purpose | Live-mode config keys |
| --- | --- | --- | --- |
| `stripe_identity` | `id_document` | Individual ID + liveness | `secret_key` |
| `persona` | `identity_kyb` | Individual + business KYB | `api_key`, `template_id` |
| `ofac` | `sanctions_screening` | OFAC/PEP sanctions screening | `api_key` (optional; free CSL API) |
| `opencorporates` | `business_registry` | Business registry lookup | `api_token` (optional) |
| `twilio_lookup` | `phone` | Phone validation | `account_sid`, `auth_token` |
| `email_otp` | `email_otp` | Email one-time-passcode | transport injected (`sendEmail`) |

**Credentials are per-business.** Adapters are built by the registry
(`providers/registry.js`) via `loadProviderForBusiness({ businessId, providerKey })`,
which reads the tenant's `provider_integrations` row, decrypts `config_encrypted`
(AAD-bound to `business:<id>`), and selects the mode. No adapter ever reads a
global env var for secrets.

### Sandbox mode

Setting `PROVIDER_MODE=sandbox` (the default) forces **every** adapter into
sandbox — no real API calls, deterministic results — so local dev and tests need
no real keys. Outcomes are driven by magic keywords in the subject data:

- a field containing `sanction` → sanctions hit / `fail`
- a field containing `fail` → `fail`
- a field containing `review` → `manual_review`
- otherwise → `pass`

Phone validity keys off digit length; email OTP returns the generated code in
`meta.sandbox_code` for test convenience. In production, per-business
integrations set `mode = 'live'` and `PROVIDER_MODE` is left unset.

The `email_otp` adapter is interactive: `submit` issues a code (stored only as a
salted SHA-256 hash with expiry + attempt limit), `verify(referenceId, code)`
checks it, and `getStatus` reports state. Challenge state uses an injectable
store (in-memory by default; inject Redis/DB for multi-instance production).

---

## Rules engine (Phase 3)

`backend/src/rules/engine.js` turns a tier's config plus the Phase 2 adapter
results into one of three decisions:

```
auto_approve  -> verification status "approved"
manual_review -> verification status "manual_review"
auto_reject   -> verification status "rejected"
```

It is a **pure, data-driven** function of `tier.required_checks` and
`tier.risk_thresholds` (jsonb) — nothing is hardcoded per business, so editing
thresholds in the admin UI changes behavior with no deploy.

Evaluation precedence (fail-safe):

1. **auto_reject** — OR semantics: if *any* configured reject condition matches
   (e.g. `any_sanctions_hit`, `min_risk_score`), reject.
2. **auto_approve** — AND semantics: *all* configured approve conditions must
   hold (e.g. `all_required_pass` **and** `max_risk_score`).
3. Otherwise the configured `default` (usually `manual_review`).

The aggregate `risk_score` is the highest score across all checks (most
conservative). Supported conditions: `all_required_pass`, `any_required_fail`,
`any_required_missing`, `required_checks_completed`, `any_error`,
`any_manual_review`, `any_sanctions_hit`, `max_risk_score`, `min_risk_score`.

`evaluateAndLog()` (`rules/index.js`) runs the evaluation and writes a
`rules.evaluate` row to `audit_log` capturing the inputs (aggregated facts +
per-check outcomes/scores) and the decision — **never** raw provider payloads or
PII. Pass a transaction `runner` so the audit entry commits atomically with the
verification update.

---

## Public intake flow (Phase 4)

The public, unauthenticated intake API (`backend/src/routes/publicIntake.js`,
orchestrated by `services/intakeService.js`):

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/public/intake/:businessId/form` | Dynamic form descriptor for the active tier |
| POST | `/api/public/intake/:businessId` | Submit an intake (rate-limited) |
| GET | `/api/public/verifications/:businessId/:id/status` | Customer status view |

- **Dynamic form** — fields are derived from the active tier's `required_checks`
  (`deriveIntakeFields`), so changing a tier changes the rendered form. The
  response includes the business branding and the **active consent version +
  text**.
- **Explicit consent** — submit requires `consentAccepted: true` and a
  `consentVersion` matching the active document; a snapshot of the exact text is
  written to `consent_records` with the client IP and user agent.
- **Orchestration** — one transaction persists the encrypted subject + consent +
  a `pending` verification; provider checks then run (outside the txn since live
  adapters make network calls); a second transaction stores each check with its
  **encrypted raw payload**, runs the rules engine, and sets the final status.
  A provider invoked for a specific required check has its result tagged with
  that check's `check_type` (one provider can back several, e.g. Stripe covers
  `id_document` and `liveness`).
- **Customer status view** — returns only `status` + timestamps. Raw check
  results and provider payloads are **never** exposed to the customer.
- **Rate limiting** — the POST endpoint is limited per client IP
  (`INTAKE_RATE_MAX` / `INTAKE_RATE_WINDOW_MS`).
- **PII access audited** — subject writes/reads go through `subjectService`,
  which logs `pii.write` / `pii.read` to `audit_log` (field names only, never
  values).

Run the API locally:

```bash
npm --workspace backend run start   # or: dev (watch mode)
# GET http://localhost:4000/health
```

---

## Internal APIs: auth, admin, review, audit (Phases 5–7)

Internal endpoints require a bearer token from `POST /api/auth/login`. Tokens are
HMAC-signed and carry the user's `business_id` and `role`; the tenant is always
taken from the token, never from the request — there is no cross-tenant surface.
Roles: **admin** (full config) and **reviewer** (review queue only); admin is a
superset of reviewer.

**Admin (Phase 5)** — `/api/admin/*`, admin only:
- `business` (GET/PATCH) — profile + branding
- `tiers` (GET/POST/PATCH) — verification tier builder (required_checks, thresholds)
- `integrations` (GET/PUT) — enter/rotate provider keys; **secrets are encrypted
  on write and never returned** (responses expose only `has_secret` + metadata)
- `consent` (GET/POST) — consent editor; each save **auto-versions** and activates,
  keeping history
- `retention` (GET/PUT) — retention_days per data_type
- `notifications` (GET/PUT) — recipients per event (e.g. `manual_review`)
- `users` (GET/POST) — create admin/reviewer users

**Review queue (Phase 6)** — `/api/review/*`, reviewer or admin:
- `GET /queue` — verifications in `manual_review`
- `GET /verifications/:id` — **non-raw** check summaries (outcome/score only)
- `GET /verifications/:id/raw` — **admin only**; decrypts raw payloads + subject
  PII, audited as `check.read_raw` / `pii.read`
- `POST /verifications/:id/decision` — approve/reject with a **required reason**;
  writes `verification.decide` with reviewer id + reason

**Audit + Data Subject Rights (Phase 7)** — `/api/audit/*`, admin only:
- `GET /log` — searchable/filterable audit history (from/to/actor/action/targetId)
- `GET /subjects?email=` — find subjects via the privacy-preserving lookup hash
- `GET /subjects/:id/records` — all records for a subject (DSAR access), PII
  decrypted with an audited read
- `DELETE /subjects/:id` — **right-to-erasure**: cascades across the subject's
  verifications/checks/consent and logs the deletion as `data_subject.delete`

## Frontend (React + Tailwind)

`/frontend` is a Vite + React + Tailwind SPA that consumes the APIs above:

- **Public intake** (`/verify/:businessId`) — renders the dynamic form + consent
  from the tenant's active tier, submits, and shows a customer status page
  (`/verify/:businessId/status/:id`).
- **Admin console** (`/app/*`, admin) — business/branding, tier builder,
  integration key entry (secrets write-only), consent editor with version
  history, retention, notifications, users, audit log viewer, and the data
  subject request tool (search / export / erase).
- **Review queue** (`/app/review`, reviewer or admin) — queue, per-verification
  check summaries, admin-only audited raw view, and approve/reject with a reason.

Auth is a bearer token from `/api/auth/login` kept in `localStorage`; the token's
role drives which nav/routes are available. The dev server proxies `/api` to the
backend on `:4000`.

```bash
npm --workspace frontend run dev      # http://localhost:5173
npm --workspace frontend run build    # production build to frontend/dist
```

Demo login after seeding: `admin@acme.example` / `password123` (and
`reviewer@acme.example`).

---

## Retention automation (Phase 8)

`backend/src/jobs/retention.js` (schedule via cron/timer) enforces
`retention_policies` per business:
- `verification_checks` past the window are **anonymised** (encrypted raw payload
  nulled, outcome row kept for audit/stats)
- `consent_records` past the window are **deleted**

Every sweep that affects rows writes a `retention.sweep` audit entry with counts.

```bash
npm --workspace backend run retention -- --dry-run   # preview
npm --workspace backend run retention                # enforce
```

---

## Security posture

- **Field-level PII encryption at rest** — via the crypto module above.
- **PII isolated in its own schema** — `pii.*`, separate from operational data.
- **Encrypted per-business API keys** — stored in `config_encrypted`; the schema
  keeps secrets out of `config_meta` so API responses can safely return metadata
  only, never the secret.
- **No PII in logs** — the DB layer logs only error class/message; the error
  handler returns generic 500s with a correlation id and never echoes request
  bodies/params.
- **All PII access audited** — subject reads/writes and raw-payload views go
  through the service layer, which logs `pii.read` / `pii.write` /
  `check.read_raw` (field names only, never values).
- **Rate limiting** — the public intake and login endpoints are rate-limited per
  client IP.
- **Least-exposure by role** — reviewers see only non-raw summaries; raw PII is
  admin-only and audited. Passwords are scrypt-hashed; auth tokens are
  HMAC-signed with expiry.
- **Right-to-erasure + retention** — subject data can be fully erased on request
  and is automatically anonymised/deleted past its retention window, both
  audited.

---

## Getting started (local)

Prerequisites: Node.js ≥ 20 and PostgreSQL ≥ 13.

```bash
# 1. Install workspace deps
npm install

# 2. Configure backend env
cp backend/.env.example backend/.env
#   - set DATABASE_URL to your local Postgres
#   - set PII_ENCRYPTION_KEY (see command above)

# 3. Create the database (once)
createdb techops_kyc

# 4. Apply migrations
npm run migrate            # or: npm run migrate:status / migrate:down

# 5. (optional) Seed a demo tenant
npm --workspace backend run seed

# 6. Run tests
npm test
```

### Migration runner

Plain SQL files in `/migrations`, named `NNN_description.sql`, applied in order
and tracked in `schema_migrations`. Each file has an `-- @UP` section and an
optional `-- @DOWN` section for rollback. Applied files are checksummed; editing
an already-applied migration is rejected — add a new migration instead.

---

## Adding a new verification provider adapter (Phase 2 forward)

The provider layer is designed to be **pluggable** and reads its credentials
from per-business config, not global env vars. To add a provider:

1. **Implement the `VerificationProvider` interface** (Phase 2) with the standard
   method signatures, e.g.:
   ```js
   class MyProvider {
     constructor(config) { this.config = config; } // decrypted per-business config
     async submit(subjectData) { /* -> { outcome, score, reference, raw } */ }
     async getStatus(referenceId) { /* -> { outcome, score, raw } */ }
   }
   ```
2. **Support sandbox mode** — return deterministic mock results when the
   integration's `mode` is `sandbox` (or when `PROVIDER_MODE=sandbox`), so local
   dev needs no real API calls or keys.
3. **Read secrets from `provider_integrations.config_encrypted`** for the current
   business (decrypted via the crypto module), never from global env.
4. **Register the provider** under a stable key (e.g. `my_provider`) so it can be
   referenced from `verification_tiers.required_checks` and toggled in the admin
   Integration settings.
5. **Persist results** into `verification_checks` with the raw payload encrypted
   into `raw_result_encrypted`.

Nothing about the provider is hardcoded per tenant — a business enables it and
supplies keys through the admin UI, and references it from a tier's
`required_checks`.
