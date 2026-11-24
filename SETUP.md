# CSE WALE: final setup guide

You have all the keys. Follow these steps in order. Each step says how to know it worked.

## Two ways to run it (do not mix them up)
- `npm run dev` = **preview with fake data**. It shows a red "PREVIEW MODE" bar, "Google login" signs in as a fake person, and "Buy" shows a "pretend the payment succeeded" box. Nothing is real.
- `npm run live` = **the real site** with your Supabase, Google login and Razorpay keys. No red bar, real Google account, real Razorpay window. Use this one for everything you want to test for real.

## 0. Put your keys in one file
1. Unzip the project, open the folder in VS Code.
2. Copy `.env.example` to a new file named `.env.local` and fill every line with your real values.
   (You can leave the `# notes` after a value; they are ignored.)
3. In the VS Code terminal run: `npm run check`
   It tests every key and setting and tells you exactly what is wrong ("table not found", "you pasted the anon key in the service key", "Google login is OFF", and so on). Fix what it lists, run it again, until it says **No problems found**.

## Where to find the Supabase keys
Ignore the **Connect** button and its options (Framework, Direct connection, MCP, ORM). You do not need them.
Open your project, click the **gear icon (Project Settings)** at the bottom of the left menu, then **API Keys**.
- **Project URL** is shown on that page (or under Data API) → `SUPABASE_URL`.
- Public key → `SUPABASE_ANON_KEY`. It is called **anon** (Legacy tab) or **Publishable key** (`sb_publishable_…`).
- Secret key → `SUPABASE_SERVICE_KEY`. It is called **service_role** (Legacy tab) or **Secret key** (`sb_secret_…`). Keep it private.
Either style works. Do not mix them up: public goes in ANON, secret goes in SERVICE.

## 1. Supabase (once)
1. SQL Editor → New query → paste all of `supabase/schema.sql` → Run.
2. Authentication → Providers → **Email**: ON, **"Confirm email" OFF** (the free email limit would block 200 sign-ups).
3. Authentication → Providers → **Google**: ON, with your Google Client ID and Secret. In Google Cloud Console the "Authorized redirect URI" is the Callback URL that Supabase shows you.
4. Authentication → URL Configuration: **Site URL** = your real site address. Under **Redirect URLs** add your site address **and** `http://localhost:3000` (for testing on your computer).

## 2. Try the REAL site on your computer
Run `npm run live` and open http://localhost:3000. This uses your real Supabase and Razorpay (use Razorpay **test** keys while testing).
1. Log in with your admin email (Google or email). Open http://localhost:3000/admin.html.
2. **Add tests** tab → choose `seed/mock-test-1.json` → set the opening time → **Schedule all**.
3. In a private window sign up as a student, pay with a Razorpay test payment, take the test, check the result, then look at the admin Overview, Students and Payments tabs.

## 3. Put it online (Vercel)
1. Put the folder in a GitHub repository → Vercel → Add New → Project → import it (Framework "Other", leave build settings empty).
2. Settings → Environment Variables: add every line from `.env.local` (same names and values).
3. Redeploy. Open your site address. If login says "missing settings: …", that variable is not set in Vercel.
4. Razorpay Dashboard → Webhooks → add `https://YOUR-SITE/api/webhook`, events **payment.captured** and **order.paid**, the same secret as `RAZORPAY_WEBHOOK_SECRET`.
5. Going live with real money: after Razorpay KYC, replace the keys with `rzp_live_…`, redo the webhook in live mode, redeploy, make one real ₹99 payment yourself, then share the link.

## Admin page (your site address + /admin.html)
Only emails in `ADMIN_EMAILS` can open it. Log in on the main site first.
- **Overview**: students, paid students, revenue, conversion, tests running right now, 14-day charts. Refreshes every 30 seconds.
- **Students**: every student with mobile, joined date, payment, and each test score. Search, filter, download CSV.
- **Tests**: publish or hide, change open and close times, and **Details** for each test: average, median, highest, score distribution, subject accuracy, 10 hardest questions, top 20, leaderboard CSV.
- **Payments**: every successful payment with Razorpay id, and people who opened checkout but did not pay.
- **Add tests**: choose several question files at once, set the first opening time and "a new test every N days". Each one opens by itself on its date.

## Adding Mock Test 2, 3, 4 …
Send me each PDF. I convert it into a questions file (same format as `seed/mock-test-1.json`). Upload all the files together in **Add tests** and set the interval.

## Things to know
- **Vercel Hobby (free) is for non-commercial use.** Because you charge money, Vercel requires the **Pro** plan (about $20/month). Supabase free tier is enough for 200 students.
- Correct answers and solutions never reach a student's browser until they submit. The timer is kept by the server. The first attempt is ranked; practice attempts are not. Ties go to the lower time.
- Not included: coupon codes, refunds (use the Razorpay dashboard), a one-device-per-account lock, automatic PDF reading.
- Automatic tests: `npm test` (49 backend checks incl. 200 simultaneous students and more than 1000 students). `npm run dev` is a no-keys preview with a fake database.
