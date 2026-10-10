# Bringing CHI Utility Ops online (about 10 minutes)

The database (Supabase, project "Engineering Data Capturing") is already set up with all tables and demo data.
What is missing is the website itself. It is hosted on **Vercel** and builds automatically from GitHub.

## 1. Create the Vercel project
1. Open **https://vercel.com/new** and sign in (samtonmajek13@gmail.com, or "Continue with GitHub").
2. Under *Import Git Repository*, find **sammajek/chivita-utility** and click **Import**.
   If it is not listed, click *Adjust GitHub App Permissions* and allow the repository.
3. Project name: `chi-utility-ops`. Framework: Next.js (detected automatically). Leave build settings as they are.
4. Open **Environment Variables** and add these two (they are public keys, safe for the browser):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://ylefyyegekehismtsrmd.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_Lij2gAx9bYWM4sXNcxnJVA_VXBTeeoV` |

5. Click **Deploy**. After 2–3 minutes you get an address like `https://chi-utility-ops.vercel.app`.

Every later push to the branch `claude/new-session-6dbz73` redeploys the site automatically.

## 2. Tell Supabase the site address (so sign-in and e-mail links work)
1. Open **https://supabase.com/dashboard** → project **Engineering Data Capturing**.
2. **Authentication → URL Configuration**:
   - *Site URL*: your Vercel address, e.g. `https://chi-utility-ops.vercel.app`
   - *Redirect URLs*: add `https://chi-utility-ops.vercel.app/**`
3. Save.

## 3. First sign-in
- Open the site, sign in with **samtonmajek13@gmail.com** and the temporary password you were given, then change it
  (Supabase → Authentication → Users, or "forgot password" once e-mail is set up).
- Demo logins (operator, engineer, shift manager, section manager, viewer) let you see each role's screens.
- Staff use **Request access** on the sign-in page; activate them under **Admin → Users** and give each a role.

## 4. Before real use
- Vercel **Hobby** (free) is for testing only; company use needs **Vercel Pro** (~US$20/month per member).
- Supabase free projects pause after 7 days without use; live use needs **Supabase Pro** (~US$25/month).
- Remove demo data: paste `supabase/migrations/20261009000012_clear_demo.sql` and
  `20261010000016_clear_pm_demo.sql` into Supabase → SQL Editor → Run, then run
  `select public.clear_demo_data(); select public.clear_pm_demo();`
- Switch on monitoring: Admin → Registers (missing-reading flags) and Admin → Settings → `pm_monitor_from` (PM flags).
- E-mail alerts: choose a sender (Microsoft 365 mailbox or Resend) — see `supabase/functions/notify/index.ts`.
