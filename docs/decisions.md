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

## 2026-10-10: Preventive maintenance (Phase 2 started without waiting, per the owner's instruction)
- PM tasks come from `seed_data/pm_task_library.csv` (277 rows, CHIENGUTRG08), mapped to equipment through the PM names.
  10 names stay unmapped for the owner (boreholes, degassers by borehole, flowmeters, pressure gauges, relief valves,
  steam traps, distribution line, "General").
- Periods: daily = log day (07:00–07:00); weeks start Sunday (as the paper log); months, quarters, half-years, years by calendar.
- Codes as on paper: Done OK (√), Not done (--), Done not OK (X). "Not done" and "Done not OK" need a note;
  "Done not OK" opens a follow-up flag.
- Adherence = PMs carried out (√ or X) ÷ PMs due, for periods that have ended; "--" and blanks count as missed.
- Missed-PM flags start only from the date set in Admin → Settings → `pm_monitor_from` (off until go-live).
- Running-hours services (2,000 / 4,000 / 8,000 / 16,000 h) are shown on the task; automatic triggering from compressor
  running-hour readings is a later step.

## 2026-10-10: AMC tracker and cleaning roster
- AMC: the 4 contracts from the AMC sheet are loaded. Engineers plan visit months by tapping the month; a planned month
  that ends with no visit shows "Past due" and raises a flag. AMC completion % = planned visits done ÷ planned visits
  whose month has ended. Visits record date, vendor engineer, findings, recommendations and optional cost (NGN).
- Cleaning: Monday–Friday each cover one zone (as on the roster), 3 activities each, Done / Not done (reason required).
  A shift/section manager signs off the week, which locks it. Compliance % = Done ÷ (5 zones × 3 activities × weeks).
- 2026-10-10: the owner gave standing permission for all necessary tasks. Connector actions are allowed in
  `.claude/settings.json`. The Supabase connector still holds statements that delete rows until approved in its own
  prompt, so the two "clear demo data" functions must be pasted into the SQL Editor by the owner.

## 2026-10-12: Water quality, calibration, and "snap the HMI"
- Water quality: the CHICQARG24 plan is loaded (112 tests at 18 sampling points). Rule: outside the specification =
  "out of spec" (flag, comment required); inside but at/above the alert limit = "alert"; "< 100" means 100 is out of spec.
  21 tests have no or unclear limits and are marked "to be confirmed".
- Calibration: no instrument list was supplied, so 6 DEMO instruments show how it works. Next due = last calibration +
  interval; a flag is raised 30 days before (Admin → Settings → calibration_warn_days) and when overdue.
- Snap the HMI (owner request): the operator photographs the equipment screen; text is read **on the phone**
  (Tesseract.js, engine and English model served by the app itself — the photo is never sent to an outside AI service).
  Numbers are matched to the form's fields by label words, HMI abbreviations, unit and plausible range; matched boxes are
  highlighted "from photo — check" and the operator confirms before saving. Unclear numbers are left blank rather than
  guessed. Each reading records entry_method (manual/photo) and the photo is kept in the private "hmi-photos" bucket
  as evidence.
- Option for later (needs owner approval and costs per photo): a cloud vision AI would read difficult screens
  (seven-segment displays, glare) more reliably. It would mean sending plant photos to that provider.

## 2026-10-12: Reading slot timing and flags (owner request)
- **Missing:** a slot is flagged when nothing has been recorded **60 minutes after its time** (owner: "flagged after 1 hr").
  Setting: Admin → Settings → `reading_missing_after_min`.
- **Early entry:** each slot **opens 15 minutes before its time** (to allow for the walking round). A reading entered before the slot
  opens is saved but **flagged as an early entry** (owner: "recorded before time … should be flagged"), with who entered it and how
  many minutes early. The entry screen warns first. More than a day ahead is refused (wrong date). Setting: `reading_early_window_min`.
  Shift slots open at the start of the shift; daily slots at 07:00 of the log day.
- **Applies to every Utility 1 and 2 register** (all switched on; one can be switched off under Admin → Registers if not in use).
- **Each machine counts:** on registers that cover several machines (e.g. air compressors 2–12), every machine must be recorded;
  the flag lists the machines still missing and closes itself when the last one is entered.
- **Machines that are down are not expected:** a machine with an open downtime event at the slot time (breakdown, planned
  maintenance, idle/standby) is skipped, so operators log "standby" once in Downtime instead of getting flags every hour.
- **The reading time comes from the slot, not the phone**, and lateness/earliness are measured with the server clock.
- **Go-live cut-off:** flags start from `reading_monitor_from` (set when this was switched on), so past days are not flooded.
- Escalation e-mails list at most 30 items, then "…and N more".

## 2026-10-24/27: Owner's 14-item list, staff list, training needs
- **Downtime follow-up:** each event gets a timeline of *Containment* (temporary fix), *Further action requested*
  (needs who + target date; flagged when overdue) and *Completely resolved* (engineers/managers only, needs the end time).
- **Attended by:** tick any number of sections (six from the template plus Mechanical, Production, QA, Projects, HSE,
  Facilities/Civil) and type any other; stored as "A; B; Other: X".
- **Equipment state:** Available / Standby / Unavailable, with a reason (PM, Breakdown, CBM, External supply, Awaiting
  spares, Awaiting vendor, Low demand, Other). Logging an open downtime event sets it automatically and entering the
  end time sets it back to Available. Standby/unavailable machines raise no "missing reading" flags. New downtime type
  "Condition-Based Maintenance (CBM)".
- **Equipment list:** /equipment shows every asset with PM code, PM schedule (frequency + S/N on CHIENGUTRG08),
  make/model/capacity/specs; CSV download. PM codes and specs are typed in by the section manager (none were in the files).
