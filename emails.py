#!/usr/bin/env python3
"""Antri — transactional email sequences.

Sends three lifecycle emails, each at most once per user:
  1. welcome        — within ~hours of signup
  2. trial_start    — when a Stripe subscription enters 'trialing'
  3. trial_reminder — ~2 days before a trial ends

Run on a schedule (e.g. every 4–6 hours via a Render Cron Job):

    python emails.py

Dry-run mode: if SMTP_HOST is not set, emails are built and logged but not
sent — safe to run without a mail provider configured.

Requires email_log.sql to be run in the Supabase SQL Editor first.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required)
  ANTRI_APP_URL      default https://antri.xyz
  DIGEST_FROM        default "Antri <hello@antri.xyz>"
  SMTP_HOST          Postmark: smtp.postmarkapp.com
  SMTP_PORT          default 587 (use 465 for SSL)
  SMTP_USER          Postmark server API token
  SMTP_PASS          Postmark server API token (same value as SMTP_USER)
"""
import json
import os
import smtplib
import ssl
import sys
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from html import escape
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
APP_URL = os.environ.get("ANTRI_APP_URL", "https://antri.xyz").rstrip("/")
DIGEST_FROM = os.environ.get("DIGEST_FROM", "Antri <hello@antri.xyz>")

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def _service_headers():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def service_rpc(function_name, params=None):
    body = json.dumps(params or {}).encode("utf-8")
    request = Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{function_name}",
        data=body,
        headers=_service_headers(),
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else []


def service_post(path, body, prefer=""):
    headers = _service_headers()
    if prefer:
        headers["Prefer"] = prefer
    request = Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else None


def log_email_sent(user_id, email_type):
    """Record a sent email. The unique index prevents duplicate rows."""
    try:
        service_post(
            "email_log",
            [{"user_id": user_id, "type": email_type}],
            prefer="resolution=ignore-duplicates",
        )
    except (HTTPError, URLError, ValueError) as error:
        print(f"log: could not record {email_type} for {user_id}: {error}")


# ---------------------------------------------------------------------------
# Email transport
# ---------------------------------------------------------------------------

def send_message(to_email, subject, html, text):
    msg = EmailMessage()
    from_name, from_addr = parseaddr(DIGEST_FROM)
    msg["From"] = formataddr((from_name or "Antri", from_addr or "hello@antri.xyz"))
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    if not SMTP_HOST:
        print(f"  [dry-run] '{subject}' → {to_email}")
        return

    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ssl.create_default_context(), timeout=30) as server:
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.starttls(context=ssl.create_default_context())
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
    print(f"  sent '{subject}' → {to_email}")


def fmt_date(iso_string):
    """'2026-06-19T...' → 'June 19'"""
    try:
        dt = datetime.fromisoformat(iso_string.replace("Z", "+00:00"))
        return f"{dt.strftime('%B')} {dt.day}"
    except (TypeError, ValueError, AttributeError):
        return "soon"


# ---------------------------------------------------------------------------
# Shared HTML wrapper — matches digest.py dark theme
# ---------------------------------------------------------------------------

