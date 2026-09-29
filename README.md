# PDLIFE Backend

Node.js + TypeScript + Express + Supabase (PostgreSQL) backend for the PDLIFE Parkinson's
symptom-diary app. Built against `PROMPT_backend_pdlife.md`, using
`docs/pdlife_schema_v3_3.sql` (the authoritative DDL — supersedes the older
`PD_Life_Schema_v3_Complete.pdf`, which is kept for its prose/business-rule sections, §9
onward), `PDLIFE_Functional_Requirements.docx`, and `PDLIFE_Question_Bank_master_v1.xlsx` (all
in `docs/`) as the source of truth — see `API_EXAMPLES.md` for example requests once the
server is running.

## Stack

Node.js · TypeScript · Express · Supabase (service-role key, RLS deliberately not enabled yet
— see §11 in the migration) · JWT auth · Zod validation · Repository → Service → Controller
layering (see `src/` folder structure below).

## 1. Prerequisites

- Node.js 20+
- A Supabase project (free tier is fine) — you need its URL and **service-role** key
- Python 3 + `pip install openpyxl bcrypt` — only needed to run `seed/gen_seed.py`, not to run the server

## 2. Install

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Meaning |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (bypasses RLS — this backend enforces RBAC itself; see `src/services/patientAccessService.ts`) |
| `JWT_SECRET` | Random secret for signing app-issued JWTs (independent of Supabase Auth) |
| `JWT_EXPIRES_IN` | e.g. `1d` |
| `CORS_ORIGIN` | Your client's origin, or `*` for local dev |
| `PORT` | Default `3000` |

## 3. Set up the database

All tables live in a dedicated **`pdlife` schema**, not `public` (schema v3.2+) — this keeps
the app's tables isolated even if something else shares the same Supabase project.

**Before running anything**, expose the schema to Supabase's API:
**Project Settings → API → Exposed schemas → add `pdlife`.** Without this step every request
from this backend will 404, since `@supabase/supabase-js` talks to Postgres through PostgREST,
which only serves schemas explicitly exposed there.

Then, in order, on your Supabase project's SQL editor (or `psql`):

```bash
# 1. Schema — run docs/pdlife_schema_v3_3.sql in full (it creates the schema, all 20 tables,
#    2 views, and a locked-down `pdlife_app` Postgres role — see note below).
migrations/0001_init_schema.sql

# 2. Apply every numbered migration in order (0002 through 0010).
#    Do not start the current backend against a database that lacks 0009/0010:
#    profile/allergy and activity APIs will return HTTP 500.
migrations/0002_grant_service_role.sql
migrations/0003_one_assessment_per_appointment.sql
migrations/0004_one_doctor_note_per_appointment.sql
migrations/0005_one_appointment_per_doctor_slot.sql
migrations/0006_add_id_card_to_patient_full_view.sql
migrations/0007_add_caregiver_profiles.sql
migrations/0008_add_caregiver_invites.sql
migrations/0009_add_patient_allergies.sql
migrations/0010_activity_schedule_idempotency.sql

# 3. Seed data — question bank config + a bootstrap admin account
python3 seed/gen_seed.py   # regenerates seed/seed.sql from docs/PDLIFE_Question_Bank_master_v1.xlsx
seed/seed.sql
```

Run each SQL file in the Supabase SQL editor (or with a database-admin connection),
then run `npm run db:check`. The service-role key used by the API cannot execute
these DDL migrations. Do not re-run a numbered migration that has already applied;
the files are not all repeatable. Migration 0010 retains all historical medication
logs, rounds and responses; it does not delete clinical data.

For an admin connection on a local development machine, put
`PDLIFE_DATABASE_ADMIN_URL` in the git-ignored `.env.admin` file and run
`npm run db:migrate`. This runner only handles 0009/0010, detects already-applied
or partially-applied schema state, and never prints the connection string. Confirm
that the URL points to the intended Supabase project before running it.

`seed.sql` is safe to re-run any time the workbook changes — every insert is an upsert. It also
creates the **first admin account** (`user_name: admin`, printed password in the file's header
comment) since `/api/auth/provision` itself requires an existing admin to call it — **log in and
change that password immediately.**

