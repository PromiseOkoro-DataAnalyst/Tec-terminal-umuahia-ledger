# TecTerminal Umuahia Ledger

Leads, follow-ups, students, payments and monthly commission for TecTerminal Umuahia.
React + Vite, plain CSS, Supabase. Deployed on Vercel from GitHub.

## What's in it

| Page | Who | What it does |
|---|---|---|
| **Today** | everyone | This month's collections and the commission tier you're on, who to follow up today, latest payments |
| **Leads** | everyone | Board (drag between stages) or list. Each lead has WhatsApp / call buttons, follow-up date, conversation history and one-tap **Enrol** |
| **Students** | everyone | Course, enrolment date, fee, balance, last payment, full payment history, WhatsApp balance reminder |
| **Commission** | everyone | Month-by-month commission. Admins edit the tiers |
| **Analytics** | everyone | Collections over 12 months, pipeline, follow-up health, lead sources, popular courses. Admins also see each marketer |
| **Courses** | admin | Course catalogue with standard fees |
| **Team** | admin | Activate new sign-ups, pause access, make admins |
| **Activity log** | admin | Every change, recorded by the database itself |
| **My profile** | everyone | Name, WhatsApp, signature image (used on reports later) |
| **Outbox** | everyone | Every automatic and hand-sent message with its status. WhatsApp messages waiting for you have a one-tap **Send** |
| **Templates** | everyone | Editable messages with `{{first_name}}`, `{{balance}}`, `{{due_date}}`… for lead follow-ups, fee coming up, fee overdue, broadcasts |
| **Automations** | admin | Lead campaigns (repeat every N days until the lead enrols or opts out), fee reminders (before due / overdue), sending setup |
| **Broadcast** | admin | One message to chosen leads and/or students on WhatsApp, email or both, with pictures, videos or PDFs |

Every table exports to Excel. Light/dark theme, collapsible sidebar, and a phone layout with a bottom tab bar.

**Privacy is enforced by the database, not just the screen:** marketers only ever see their own leads, students and payments.

Each lead and student drawer has **Use a template** to send a filled-in message by hand. Students have a **Next payment due** date that drives fee reminders. Every email carries a “Stop receiving these messages” link (`/unsubscribe`).

Already in the database, ready for the next phase: report templates (locked once uploaded) with download logging.

## Setup (one time)

### 1. Supabase
1. Create a **new project** at supabase.com.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → **Run**. You should see "Success".
3. **Authentication → URL Configuration**: set **Site URL** to your Vercel address (use `http://localhost:5173` until it's deployed) and add both to **Redirect URLs**.
4. Sign up in the app. **The first account created becomes admin automatically**, and so do `promiseokoro210@gmail.com` and `savvionhub@gmail.com`. Everyone else waits on the Team page for you to activate them.

### 1b. Messaging tables (once, after schema.sql)
**SQL Editor → New query** → paste all of `supabase/messaging.sql` → **Run**.
This adds templates, campaigns, fee reminders, broadcasts and the outbox, plus a job that checks for due messages **every morning at 9:00**. Nothing sends until you switch a campaign or reminder on in **Automations**.

### 1c. Turn on sending
Without this step everything still works in **tap-to-send** mode: due WhatsApp messages wait in each marketer's Outbox, and they tap **Send**. To send emails (and optionally WhatsApp) automatically:

1. **Email account (free).** Sign up at **brevo.com** (300 emails/day free; you only verify your sender address) or **resend.com** (100/day free; needs your domain verified, e.g. insightlabdigitalsolutions.online). Create an API key.
2. **Deploy the function.** Supabase → **Edge Functions → Deploy a new function → Via editor**. Name it exactly `send-messages`, paste all of `supabase/functions/send-messages/index.ts`, **Deploy**. Then open the function's **Details** and turn **off** “Enforce JWT verification” (the function checks callers itself).
3. **Secrets.** Edge Functions → **Secrets** → add:
   | Name | Value |
   |---|---|
   | `EMAIL_PROVIDER` | `brevo` or `resend` |
   | `BREVO_API_KEY` or `RESEND_API_KEY` | the key from step 1 |
   | `EMAIL_FROM_ADDRESS` | the verified sender, e.g. `hello@insightlabdigitalsolutions.online` |
4. **Send every 10 minutes.** SQL Editor → New query → paste all of `supabase/sending-schedule.sql` → **Run**. It creates a private password for the job itself, so there's nothing to copy.
5. In the app: **Automations → Sending setup** → put your Vercel address in **Website address**, save, press **Check**, then send yourself a test.

**Automatic WhatsApp through a linked number (GREEN-API).** Unofficial: it links a WhatsApp number like WhatsApp Web, so use a dedicated centre number, never a personal one.
1. Run `supabase/whatsapp-gateway.sql` in the SQL Editor (once).
2. Sign up at green-api.com, create an instance, open it and **scan the QR code** with the centre's WhatsApp (Linked devices → Link a device).
3. Edge Functions → Secrets: add `GREENAPI_URL` (the instance's apiUrl), `GREENAPI_INSTANCE` (idInstance) and `GREENAPI_TOKEN` (apiTokenInstance).
4. In the app: Automations → Sending setup → WhatsApp → **Automatic (linked number)**, set the daily limit and seconds between messages, save, press **Check**.
It sends between 8:00 and 20:00 Lagos time, up to 10 messages every 10 minutes, with a pause between each. The free GREEN-API plan only allows 3 chats (enough to test); real use needs their Business plan.

**Automatic WhatsApp (optional, costs money).** Meta only lets a business start a WhatsApp chat with a pre-approved template, and charges per conversation. If you want it: set up the WhatsApp Cloud API in Meta Business, create one *Utility* template whose body is just `{{1}}`, get it approved, then add secrets `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID`, and in **Sending setup** choose **Automatic** and type the template name. Line breaks become “ · ” in that mode.

### 2. Your computer (optional, for testing)
Needs Node.js 22 or newer.
```
npm install
copy .env.example .env      (Mac/Linux: cp .env.example .env)
```
Open `.env` and paste your **Project URL** and **publishable key** (Supabase → Project Settings → API Keys). Then:
```
npm run dev
```
Open http://localhost:5173.

### 3. Vercel
1. Push this folder to a GitHub repo.
2. vercel.com → **Add New → Project** → import the repo (Vite is detected automatically).
3. **Environment Variables**: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Deploy. Every push to `main` redeploys automatically.

### 4. Branding
- Put your logo at `public/logo.png`. It replaces the "T" mark everywhere.
- Brand colours are at the top of `src/styles.css` (`--red`, `--purple`).
- Sign-in photos are in `src/lib/photos.js` (Lagos photos by Ninthgrid on Unsplash). To use your own, put the image in `public/` and change the path.

## Never put in the browser
Only the **publishable** key goes in `.env` or Vercel. The secret / service-role key must never be in this code.
