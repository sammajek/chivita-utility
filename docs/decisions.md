# Decisions log

Choices made by the product owner (Utility section engineer/manager), newest last.
Each entry: date, decision, who decided, notes.

## 2026-10-09: Phase 1 plan approved
- **Decision:** Proceed with Phase 1 (foundation, master data, parameter logging, duty register,
  flags/escalation, downtime & RCA, MTTR/MTBF/availability, basic dashboard) in five steps (1a–1e).
- **Stack:** Next.js (App Router, TypeScript, Tailwind) on Vercel; Supabase (Postgres, Auth, RLS, pg_cron).
  Email first; WhatsApp behind an interface until Phase 3.
- **Decided by:** owner (plan approval).

## Open questions (awaiting owner)
- Conflicting equipment standards (14 items: see the Phase 1 plan, section 2A). Until answered,
  the Equipment Standard sheet's main-block value is loaded and marked `needs_review`.
- Equipment list reconciliation (Boiler 4 / waste-heat boiler, compressors 1 & 10, dryer 11,
  Clivet/Carrier/nitrogen counts, Utility 1 vs 2 split, asset code scheme).
- Register document numbers (keep as printed or correct), night-hour slots, late vs missing threshold.
- Email sender (M365 SMTP vs Resend), IT approval for cloud hosting, Supabase region.
- OEE definition (Phase 3).
