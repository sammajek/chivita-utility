# CHI Utility Ops

Web app for the Utility section, Engineering Department, CHI Limited (Chivita | Hollandia).
It replaces paper registers and Excel trackers with timestamped, person-tagged records, automatic flags and
escalations, maintenance KPIs and reports. The full brief is in [`CLAUDE.md`](CLAUDE.md); owner decisions are
logged in [`docs/decisions.md`](docs/decisions.md).

## Status

| Phase 1 step | What | State |
|---|---|---|
| 1a | Foundation: app shell, login, request-access sign-up, roles, audit trail | done |
| 1b | Master data (93 assets, 251 parameters, 28 registers) and admin screens | done |
| 1c | Register entry forms with in-spec/out-of-spec checks, corrections with reason, day sheet/print, trends + CSV | done |
| 1d | On-duty check-in/out with handover, flags every 5 min, escalation ladder, daily digest | done (emails queue until a provider is approved) |
| 1e | Downtime (603-001 lists) and RCA, MTTR/MTBF/availability, dashboard | done |

Phase 2 has started: **Preventive maintenance** is done (277 tasks from the PM register).

The test database holds **DEMO** data (14 days of readings, downtime, RCAs), labelled DEMO on every screen.

## Screens

| Page | Who | What |
|---|---|---|
| Dashboard `/` | everyone | Compliance, open flags, who is on duty, KPIs per equipment, downtime Pareto and trend |
| Registers `/registers` | everyone (entry: operators and up) | One form per paper register; day sheet for printing; trends and CSV |
| On duty `/duty` | everyone | Check in/out by shift and area; handover note on check-out |
| Flags `/flags` | everyone | Missing readings, out-of-spec values, no check-in, ageing downtime, overdue RCAs |
| Downtime `/downtime` | operators and up | Downtime log; RCA required automatically at ≥ 4 h or ≥ 3 repeats |
| RCA `/rca` | engineers and up | 5-Whys, 6M, actions, cost, effectiveness check |
| PM `/pm` | everyone (entry: operators and up) | CHIENGUTRG08 PM log: tick √ / -- / X per task and period; schedule (last done, next due) and adherence % |
| Admin `/admin` | managers and admin | Users and roles, items to review, equipment, limits, register monitoring, settings |

## Email alerts

Escalations and the 07:00 digest are written to the `notifications` table. They are sent by the
`supabase/functions/notify` edge function once an email provider is approved and its secrets are set
(see the comments at the top of that file). Until then they stay `queued` and can be seen in the database.

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
npm test            # unit tests (shift/time logic, slots, KPI formulas with worked examples)
npm run db:test     # applies all migrations to a throwaway local Postgres and runs SQL tests
```

## Seed data

`python3 scripts/build_seed.py` turns `seed_data/` and the source workbooks into
`seed_data/master_data.json`, `supabase/seed/10_master_data.sql` and `docs/owner_review.json`
(the list of items for the owner to confirm).
