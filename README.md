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
- **Pipeline visibility:** See total applications, active opportunities, responses, and due follow-ups.
- **Search and filters:** Quickly find roles by company, location, status, source, notes, or contact.
- **Follow-up view:** Keep upcoming and overdue next actions visible.
- **Insights:** View status distribution and source performance.
- **Import/export:** Export data as JSON or CSV and import Antri JSON files.
- **Local persistence:** Saves data in the browser with `localStorage`.
- **Responsive UI:** Works across desktop and mobile layouts.
- **System-aware theme:** Uses a black, white, and grey palette with a cobalt accent, following the user's light/dark mode setting.

## Current Scope

This version is a dependency-free static web app built with:

- HTML
- CSS
- JavaScript
- Browser `localStorage`
- Python local backend for experimental link extraction
- OpenAI API structured extraction when `OPENAI_API_KEY` is configured
- Local heuristic parsing as a fallback

The tracker itself is lightweight and can run without a database, login system, or build step. The Phase 2 link extraction experiment requires the local Python backend because browsers cannot reliably fetch job pages directly and API keys should not be stored in frontend code.

## Run Locally

For basic static tracking, open `index.html` directly in a browser.

For Smart Add link extraction, set your OpenAI API key and run the local backend:

```powershell
$env:OPENAI_API_KEY="your_api_key_here"
python server.py
```

Then visit:

```text
http://127.0.0.1:4173/index.html
```

## Future Direction

The long-term vision is for Antri to reduce manual tracking as much as possible.

Possible future improvements:

- Move Smart Add link extraction to a hosted backend or serverless function.
- Connect Gmail or Outlook to detect application confirmations, recruiter replies, rejections, and interview invites.
- Automatically update application status from email activity.
- Add reminders for follow-ups.
- Add user accounts and cloud sync.
- Support browser extension saving from job boards.
- Add AI-assisted parsing from job descriptions, emails, or screenshots.
- Introduce paid tiers for automation, sync, and advanced insights.

## Brand

The name **Antri** is inspired by ants: organized, persistent, and highly systematic. That maps naturally to the job hunt, where small actions, careful tracking, and steady follow-up can make a meaningful difference.

**Tagline:** Organize the hunt.
