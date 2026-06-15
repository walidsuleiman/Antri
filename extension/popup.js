const ANTRI_ORIGINS = ["https://antri.xyz"];
// Root works on both deployments: the app is served there directly, and the
// marketing page redirects a "?draft=" link to /app.html.
const APP_PATH = "/";

const saveButton = document.getElementById("saveButton");
const actionButton = document.getElementById("actionButton");
const status = document.getElementById("status");

saveButton.addEventListener("click", saveCurrentJob);
init();

async function init() {
  const token = await getStoredToken();
  if (token) {
    resetActions();
    setStatus("Open a job page, then save it to Antri.", false);
  } else {
    showSignedOut();
  }
}

async function getStoredToken() {
  try {
    const { antriSession } = await chrome.storage.local.get("antriSession");
    if (!antriSession || !antriSession.access_token) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (antriSession.expires_at && Number(antriSession.expires_at) <= now) {
      return null; // expired — a fresh visit to Antri refreshes it
    }
    return antriSession.access_token;
  } catch (error) {
    return null;
  }
}

async function saveCurrentJob() {
  setStatus("Reading this page…", true);

  try {
    const token = await getStoredToken();
    if (!token) {
      showSignedOut();
      return;
    }

    const tab = await getActiveTab();
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
      throw new Error("Open a normal job page first.");
    }

    const [capture] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureVisibleJobPage
    });
    const page = capture?.result;
    if (!page?.text || page.text.length < 40) {
      throw new Error("This page didn't expose enough readable job text.");
    }

    setStatus("Extracting with Antri…", true);
    const { response, origin } = await extractWithAvailableAntri(page, token);

    if (response.status === 401) {
      showSignedOut();
      return;
    }
    if (response.status === 402) {
      showProRequired(origin);
      return;
    }

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Antri could not extract this page.");
    }

    const draft = encodeDraft(payload.job || {});
    await openAntriDraft(origin, draft);
    setStatus(`${payload.method === "ai" ? "AI draft" : "Draft"} opened in Antri.`, false);
  } catch (error) {
    setStatus(error.message || "Could not save this job.", false);
  }
}

