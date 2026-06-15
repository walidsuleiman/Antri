# Antri Job Saver Chrome Web Store Copy

## Listing

### Name

Antri Job Saver

### Short description

Save the job posting you are viewing into Antri as a draft application record.

### Detailed description

Antri Job Saver turns the job posting you are viewing into a draft inside Antri.

When you click Save current job, the extension reads visible job-posting details from the active page you selected, sends that page data to Antri for extraction, and opens a draft application record for your review.

Use it to reduce manual copy and paste while tracking job roles, companies, locations, job links, notes, statuses, and follow-ups in Antri.

If Antri is already open, the extension reuses that tab instead of opening duplicate Antri tabs.

The extension only runs when you click it on the page you want to save. It is designed for job-posting capture and does not automatically scan your browsing activity.

## Visibility

Choose `Unlisted` for family-and-friends beta distribution.

## Privacy Policy URL

Use:

```text
https://antri.xyz/privacy.html
```

## Single Purpose

Create an Antri job application draft from the job posting the user is actively viewing and chooses to save.

## Permission Justifications

### `activeTab`

Needed to access the current job-posting tab only after the user clicks Save current job.

### `scripting`

Needed to read visible job-posting text and structured job posting data from the active page the user selected.

### `tabs`

Needed to identify the active tab and open the resulting draft in Antri.

### `storage`

Needed to remember the user's signed-in Antri session token (read on antri.xyz) so the extension can authenticate extraction requests to the user's own Antri Pro account.

### Host permissions

`https://antri.xyz/*` is needed to send the selected job-posting data to Antri's extraction endpoint, read the signed-in session on antri.xyz, and open the resulting draft in the Antri web app.

### Content script on `https://antri.xyz/*`

A small content script runs only on antri.xyz to read the user's own signed-in session token from the page and store it for the extension, so extraction requests can be authenticated against the user's Antri Pro subscription. It does not run on, read, or modify any other site.

## Data Disclosure Notes

The extension may transmit the selected job page URL, page title, visible job-page text, and structured job posting details after the user clicks Save current job. It also sends the user's own signed-in Antri session token to authenticate the request against their account.

That data is used to extract fields for an Antri draft application record. Job-posting text may be processed by Antri's AI extraction provider when AI extraction is enabled. The user reviews the draft before saving it into their Antri account.

The extension does not automatically scan browsing activity, sell extension page data, or use extension page data for advertising.

## Reviewer Notes

1. Sign in to Antri at https://antri.xyz with an active Antri Pro subscription (the browser saver is a Pro feature).
2. Open a public job posting page.
3. Click the Antri Job Saver toolbar action, then Save current job.
4. The extension captures the selected job page and opens a draft inside Antri, reusing an existing Antri tab when one is already open.
5. If not signed in or not on Pro, the popup links you to Antri to sign in or start a free trial instead.
6. Review the draft before saving.

## Submission Assets Still Needed In Dashboard

- At least one screenshot for the store listing.
- The Chrome Web Store small promotional tile requested by the dashboard.
