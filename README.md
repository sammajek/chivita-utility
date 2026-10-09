# CHI Utility Ops

Web app for the Utility section, Engineering Department, CHI Limited (Chivita | Hollandia).
It replaces paper registers and Excel trackers with timestamped, person-tagged records, automatic flags and
escalations, maintenance KPIs and reports. The full brief is in [`CLAUDE.md`](CLAUDE.md); owner decisions are
logged in [`docs/decisions.md`](docs/decisions.md).

## Status

| Phase 1 step | What | State |
|---|---|---|
| 1a | Foundation: app shell, login, roles, audit trail | done |
| 1b | Master data & seed import, admin screens | next |
| 1c | Parameter logging forms with validation | |
| 1d | Duty register, flags & escalation (email) | |
| 1e | Downtime & RCA, MTTR/MTBF/availability, dashboard | |

## How it is built

- **Next.js** (TypeScript, Tailwind) for the screens, hosted on **Vercel**.
- **Supabase** for the database (Postgres), logins and scheduled jobs. Database changes live in
  `supabase/migrations/` and are applied in order.
- Every record stores who entered it (person or logger) and the **server** time. Changes to submitted records
  need a reason and are written to `audit_log`; records are voided, never deleted.

## Running it locally

```bash
npm install
cp .env.example .env.local     # then paste the Supabase URL and anon key
npm run dev                    # http://localhost:3000
```

Without Supabase keys the app shows a "Database not connected yet" page.

## Checks

```bash
npm run lint        # code style
npm run typecheck   # TypeScript
npm test            # unit tests (shift/time logic, later KPI formulas)
npm run db:test     # applies all migrations to a throwaway local Postgres and runs SQL tests
```