def _html_email(headline, subline, body_rows_html, cta_label, cta_url, footnote=""):
    footnote_block = (
        f'<tr><td style="padding:8px 24px 20px;">'
        f'<div style="font-size:13px;color:#69707e;font-style:italic;line-height:1.5;'
        f'border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;">{escape(footnote)}</div>'
        f'</td></tr>'
    ) if footnote else ""

    return f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#05060a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05060a;padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="max-width:520px;background:#0e1119;border:1px solid rgba(255,255,255,0.09);
             border-radius:18px;overflow:hidden;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
      <tr><td style="padding:24px 24px 4px;">
        <div style="font-size:18px;font-weight:700;color:#f4f7fb;letter-spacing:-0.02em;">
          Antri <span style="color:#60a5fa;">&bull;</span>
        </div>
      </td></tr>
      <tr><td style="padding:14px 24px 0;">
        <div style="font-size:22px;font-weight:650;color:#f4f7fb;letter-spacing:-0.02em;">{headline}</div>
        <div style="font-size:14px;color:#8c95a6;margin-top:8px;line-height:1.5;">{subline}</div>
      </td></tr>
      <tr><td style="padding:18px 24px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="border:1px solid rgba(255,255,255,0.09);border-radius:12px;overflow:hidden;">
          {body_rows_html}
        </table>
      </td></tr>
      <tr><td style="padding:20px 24px 8px;" align="center">
        <a href="{cta_url}"
          style="display:inline-block;background:#3b82f6;color:#04060c;font-size:15px;
                 font-weight:600;text-decoration:none;padding:12px 26px;border-radius:999px;">
          {escape(cta_label)}
        </a>
      </td></tr>
      {footnote_block}
      <tr><td style="padding:0 24px 24px;">
        <div style="font-size:11px;color:#69707e;line-height:1.5;">
          You're receiving this because you have an Antri account.
          <a href="{APP_URL}/" style="color:#8c95a6;">Open Antri</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>'''


def _row(title, body, border=True):
    border_style = "border-bottom:1px solid rgba(255,255,255,0.08);" if border else ""
    return (
        f'<tr><td style="padding:16px 18px;{border_style}">'
        f'<div style="font-size:14px;color:#f4f7fb;font-weight:600;">{title}</div>'
        f'<div style="font-size:13px;color:#8c95a6;margin-top:4px;line-height:1.5;">{body}</div>'
        f'</td></tr>'
    )


# ---------------------------------------------------------------------------
# 1. Welcome email
# ---------------------------------------------------------------------------

def build_welcome(to_email):
    subject = "Your Antri workspace is ready"
    rows = (
        _row("Track every application in one place",
             "Role, company, status, follow-up date, recruiter notes — one structured record per job.")
        + _row("Smart Add turns any job link into a draft",
               "Paste a URL and Antri prefills role, company, location, and compensation automatically. Included in your free trial.")
        + _row("Never miss a follow-up",
               "Set a follow-up date on any card. Antri surfaces what's overdue and sends you a weekly digest.",
               border=False)
    )
    html = _html_email(
        headline="Your job search workspace is ready.",
        subline="Antri keeps every application, follow-up, and recruiter note in one place — so nothing slips through the cracks.",
        body_rows_html=rows,
        cta_label="Open Antri",
        cta_url=f"{APP_URL}/",
        footnote="The free plan covers 50 applications. Upgrade to Pro anytime for unlimited tracking, Smart Add, and the browser extension.",
    )
    text = f"""Welcome to Antri!

Your job search workspace is ready.

What you can do:
- Track every application in one place (role, company, status, follow-up, notes)
- Smart Add: paste a job link → Antri fills in the details automatically (part of your trial)
- Never miss a follow-up: set dates per card and get a weekly digest

Open the app: {APP_URL}/

The free plan covers 50 applications. Upgrade to Pro anytime for unlimited tracking, Smart Add, and the browser extension.

— The Antri team
"""
    return subject, html, text


def send_welcome_emails():
    print("welcome:")
    try:
        users = service_rpc("users_pending_welcome", {"hours": 48}) or []
    except (HTTPError, URLError, ValueError) as error:
        print(f"  could not fetch pending users: {error}")
        return 0
    sent = 0
    for row in users:
        email = row.get("user_email")
        user_id = row.get("user_id")
        if not email or not user_id:
            continue
        subject, html, text = build_welcome(email)
        try:
            send_message(email, subject, html, text)
            log_email_sent(user_id, "welcome")
            sent += 1
        except (smtplib.SMTPException, OSError) as error:
            print(f"  failed for {email}: {error}")
    if not users:
        print("  no new users to welcome.")
    return sent


# ---------------------------------------------------------------------------
# 2. Trial start confirmation
# ---------------------------------------------------------------------------

def build_trial_start(to_email, period_end):
    end_str = fmt_date(period_end)
    subject = "Your Antri Pro trial has started"
    rows = (
        f'<tr><td style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.08);">'
        f'<div style="font-size:13px;color:#8c95a6;margin-bottom:4px;">Trial ends</div>'
        f'<div style="font-size:15px;color:#f4f7fb;font-weight:700;">{escape(end_str)}</div>'
        f'</td></tr>'
        + _row("&#10003;&nbsp; Unlimited applications",
               "Track as many roles as you need. The free plan caps at 50.")
        + _row("&#10003;&nbsp; Smart Add — paste a link, get a draft",
               "Role, company, location, compensation — extracted automatically from any job URL.")
        + _row("&#10003;&nbsp; The browser extension",
               "Save jobs from LinkedIn, Workday, or any job page in one click.",
               border=False)
    )
    html = _html_email(
        headline="Your Antri Pro trial has started.",
        subline=f"Everything is unlocked until {escape(end_str)}. Cancel anytime before then — no charge.",
        body_rows_html=rows,
        cta_label="Open Antri",
        cta_url=f"{APP_URL}/",
        footnote=f"After the trial, Pro continues at $9.99/month. Cancel anytime in the account menu before {escape(end_str)} to avoid the charge.",
    )
    text = f"""Your Antri Pro trial has started.

Pro is active until {end_str}. Here's what's unlocked:
- Unlimited applications (free plan caps at 50)
- Smart Add — paste a job link and get a filled draft
- The browser extension — save jobs from any page

Open the app: {APP_URL}/

After the trial, Pro continues at $9.99/month. Cancel anytime in the account menu before {end_str} to avoid the charge.

— The Antri team
"""
    return subject, html, text


def send_trial_start_emails():
    print("trial_start:")
    try:
        rows = service_rpc("subscriptions_pending_trial_start") or []
    except (HTTPError, URLError, ValueError) as error:
        print(f"  could not fetch pending subscriptions: {error}")
        return 0
    sent = 0
    for row in rows:
        email = row.get("user_email")
        user_id = row.get("user_id")
        if not email or not user_id:
            continue
        subject, html, text = build_trial_start(email, row.get("period_end"))
        try:
            send_message(email, subject, html, text)
            log_email_sent(user_id, "trial_start")
            sent += 1
        except (smtplib.SMTPException, OSError) as error:
            print(f"  failed for {email}: {error}")
    if not rows:
        print("  no new trials to confirm.")
    return sent


# ---------------------------------------------------------------------------
# 3. Trial expiry reminder
# ---------------------------------------------------------------------------

def build_trial_reminder(to_email, period_end):
    end_str = fmt_date(period_end)
    subject = "Your Antri Pro trial ends soon"
    rows = (
        f'<tr><td style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.08);">'
        f'<div style="font-size:13px;color:#8c95a6;margin-bottom:4px;">Trial ends</div>'
        f'<div style="font-size:16px;color:#f87171;font-weight:700;">{escape(end_str)}</div>'
        f'</td></tr>'
        + _row("What happens after the trial",
               "Smart Add, the browser extension, and unlimited applications become Pro-only. Your existing cards are never deleted or removed.")
        + _row("Keep Pro for $9.99/month",
               "Cancel anytime — no lock-in. Manage your plan in the account menu.",
               border=False)
    )
    html = _html_email(
        headline=f"Your Pro trial ends on {escape(end_str)}.",
        subline="Keep Smart Add, the browser extension, and unlimited tracking — or cancel before then. No charge either way.",
        body_rows_html=rows,
        cta_label="Manage plan",
        cta_url=f"{APP_URL}/",
    )
    text = f"""Your Antri Pro trial ends on {end_str}.

After that:
- Smart Add and the browser extension become Pro-only
- New applications are capped at 50 (your existing cards are never deleted)

To keep Pro: $9.99/month, cancel anytime, no lock-in.
Manage your plan in the account menu: {APP_URL}/

— The Antri team
"""
    return subject, html, text


def send_trial_reminder_emails():
    print("trial_reminder:")
    try:
        rows = service_rpc("subscriptions_pending_trial_reminder", {"reminder_days": 2}) or []
    except (HTTPError, URLError, ValueError) as error:
        print(f"  could not fetch expiring trials: {error}")
        return 0
    sent = 0
    for row in rows:
        email = row.get("user_email")
        user_id = row.get("user_id")
        if not email or not user_id:
            continue
        subject, html, text = build_trial_reminder(email, row.get("period_end"))
        try:
            send_message(email, subject, html, text)
            log_email_sent(user_id, "trial_reminder")
            sent += 1
        except (smtplib.SMTPException, OSError) as error:
            print(f"  failed for {email}: {error}")
    if not rows:
        print("  no expiring trials to remind.")
    return sent


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        print("emails: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Nothing sent.")
        return 1

    if not SMTP_HOST:
        print("emails: SMTP not configured — running as DRY RUN (no email sent).\n")

    send_welcome_emails()
    send_trial_start_emails()
    send_trial_reminder_emails()
    return 0


if __name__ == "__main__":
    sys.exit(main())
