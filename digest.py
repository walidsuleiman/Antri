#!/usr/bin/env python3
"""Antri — weekly follow-up digest.

Emails each user a short, sleek summary of the follow-ups that are overdue or
coming up, so applications don't slip through the cracks.

Run it on a schedule (e.g. a weekly Render Cron Job):

    python digest.py

It is provider-agnostic: it sends over SMTP using the env vars below, which
works with Resend, SendGrid, Mailgun, Postmark, Gmail, etc. If SMTP isn't
configured it runs as a DRY RUN — it builds and logs the emails without sending,
so you can wire a provider in later without touching code.

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required to read data)
  ANTRI_APP_URL            default https://antri.xyz
  DIGEST_WINDOW_DAYS       default 7   (how far ahead to look)
  DIGEST_FROM              default "Antri <hello@antri.xyz>"
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS   (omit to dry-run)
"""
import os
import json
import random
import smtplib
import ssl
import sys
from datetime import datetime, timezone, date, timedelta
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from html import escape
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
APP_URL = os.environ.get("ANTRI_APP_URL", "https://antri.xyz").rstrip("/")
WINDOW_DAYS = int(os.environ.get("DIGEST_WINDOW_DAYS", "7"))
DIGEST_FROM = os.environ.get("DIGEST_FROM", "Antri <hello@antri.xyz>")

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")

CLOSED_STATUSES = ("Rejected", "Withdrawn")

# A light joke to close out the email — picked at random.
JOKES = [
    "Following up is like watering a plant — ignore it and it quietly dies. 🌱",
    "\"We'll be in touch\" is the recruiter version of \"let's grab coffee sometime.\" A nudge helps.",
    "Your applications won't follow up on themselves. We checked — they're a little lazy.",
    "Statistically, the best time to follow up was yesterday. The second best time is now.",
    "A polite nudge has never once made things worse. (Results may vary, but probably not.)",
    "Inbox silence isn't a no — it's a maybe wearing a disguise. Go say hi.",
]