- **Running hours:** 44 service intervals (2000/4000/8000/16000 h for compressors 2–12) from the PM library. Flag
  200 h before due (configurable per interval). Tracking starts once the last service hours are entered; a bigger service
  resets the smaller ones.
- **Evidence:** photos and documents (PDF, Word, Excel, PowerPoint, ≤10 MB; photos shrunk to 1600 px) in the private
  "evidence" bucket, on downtime, follow-ups, PM affirmations, training and equipment.
- **PM affirmation:** an engineer/manager signs off each frequency × area × period; counts are frozen; gaps need a note.
  Printable PM report with adherence, affirmations and every exception.
- **Staff:** the 15 people in Utility_Staff_List.xlsx are loaded (staff ID, band). An admin adds an email + role on
  Admin → Staff; when that person taps "Request access" with that email, the account is active immediately with that role.
  Names differ between files (e.g. Adeogun *Adewale* vs *Sulaimon*, Rotimi *Oluwaseun* vs *Isaac*, Enaebule vs Enabulele):
  matched by staff ID; the staff list spelling is used.
- **Training:** the FY2026 Training Needs (15 people, 11 courses, ETL Nigeria Limited, Nov–Dec 2026) are loaded.
  Engineers/managers tick Done (with date) or Not attended / Postponed / Cancelled (with a note), and attach certificates.
  A flag is raised 2 days after a planned end date that is not ticked.
- **Access control:** reading any plant data now requires an *active* account (before, a pending sign-up could read).
  Admin → Access shows the role/permission matrix, enforced in the database.

## 2026-10-27: Outage plan (app/internet down) and documents
- **Outage plan** (/outage, printable): check → tell on-duty engineer → declare outage → log on blank paper sheets
  (printed from each register) → phone critical values → end outage → back-enter within 24 h (setting
  `outage_backfill_hours`) ticking "Entered from a paper sheet" → photo of sheets attached to the outage.
- While an outage is open and for 24 h after it ends, no missing-reading flags are raised; after that, empty slots
  flag as usual. Paper readings are marked `entry_method = paper` and linked to the outage for compliance reports.
- Values typed on a phone are kept on that phone until saved, so a dropped connection loses nothing.
- **Documents (item 9):** files are stored against the equipment or instrument record with a document type
  (manual, datasheet, drawing, certificate, calibration certificate, PM checklist, service/test report). Figures are
  not read out of the files automatically (owner's choice).

## 2026-10-27: Utility consumption (7A.M Daily Utility Consumption Report)
- 93 meters from the template's sheets: 7 A.M. report (boiler gas/steam totalisers and diesel/gas hours, VAM hours and
  gas, Trane and compressor hours), water flowmeters (WTP, backwash, recovery, lines 1–10), energy meters (kWh),
  boreholes, condensate. Read once a day at 07:00; daily use = today − previous reading.
- A reading lower than the previous one is refused unless "meter reset/replaced" is ticked with a comment; a missed day
  is carried by the next reading (so monthly totals stay right). Condensate and boiler 4 kg/h are recorded as read.
- Monthly report: daily use per meter, totals, gas per steam (boilers 1, 2, 4) and lines ÷ WTP output; CSV.
- The template's handover sheet (running / standby / maintenance per equipment group) is covered by the equipment
  state toggle; a printable handover summary can be generated from it.
- To confirm with the owner: condensate unit; which compressor "Atlas Comp." is; whether compressor figures on the
  7 A.M. sheet are hours (assumed) or kWh; production and air-flow sources for kWh/m³ air, kWh/TR, water per unit product.

## 2026-10-27: Individual Engineer KPI Tracker
- The 11 KPIs and targets from Individual_Engineer_KPI_Tracker_FY2026.xlsx. Scorecard as "My Performance":
  months, quarter and YTD, ✅/❌ against target.
- **Calculated by the app** (no typing): PM completion (PM periods ending in the month in my areas carried out ÷ due),
  AMC completion (visits ÷ planned), availability on my shifts (equipment-hours − unplanned breakdown hours), and
  CW temperature / water quality / dew point compliance (readings in spec on my checked-in shifts).
  "My shift" = the shifts the engineer checked in for on the On duty page.
- **Weekly log** (as the Weekly Log sheet): GEMBA, unsafe acts, near misses, permits / non-routine jobs, leakages
  (closed within 24 h), THERMAX callouts. Entered by the engineer for themself, or by a manager.
- Quarter/YTD figures add up the counts behind each month (not an average of percentages).
- Owner confirmed (2026-10-28): "CW temp" = **cooling water** temperature (VAM cooling water inlet 30–34 °C /
  outlet 32–36 °C); PM and AMC by area is fine; **leakage comes automatically from the registers' Leak / No Leak checks**:
  one leak per first "Leak" answer on a check and machine, closed when "No Leak" is recorded within 24 h, counted for
  the engineer on duty when it was first recorded. The weekly log no longer asks for leakages.

## Open questions (awaiting owner)
- Conflicting equipment standards (14 items: see the Phase 1 plan, section 2A). Until answered,
  the Equipment Standard sheet's main-block value is loaded and marked `needs_review`.
- Equipment list reconciliation (Boiler 4 / waste-heat boiler, compressors 1 & 10, dryer 11,
  Clivet/Carrier/nitrogen counts, Utility 1 vs 2 split, asset code scheme).
- Register document numbers (keep as printed or correct), night-hour slots, late vs missing threshold.
- Email sender (M365 SMTP vs Resend), IT approval for cloud hosting, Supabase region.
- OEE definition (Phase 3).
