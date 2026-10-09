# CHI Utility Ops — project brief

Web app for the **Utility section, Engineering Department, CHI Limited (Chivita | Hollandia)**, Lagos.
It replaces paper registers and Excel trackers with digital, timestamped, person-tagged records,
automatic flags and escalations, maintenance KPIs, and downloadable presentations.

The product owner is the Utility section engineer/manager. They are not a software developer:
explain decisions in plain language, keep the app simple to run, and ask before anything that
costs money, touches production data, or can't be undone.

## Ground rules

- **Every record is tagged** to either a named person (logged-in user) or a named logger/device.
  Store `recorded_by_type` (`person` | `logger`), `recorded_by_id`, `recorded_at` (server time),
  and `reading_for` (the slot the reading belongs to). Never trust a client clock for `recorded_at`.
- **Audit trail**: submitted records are never silently edited or deleted. Every change writes
  who / when / old value / new value / reason to an audit table. Deletion = void with reason.
- **One master asset register**: every record references an asset code. Equipment is named
  differently across the source files (e.g. "Boiler 1 (LOOS)" vs "STEAM BOILER 1"); build an
  alias table mapping register names to asset codes and ask the owner to confirm ambiguous ones.
- **Logo on every page**: `public/chivita-logo.png` (200×51, transparent). Use it in the app header,
  login page, printed/PDF reports and every generated slide.
- **Time zone**: Africa/Lagos (UTC+1), 24/7 plant. Shifts: Day 07:00–19:00, Night 19:00–07:00
  (from the downtime template). Some registers use "Morning/Night Shift" — treat as the same two shifts.
- **Mobile-first**: operators enter readings on phones/tablets on the plant floor. Large tap targets,
  numeric keypads for numbers, works on slow networks. Offline entry with later sync is phase 3.
- Plant data is company data. Do not send it to any third-party service without the owner's OK.

## Suggested stack (confirm with owner before scaffolding)

- Next.js (App Router, TypeScript) + Tailwind, deployed on **Vercel**.
- **Supabase**: Postgres, Auth (email login; roles), Row Level Security, Storage, Edge Functions,
  `pg_cron` for the scheduled flag/escalation job.
- Charts: Recharts or ECharts. Presentations: **PptxGenJS** (server-side) for .pptx, plus PDF export.
- Email: Microsoft 365 SMTP or Resend. WhatsApp: WhatsApp Business Platform (Meta Cloud API or
  Twilio) — needs a business number, Meta verification and pre-approved templates; build behind an
  interface with email as the working fallback until WhatsApp is approved. SMS optional fallback.
- The owner's Claude account has Supabase and Vercel connectors. Use a **separate dev Supabase
  project/branch**; never run destructive SQL against production.

## Roles

`operator`, `engineer`, `shift_manager`, `section_manager`, `admin`, `viewer` (e.g. management).
Operators enter readings/PM/downtime; engineers also approve, close downtime, run RCA; managers see
everything, approve, configure; admin manages users, assets, parameters, limits.
Names, roles, shifts, staff IDs, phone/WhatsApp numbers and areas (Utility 1 / 2) will be provided
by the owner — build a user import (CSV) and an admin screen. `source_files/JOB_REQUEST_INVENTORY.xlsx`
sheet "Sheet1" lists some staff names with system-access info (useful starter list, not authoritative).

## Modules

### 1. Master data (admin)
Assets (code, name, category, area Utility 1/2, make, model, capacity, rated output, criticality,
aliases), parameter dictionary (per asset type: name, unit, data type number/select/text, standard
min/max, critical min/max, reading frequency & slots), PM task library, AMC contracts, loggers,
users, duty roster. Seed from `seed_data/` (see below).

### 2. Equipment parameter logging (replaces paper registers)
- One digital form per register, reproducing the paper register's parameters and reading slots
  (`seed_data/register_layouts.json` + `source_files/REGISTERS_UTILITY_1.xlsx`, `..._2.xlsx`).
  Reading frequencies vary: hourly, 2-hourly, 3-hourly, 6-hourly (03/09/15/21), per shift,
  daily high/low. Keep the document numbers (CHIENGUTRG01–11 etc.) on forms and printouts.