async function extractWithAvailableAntri(page, token) {
  const body = JSON.stringify({
    url: page.url,
    pageTitle: page.title,
    pageText: page.text
  });

  for (const origin of ANTRI_ORIGINS) {
    try {
      const response = await fetch(`${origin}/api/extract-page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body
      });
      return { response, origin };
    } catch {
      // Try the next deployed Antri origin.
    }
  }

  throw new Error("Could not reach Antri. Try again after the website is available.");
}

async function openAntriDraft(origin, draft) {
  const draftUrl = `${origin}${APP_PATH}?draft=${encodeURIComponent(draft)}`;
  const existingTabs = await chrome.tabs.query({ url: `${origin}/*` });
  const existingTab = existingTabs.find((tab) => tab.id && tab.windowId);

  if (!existingTab) {
    await chrome.tabs.create({ url: draftUrl });
    return;
  }

  await chrome.tabs.update(existingTab.id, { url: draftUrl, active: true });
  await chrome.windows.update(existingTab.windowId, { focused: true });
}

function captureVisibleJobPage() {
  const meta = (selector) => document.querySelector(selector)?.content?.trim() || "";
  const heading = document.querySelector("h1");
  const headerText = [
    heading?.parentElement?.parentElement?.innerText,
    heading?.closest("article, section, main")?.innerText
  ]
    .map((value) => value?.trim() || "")
    .find((value) => value.length >= 40) || "";
  const importantText = [
    readSiteHints(),
    readStructuredJobPostings(),
    headerText ? `Visible job header:\n${headerText.slice(0, 3500)}` : "",
    document.title,
    meta('meta[property="og:title"]'),
    meta('meta[name="description"]'),
    ...Array.from(document.querySelectorAll("h1, h2"))
      .slice(0, 12)
      .map((heading) => heading.innerText?.trim())
      .filter(Boolean),
    document.body?.innerText || ""
  ].filter(Boolean).join("\n\n");

  return {
    url: location.href,
    title: document.title,
    text: importantText.slice(0, 45000)
  };

  function readStructuredJobPostings() {
    return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .flatMap((script) => {
        try {
          return findJobPostings(JSON.parse(script.textContent || ""));
        } catch {
          return [];
        }
      })
      .slice(0, 3)
      .map((posting) => {
        const title = firstText(posting.title, posting.name);
        const company = organizationName(posting.hiringOrganization);
        const locationLabel = jobPostingLocation(posting);
        const compensation = jobPostingCompensation(posting);
        return [
          "Structured JobPosting data:",
          title ? `Job title: ${title}` : "",
          company ? `Company: ${company}` : "",
          locationLabel ? `Location: ${locationLabel}` : "",
          compensation ? `Compensation: ${compensation}` : ""
        ].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
  }

  function readSiteHints() {
    if (!location.hostname.toLowerCase().includes("amazon.jobs")) {
      return "";
    }

    const header = heading?.parentElement?.innerText || "";
    const company = header.match(/\bJob ID:\s*[^|\n]+\|\s*([^\n]+)/i)?.[1]?.trim() || "";
    const amazonLocation = document.querySelector(".association.location-icon .association-content li")?.innerText?.trim() || "";
    return [
      "Page-specific job details:",
      company ? `Company: ${company}` : "",
      amazonLocation ? `Location: ${amazonLocation}` : ""
    ].filter(Boolean).join("\n");
  }

  function findJobPostings(value) {
    if (Array.isArray(value)) {
      return value.flatMap((item) => findJobPostings(item));
    }
    if (!value || typeof value !== "object") {
      return [];
    }

    const types = toList(value["@type"]).map((type) => String(type).toLowerCase());
    const postings = types.includes("jobposting") ? [value] : [];
    return postings.concat(findJobPostings(value["@graph"] || value.graph || []));
  }

  function jobPostingLocation(posting) {
    const values = [];
    const locationType = toList(posting.jobLocationType).join(" ").toLowerCase();
    if (locationType.includes("telecommute") || locationType.includes("remote")) {
      values.push("Remote");
    }
    toList(posting.jobLocation).forEach((value) => values.push(...locationValues(value)));
    toList(posting.applicantLocationRequirements).forEach((value) => values.push(...locationValues(value)));
    return uniqueText(values).join(" - ");
  }

  function jobPostingCompensation(posting) {
    return uniqueText(toList(posting.baseSalary).flatMap((salary) => salaryValues(salary))).join("; ");
  }

  function salaryValues(value) {
    if (typeof value === "string") {
      return [value.trim()];
    }
    if (!value || typeof value !== "object") {
      return [];
    }

    const currency = firstText(value.currency, value.salaryCurrency);
    const amount = value.value && typeof value.value === "object" ? value.value : value;
    const minValue = amount.minValue != null ? formatPayNumber(amount.minValue) : "";
    const maxValue = amount.maxValue != null ? formatPayNumber(amount.maxValue) : "";
    const singleValue = amount.value != null ? formatPayNumber(amount.value) : "";
    const unit = firstText(amount.unitText, amount.unit);

    let label = "";
    if (minValue && maxValue) {
      label = `${currency} ${minValue} - ${maxValue}`.trim();
    } else if (singleValue) {
      label = `${currency} ${singleValue}`.trim();
    }
    return label ? [`${label}${unit ? ` per ${unit.toLowerCase()}` : ""}`] : [];
  }

  function formatPayNumber(value) {
    const number = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(number)) {
      return String(value).trim();
    }
    return number.toLocaleString(undefined, { maximumFractionDigits: Number.isInteger(number) ? 0 : 2 });
  }

  function locationValues(value) {
    if (typeof value === "string") {
      return [value.trim()];
    }
    if (!value || typeof value !== "object") {
      return [];
    }
    if (typeof value.address === "string") {
      return [value.address.trim()];
    }
    if (value.address && typeof value.address === "object") {
      const address = [
        firstText(value.address.addressLocality),
        firstText(value.address.addressRegion),
        firstText(value.address.addressCountry)
      ].filter(Boolean).join(", ");
      if (address) {
        return [address];
      }
    }
    const name = firstText(value.name, value.description);
    return name ? [name] : [];
  }

  function organizationName(value) {
    if (typeof value === "string") {
      return value.trim();
    }
    if (!value || typeof value !== "object") {
      return "";
    }
    return firstText(value.name, value.legalName);
  }

  function uniqueText(values) {
    const seen = new Set();
    return values
      .map((value) => firstText(value))
      .filter((value) => {
        const marker = value.toLowerCase();
        if (!value || seen.has(marker)) {
          return false;
        }
        seen.add(marker);
        return true;
      });
  }

  function firstText(...values) {
    return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
  }

  function toList(value) {
    if (value == null) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function encodeDraft(job) {
  const bytes = new TextEncoder().encode(JSON.stringify(job));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function setStatus(message, loading) {
  status.textContent = message;
  saveButton.disabled = loading;
}

function showSignedOut() {
  setStatus("Sign in to Antri to save jobs with the extension.", false);
  showAction("Open Antri to sign in", ANTRI_ORIGINS[0] + APP_PATH);
}

function showProRequired(origin) {
  setStatus("The browser saver is part of Antri Pro.", false);
  showAction("Start your 3-day free trial", (origin || ANTRI_ORIGINS[0]) + APP_PATH);
}

function showAction(label, url) {
  actionButton.textContent = label;
  actionButton.onclick = function () { chrome.tabs.create({ url: url }); };
  actionButton.hidden = false;
  saveButton.hidden = true;
}

function resetActions() {
  actionButton.hidden = true;
  saveButton.hidden = false;
}
