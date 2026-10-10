# Decisions log

Choices made by the product owner (Utility section engineer/manager), newest last.
Each entry: date, decision, who decided, notes.

## 2026-10-09: Phase 1 plan approved
- **Decision:** Proceed with Phase 1 (foundation, master data, parameter logging, duty register,
  flags/escalation, downtime & RCA, MTTR/MTBF/availability, basic dashboard) in five steps (1a–1e).
- **Stack:** Next.js (App Router, TypeScript, Tailwind) on Vercel; Supabase (Postgres, Auth, RLS, pg_cron).
  Email first; WhatsApp behind an interface until Phase 3.
- **Decided by:** owner (plan approval).

## 2026-10-09: Accounts and hosting
- **Supabase:** a new organisation, **"CHI Engineering"** (free plan), so it can serve other engineering sections later.
  Its existing empty project **"Engineering Data Capturing"** (eu-west-1, Ireland) is used as the **test/dev database**.
  The second free project slot is kept for production.
- **Vercel:** Hobby (free) for testing only; company use needs Pro.
- **Connectors** use samtonmajek13@gmail.com until samuel.majekodunmi@chilimited.com is ready. Both addresses are
  bootstrap admins (they become active admins on first sign-in).
- **Decided by:** owner.

## 2026-10-09: Build without stopping
- **Decision:** the owner asked for the whole of Phase 1 to be built without pausing for approval at each step;
  adjustments come after review.
- **Consequences:** where a choice was needed it was made conservatively and is listed below for review.

## 2026-10-09: Choices made during the build (review these)
- **Limits:** where sources conflict, the Equipment Standard sheet's main-block value is used and marked
  "needs review" (Admin → To review).
- **Log day:** 07:00 to 07:00 (Lagos), matching the shifts. Readings at 00:00–06:59 belong to the previous log day.
- **Missing vs late:** a slot is flagged missing 120 min after it is due (`reading_missing_after_min`, Admin → Settings).
- **Monitoring:** only registers switched on under Admin → Registers raise missing-reading flags, so flags start
  only when a register is actually in use.
- **New accounts:** people use "Request access" on the sign-in page; the account stays inactive (no plant data)
  until an admin sets the role and activates it.
- **Charts:** drawn without an extra chart library, to keep pages light on slow networks.
- **Email:** escalations and digests are queued, not sent, until the owner approves a provider (plant data would go
  to that provider). The sender is ready for Resend; M365 SMTP can be added.
- **Demo data:** generated in the test database and flagged `is_demo`; users cannot create demo rows.

## Open questions (awaiting owner)
- Conflicting equipment standards (14 items: see the Phase 1 plan, section 2A). Until answered,
  the Equipment Standard sheet's main-block value is loaded and marked `needs_review`.
- Equipment list reconciliation (Boiler 4 / waste-heat boiler, compressors 1 & 10, dryer 11,
  Clivet/Carrier/nitrogen counts, Utility 1 vs 2 split, asset code scheme).
- Register document numbers (keep as printed or correct), night-hour slots, late vs missing threshold.
- Email sender (M365 SMTP vs Resend), IT approval for cloud hosting, Supabase region.
- OEE definition (Phase 3).