- Each value validated against its standard on entry: in spec / out of spec / critical. Out-of-spec
  requires a comment or action. Select-type checks (No Leak/Leak, Working/Not Working, Clean/Not
  Clean, Functional/Not Functional) are first-class fields.
- Logger import API: authenticated endpoint (API key per logger) accepting batched readings
  `{asset_code, parameter, value, timestamp}`; CSV upload as fallback.
- Trends: per parameter with standard band shaded, multi-parameter overlay, period selector,
  export CSV/Excel.

### 3. Utility consumption
Generation & distribution of water, steam, compressed air, chilled water, nitrogen; diesel, natural
gas/LPFO and kWh per equipment. **The owner will supply the consumption template — wait for it
before building this module's forms.** Plan for meter readings (cumulative totaliser → delta),
specific consumption KPIs (kWh/m³ air, gas per tonne steam, kWh/TR, water per unit product),
and optional cost per unit.

### 4. Downtime & RCA (digitise `603-001 Utility Downtime Analysis Template`)
Same fields, lists and logic as the template (`seed_data/downtime_master_lists.json`):
event (date, shift, category, equipment, downtime type, failure category, failure mode, issue
description, start/end incl. multi-day, override hours with reason, action, spares, attended by,
production impact, status, remarks). RCA required automatically when downtime ≥ 4 h or repeats ≥ 3
(configurable). RCA register with 5-Whys, 6M category, corrective/preventive actions, CAPEX,
cost (NGN), owner, target date, effectiveness verification.

### 5. Maintenance KPIs
MTTR, MTBF, MTTF, Availability, OEE — per asset, category, area, period, shift.
- **MTBF must be per equipment using operating hours** (from logged running hours where available),
  not total calendar equipment-hours across the fleet (the Excel template's dashboard does the
  latter and shows ~315,000 h). Document the formula in the UI.
- MTTF for non-repairable items/components; MTTR from unplanned breakdown events.
- Availability = (scheduled time − unplanned downtime) / scheduled time; show planned vs unplanned.
- Utility OEE (proposed; confirm with owner): Availability × Performance (actual output ÷ rated
  capacity, e.g. t/h steam, m³/min air, TR) × Quality (% readings in spec).

### 6. Preventive maintenance
PM schedule from `seed_data/pm_task_library.csv` (277 task rows: daily/weekly/monthly/quarterly/
bi-annual/annual, document CHIENGUTRG08) and the "Equipment PM" last/next-date sheets. Completion
codes as on paper: Done OK (√), Not Done (--), Done Not OK — "Done Not OK" opens a follow-up.
Calendar-based and running-hours-based triggers (e.g. compressor 4,000 h service). PM adherence %.
Also: AMC tracker (Planned / Done / Past Due per month), cleaning roster (weekly Done/Not Done with
manager sign-off), job requests/POs and item orders (from `JOB_REQUEST_INVENTORY.xlsx`), instrument
calibration due dates, process water micro sampling plan with alert/action limits
(`seed_data/water_analysis_plan_raw.json`).

### 7. On-duty register, flags, escalation, compliance
- **Duty check-in/out**: engineer/manager taps "On duty", picks shift and area (Utility 1, 2, both).
  Duty roster loaded so the system knows who should be on. No check-in within 30 min of shift start
  → alert section manager. Optional QR scan in control room to prove presence.
- **Flags** raised by a scheduled job every 5–15 min: reading due, overdue, missing; out-of-spec /
  critical value; PM due/overdue; AMC past due; RCA overdue; calibration due; open downtime aging.
- **Escalation ladder** (all thresholds configurable):
  due → in-app reminder to assigned operator; +15 min → WhatsApp + email to on-duty engineer;
  +45 min or critical value → shift manager; end of shift → listed in handover;
  daily 07:00 → compliance digest to section manager. Critical alarms are immediate.
  Batch multiple overdue items into one message per recipient per interval (avoid alert fatigue).
- **Check-out requires handover note** and acknowledgement of open flags.
- **Non-compliance monitoring** per person / shift / register: missed and late entries (and how late),
  out-of-spec without action, PM not done, late/missing check-ins, post-submission edits.
  Compliance % feeds the engineer KPIs and reports.
- Notification log table: every message sent, channel, recipient, status, acknowledgement.

