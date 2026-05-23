# Antri

**Antri is a job search workspace for tracking applications, follow-ups, replies, and opportunities without relying on messy spreadsheets.**

Job searching is already repetitive. Tracking the job search should not feel like another job application.

## The Problem

Most people do not apply to one job at a time. They apply across LinkedIn, company websites, referrals, recruiter emails, job boards, and saved postings. Very quickly, the search becomes scattered.

For example:

- You apply to a role on Monday and forget whether you followed up.
- A recruiter replies in Gmail, but the original application is buried in a spreadsheet.
- One company rejects you, another sends an interview invite, and a third never responds.
- You save a role to apply later, but lose the link.
- You cannot remember which resume version, contact, salary range, or notes belonged to which job.

The default solution is usually a spreadsheet. Spreadsheets work, but they are not designed around the actual job-search workflow. They do not naturally surface follow-ups, response status, job links, notes, contacts, or pipeline health in a user-friendly way.

## Why This Is Worth Fixing

A job search is a pipeline. If that pipeline is disorganized, opportunities slip through the cracks.

Good tracking helps users:

- Follow up at the right time.
- Avoid applying to the same role twice.
- Understand which sources are producing responses.
- Keep recruiter notes and job details in one place.
- Reduce the mental load of remembering every application.
- Treat the search like a system instead of a pile of scattered tabs and emails.

The goal of Antri is simple: make the job hunt feel organized, calm, and manageable.

## How Antri Fixes It

Antri turns each job application into its own structured record. Instead of forcing users to manage rows in a spreadsheet, it gives them a clean workspace built around the information that matters during a job search.

Each application can track:

- Job role
- Company
- Location
- Date applied
- Heard back status
- Application status
- Priority
- Compensation
- Source
- Contact
- Job post URL
- Follow-up date
- Notes

The app also includes dashboard metrics, search, filtering, sorting, follow-up tracking, and insights so users can quickly understand where their job search stands.

## Features

- **Application tracking:** Store each job as its own entity with the details that matter.
- **Smart Add:** Paste a job link or job post and let Antri prefill fields like role, company, location, compensation, source, URL, and notes.
- **ATS adapters:** Smart Add uses public Greenhouse and Lever posting APIs before trying generic page fetching.
- **Browser saver:** A local Chrome extension captures rendered job pages that block backend URL fetching.
- **Pipeline visibility:** See total applications, active opportunities, responses, and due follow-ups.
- **Search and filters:** Quickly find roles by company, location, status, source, notes, or contact.
- **Follow-up view:** Keep upcoming and overdue next actions visible.
- **Insights:** View status distribution and source performance.
- **Import/export:** Export data as JSON or CSV and import Antri JSON files.
- **Account gate:** Requires a Supabase-authenticated account before the tracker opens.
- **Per-user cloud persistence:** Saves application cards in Supabase behind per-account Row Level Security policies.
- **Responsive UI:** Works across desktop and mobile layouts.
- **System-aware theme:** Uses a black, white, and grey palette with a cobalt accent, following the user's light/dark mode setting.

## Current Scope

This version is a dependency-free static web app built with:

- HTML
- CSS
- JavaScript
- Supabase database storage for application cards
- Supabase Auth for email and Google login entry points
- Python local backend for experimental link extraction
- OpenAI API structured extraction when `OPENAI_API_KEY` is configured
- Local heuristic parsing as a fallback
- Chrome extension prototype in `extension/`

The tracker itself is lightweight and has no frontend build step. Login and the Supabase `job_applications` table are required for application cards to sync across browsers and devices. The Phase 2 link extraction experiment requires the local Python backend because browsers cannot reliably fetch job pages directly and API keys should not be stored in frontend code.

Smart Add link extraction is currently most reliable for canonical Greenhouse and Lever posting URLs, for example:

```text
https://boards.greenhouse.io/company/jobs/1234567
https://jobs.lever.co/company/posting-id
```

Other job sites still use the generic page fetch path and may block Antri with HTTP errors such as `403` or `429`.

For LinkedIn, Indeed, Workday, and other pages that block backend URL fetching, use the browser saver extension. It captures the rendered page after you click the extension and opens Antri with a draft record.

## Run Locally

Run the local backend:

```powershell
$env:OPENAI_API_KEY="your_api_key_here"
python server.py
```

Then visit:

```text
http://127.0.0.1:4173/index.html
```

The OpenAI API key is only needed for AI extraction. Antri still serves the login UI and local fallback parsing without it.

## Configure Login

Antri uses Supabase Auth for account login. The browser calls Supabase Auth directly from local Antri code, so login does not depend on a package CDN being reachable.

1. Create a Supabase project.
2. In `auth-config.js`, set your project URL and public browser key:

   ```js
   window.ANTRI_SUPABASE_CONFIG = {
     url: "https://your-project.supabase.co",
     anonKey: "your-public-anon-or-publishable-key"
   };
   ```

3. Keep Email auth enabled in Supabase.
4. Enable the Google provider in Supabase if you want the Google login button to complete sign-in.
5. Add the local Antri URL to the allowed auth redirect URLs while developing:

   ```text
   http://127.0.0.1:4173/index.html
   ```

Do not put a Supabase service role key or any private backend secret in `auth-config.js`. It is a browser-loaded config file.

6. Open Supabase **SQL Editor**, paste the contents of `supabase/job_applications.sql`, and run it.

The SQL creates the `job_applications` table and Row Level Security policies so signed-in users can only read and write their own application rows.

If Antri finds older browser-saved cards and the signed-in account has no cloud cards yet, it offers to upload those local cards once.

## Load The Chrome Extension

1. Keep Antri available at `https://antri.xyz`.
2. For local extension testing, edit the extension URLs in `extension/popup.js` back to the local backend.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the `extension` folder inside this project.
7. Open a job posting in Chrome, click the Antri extension, and choose **Save current job**.

For the best extraction quality, the deployed backend needs `OPENAI_API_KEY` configured. Without it, the extension still opens a draft from Antri's fallback parser, but the draft will usually need more cleanup.

The browser saver works differently from Smart Add links: it reads the job page after Chrome has rendered it, sends the visible page text to the Antri backend, then opens a new Antri tab with a draft application ready to review and save.

## Future Direction

The long-term vision is for Antri to reduce manual tracking as much as possible.

Possible future improvements:

- Move Smart Add link extraction to a hosted backend or serverless function.
- Add more ATS adapters for platforms that expose usable public job data.
- Improve browser saver extraction with page-specific helpers for LinkedIn, Indeed, and Workday.
- Connect Gmail or Outlook to detect application confirmations, recruiter replies, rejections, and interview invites.
- Automatically update application status from email activity.
- Add reminders for follow-ups.
- Add richer cloud sync conflict handling and account settings.
- Support browser extension saving from job boards.
- Add AI-assisted parsing from job descriptions, emails, or screenshots.
- Introduce paid tiers for automation, sync, and advanced insights.

## Brand

The name **Antri** is inspired by ants: organized, persistent, and highly systematic. That maps naturally to the job hunt, where small actions, careful tracking, and steady follow-up can make a meaningful difference.

**Tagline:** Organize the hunt.