# --------------------------------------------------------------------------
# Supabase (service role) helpers
# --------------------------------------------------------------------------
def service_get(path):
    request = Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def get_user_email(user_id):
    request = Request(
        f"{SUPABASE_URL}/auth/v1/admin/users/{quote(user_id)}",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
            return data.get("email")
    except (HTTPError, URLError, ValueError):
        return None


def due_followups():
    """Return rows whose follow-up is overdue or within the window, grouped by user."""
    today = datetime.now(timezone.utc).date()
    cutoff = (today + timedelta(days=WINDOW_DAYS)).isoformat()
    statuses = ",".join(CLOSED_STATUSES)
    path = (
        "job_applications"
        "?select=user_id,role,company,status,follow_up"
        f"&follow_up=not.is.null&follow_up=lte.{cutoff}"
        f"&status=not.in.({statuses})"
        "&order=follow_up.asc"
    )
    rows = service_get(path)
    grouped = {}
    for row in rows or []:
        grouped.setdefault(row["user_id"], []).append(row)
    return grouped, today


# --------------------------------------------------------------------------
# Email building
# --------------------------------------------------------------------------
def humanize_due(follow_up, today):
    try:
        d = date.fromisoformat(follow_up)
    except (TypeError, ValueError):
        return "Scheduled", False
    if d < today:
        days = (today - d).days
        return (f"Overdue by {days} day{'s' if days != 1 else ''}", True)
    if d == today:
        return ("Due today", True)
    days = (d - today).days
    return (f"Due in {days} day{'s' if days != 1 else ''}", False)


def build_message(to_email, items, today):
    count = len(items)
    subject = f"Your Antri follow-ups this week ({count})"
    joke = random.choice(JOKES)

    rows_html = []
    rows_text = []
    for item in items:
        label, urgent = humanize_due(item.get("follow_up"), today)
        role = item.get("role") or "Untitled role"
        company = item.get("company") or ""
        status = item.get("status") or ""
        pill_color = "#f87171" if urgent else "#60a5fa"
        rows_html.append(
            f'''<tr><td style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08);">
              <div style="font-size:15px;font-weight:600;color:#f4f7fb;">{escape(role)}</div>
              <div style="font-size:13px;color:#8c95a6;margin-top:3px;">{escape(company)} &middot; {escape(status)}</div>
            </td>
            <td style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08);text-align:right;white-space:nowrap;">
              <span style="font-size:12px;font-weight:600;color:{pill_color};">{escape(label)}</span>
            </td></tr>'''
        )
        rows_text.append(f"- {role} @ {company} ({status}) — {label}")

    html = f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#05060a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05060a;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0e1119;border:1px solid rgba(255,255,255,0.09);border-radius:18px;overflow:hidden;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
          <tr><td style="padding:24px 24px 4px;">
            <div style="font-size:18px;font-weight:700;color:#f4f7fb;letter-spacing:-0.02em;">Antri <span style="color:#60a5fa;">&bull;</span> <span style="font-weight:500;color:#8c95a6;font-size:14px;">Weekly follow-ups</span></div>
          </td></tr>
          <tr><td style="padding:14px 24px 0;">
            <div style="font-size:22px;font-weight:650;color:#f4f7fb;letter-spacing:-0.02em;">You have {count} follow-up{'s' if count != 1 else ''} to chase.</div>
            <div style="font-size:14px;color:#8c95a6;margin-top:8px;line-height:1.5;">A quick nudge at the right time is how opportunities stay alive. Here's what's overdue or coming up:</div>
          </td></tr>
          <tr><td style="padding:18px 24px 4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(255,255,255,0.09);border-radius:12px;overflow:hidden;">
              {''.join(rows_html)}
            </table>
          </td></tr>
          <tr><td style="padding:20px 24px 8px;" align="center">
            <a href="{APP_URL}/app.html" style="display:inline-block;background:#3b82f6;color:#04060c;font-size:15px;font-weight:600;text-decoration:none;padding:12px 26px;border-radius:999px;">Open Antri</a>
          </td></tr>
          <tr><td style="padding:8px 24px 20px;">
            <div style="font-size:13px;color:#69707e;font-style:italic;line-height:1.5;border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;">{escape(joke)}</div>
          </td></tr>
          <tr><td style="padding:0 24px 24px;">
            <div style="font-size:11px;color:#69707e;line-height:1.5;">You're receiving this because you have follow-ups tracked in Antri. Manage email preferences in your <a href="{APP_URL}/app.html" style="color:#8c95a6;">account</a>.</div>
          </td></tr>
        </table>
      </td></tr>
    </table></body></html>'''

    text = (
        f"You have {count} follow-up(s) to chase this week:\n\n"
        + "\n".join(rows_text)
        + f"\n\nOpen Antri: {APP_URL}/app.html\n\n{joke}\n"
    )
    return subject, html, text


def send_message(to_email, subject, html, text):
    msg = EmailMessage()
    from_name, from_addr = parseaddr(DIGEST_FROM)
    msg["From"] = formataddr((from_name or "Antri", from_addr or "hello@antri.xyz"))
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    if not SMTP_HOST:
        print(f"[dry-run] would send to {to_email}: \"{subject}\"")
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
    print(f"sent to {to_email}: \"{subject}\"")


def main():
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        print("digest: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Nothing sent.")
        return 0
    if not SMTP_HOST:
        print("digest: SMTP not configured — running as DRY RUN (no email sent).")

    grouped, today = due_followups()
    if not grouped:
        print("digest: no follow-ups due in the window. Nothing to send.")
        return 0

    sent = 0
    for user_id, items in grouped.items():
        email = get_user_email(user_id)
        if not email:
            print(f"digest: skipping {user_id} (no email found).")
            continue
        subject, html, text = build_message(email, items, today)
        try:
            send_message(email, subject, html, text)
            sent += 1
        except (smtplib.SMTPException, OSError) as error:
            print(f"digest: failed to send to {email}: {error}")

    print(f"digest: processed {len(grouped)} user(s), {sent} email(s) handled.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