`medications` (the drug catalog) is intentionally **not** seeded — the schema documents it as
admin-managed (`POST /api/medications`), and no drug data was in the source docs to seed from.

> **The migration also creates a `pdlife_app` Postgres role** (schema §12), scoped only to the
> `pdlife` schema with `public` explicitly revoked, as a defense-in-depth hardening layer for a
> *direct* Postgres connection. This backend doesn't use it — it talks to Supabase over
> PostgREST with the service-role key, which is the path §11's own guidance endorses for the
> current RLS-not-enabled dev phase. Set a real password on that role if you want it available
> for a future direct-`pg`-connection path; it's inert otherwise. `REVOKE UPDATE, DELETE ON
> pdlife.audit_logs` (append-only enforcement) only binds that role too — the service-role key
> bypasses it, so audit-log immutability is currently enforced only by the app never issuing an
> UPDATE/DELETE against that table (true today — check `src/repositories` before relying on it).

## 4. Run

```bash
npm run dev          # tsx watch, http://localhost:3000
npm run build         # tsc -> dist/
npm start              # node dist/server.js
```

A cron job inside the process (`src/jobs/scheduler.ts`) runs every minute once the server is up —
it generates `round_instances`/`medication_logs` and sends push notifications per schema §9.1/§9.6.
No separate process to run.

## 5. Test

```bash
npm run typecheck      # src/ + tests/ + scripts/ — same project the editor uses
npm run build          # compiles src/ only, via tsconfig.build.json
npm test               # unit tests (pure logic) + HTTP integration tests against the real app
```

Tests don't need a configured Supabase project — `npm test` supplies dummy env vars and every
test stays on the validation/auth/RBAC side of the middleware chain (see `tests/`).

## Folder structure

```
src/
├── config/        env, supabase client (pdlife schema), constants (mirrors the DB enums)
├── types/         hand-authored TS types matching migrations/0001_init_schema.sql exactly
├── schemas/       Zod request validation, one file per module
├── repositories/  Supabase queries only — no business logic
├── services/      business logic — flow engine, scheduler, red flags, notifications, per-module
├── controllers/    HTTP layer
├── routes/         express Router per module + routes/index.ts
├── middlewares/     auth (JWT), rbac, validate (zod), auditLog, errorHandler
├── jobs/             cron: scheduler tick (round generation, reminders, sweep)
├── utils/             ApiError, asyncHandler, jwt, datetime
├── app.ts              express app assembly
└── server.ts            entrypoint

migrations/   0001_init_schema.sql  (== docs/pdlife_schema_v3_3.sql, copied verbatim)
seed/         gen_seed.py (reads the xlsx) + seed.sql (generated)
tests/
docs/         the 4 source documents
```

## Known gaps (flagged, not silently skipped)

- **Full `appointments` CRUD** (doctor/nurse booking a visit) isn't built — the scheduler and
  dashboard only *read* appointments today. Needed before PREVISIT_7D_FORM rounds or the C1–C3
  dashboard have real data to show.
- **`clinic_assessments` / `doctor_notes`** modules (nurse intake form, doctor's note after
  visit) aren't built yet — schema and types exist, no API surface.
- **RLS is deliberately not enabled** (schema v3.3 §11 — explicit team decision for the dev
  phase with dummy data, not an oversight). App-level enforcement
  (`assertCanAccessPatient()`) is the real authorization boundary right now. Before handling
  real patient data: enable RLS following the phase order in §11, and make sure `auth_uid` is
  set on every user going forward (backfilling it later is more work).
- **PRE_NEXT_MED_MICRO dedup** — if a patient has two prescriptions whose next-dose times
  collide, the scheduler currently creates one round per prescription rather than merging them
  into one question set. Called out explicitly as unfinished in schema v3.3's own closing notes
  (`src/services/schedulerService.ts` — search `generatePreNextMedRounds`).
- A few scheduler/dashboard timing constants are **documented interpretations**, not values the
  source docs state outright (weekly check-in day-of-week, medication-log auto-skip grace
  period, late-medication threshold) — each is called out in a code comment where it's used.
# pdlife-backend
# pdlife-backend-main2