### 8. Engineer KPI tracker
Digitise `Individual_Engineer_KPI_Tracker_FY2026.xlsx` (11 KPIs with targets in
`seed_data/engineer_kpis.json`). Auto-calculate everything the app already knows (PM completion %,
AMC completion %, availability on my shift, reading compliance %, water quality / dew point / CW temp
compliance); keep manual weekly entry only for GEMBA, unsafe acts, permits, near misses, THERMAX.

### 9. Presentation generator
Reports page: choose a template (weekly utility review, monthly management report, downtime & RCA,
PM & AMC compliance, energy & consumption, engineer performance) or build a custom deck by ticking
sections; set scope (dates, area, category/assets, shift, person); generate **.pptx** (and PDF).
Every slide: logo, title, data period and "generated at" timestamp; charts traceable to source data.
Commentary box per slide before download. Saved custom templates. Scheduled decks (e.g. Monday 07:00,
emailed). **The owner is sourcing a corporate PowerPoint template — build a clean, placeholder layout
in Chivita colours first, and design the generator so the master layout can be swapped.**

### 10. Dashboards
Section overview (today's compliance, open flags, who's on duty, equipment status), downtime
dashboard (Pareto, trend, KPIs, filters like the Excel dashboard), PM/AMC, consumption, trends.

## Seed data (`seed_data/`) — extracted from the source spreadsheets

| File | Contents | Caveats |
|---|---|---|
| `downtime_master_lists.json` | 72 assets by 13 categories, failure modes by 8 categories, issue descriptions, shifts, downtime types, attended by, impact, status, 6M, action types, RCA status, RCA triggers | Asset list is from the downtime template only; Utility 2 registers mention more (Clivet/Carrier chillers, 2 t/h boiler, waste-heat boiler, nitrogen generators, IR MH75 compressor, IR TMS dryer). Reconcile into the master register. |
| `pm_task_library.csv` | 277 rows: frequency, register S/N, equipment name as written, tasks (pipe-separated) | Equipment names need mapping to asset codes. |
| `equipment_standards.csv` | 86 parameter standards with parsed min/max | 9 rows have no limit given (`needs_review=yes`). The source sheet also has a second, misaligned block (columns M–N) and per-equipment blocks not fully parsed — check `source_files/REGISTERS_UTILITY_1.xlsx` sheet "Utility Equipment Standard". Some parameters have different standards in different places (e.g. Feed Water Tank Level 90–95% vs 80–90%; Flame Signal >90 vs 90–95%) — list conflicts for the owner to decide. |
| `register_layouts.json` | 25 register sheets (Utility 1 & 2): document no., title, reading time slots, shift entries, raw header rows | Raw headers — build the parameter list per form from these plus the source workbook. |
| `amc_contracts.json` | 4 AMC contracts with monthly status | |
| `engineer_kpis.json` | 11 KPIs, category, target | |
| `water_analysis_plan_raw.json` | Process water micro sampling plan rows | Raw; structure it. |

Original files are in `source_files/`. Re-read them whenever the seed data is ambiguous.

## Build phases

1. **Foundation + logging + flags**: repo, Supabase schema with RLS and audit trail, auth & roles,
   master data import, parameter logging forms with validation, duty register, flag/escalation job
   with email (WhatsApp behind an interface), downtime & RCA, MTTR/MTBF/availability, basic dashboard.
2. **Maintenance & reporting**: PM scheduling & adherence, AMC, job requests, cleaning roster,
   calibration, consumption module (after template arrives), engineer KPIs, presentation generator.
3. **Integration & resilience**: logger API, WhatsApp go-live, offline entry/sync, QR codes on
   assets, scheduled reports, OEE.

## Working agreements

- Start each phase in Plan mode; get the owner's approval before writing code.
- Write tests for KPI formulas (MTTR/MTBF/availability/compliance %) with worked examples.
- Keep a `docs/decisions.md` log of choices the owner made.
- Seed a demo dataset so screens can be reviewed before real data exists; label it clearly as demo.

## Open items from the owner

- Names list (role, shift, area, staff ID, email, WhatsApp number).
- Utility consumption template.
- Logger details (energy meters, flowmeters, SCADA/THERMAX): what exists, how data is exported.
- Corporate PowerPoint template.
- Confirmation of the OEE definition and of conflicting standards.
- IT approval for cloud hosting and a WhatsApp Business number.
