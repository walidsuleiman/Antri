const ANTRI_SUPABASE_CONFIG = window.ANTRI_SUPABASE_CONFIG || {};

const STORAGE_KEY = "antri.applications.v1";
const USER_STORAGE_PREFIX = `${STORAGE_KEY}.user`;
const LEGACY_STORAGE_KEY = "jobflow.applications.v1";
const CLOUD_MIGRATION_PREFIX = `${STORAGE_KEY}.cloud-migrated`;
const PENDING_DRAFT_KEY = `${STORAGE_KEY}.pending-draft`;
const CLOUD_TABLE = "job_applications";
const CLOUD_COLUMNS = [
  "id",
  "role",
  "company",
  "location",
  "date_applied",
  "heard_back",
  "status",
  "priority",
  "compensation",
  "source",
  "contact",
  "url",
  "follow_up",
  "notes",
  "created_at",
  "updated_at"
].join(",");

const statuses = [
  "Saved",
  "Applied",
  "Follow-up",
  "Interviewing",
  "Offer",
  "Rejected",
  "Withdrawn"
];

let jobs = [];
let currentView = "pipeline";
let activeSourceFilter = "all";
let currentUser = null;
let currentSession = null;
let authClient = null;
let authMode = "login";
let isPro = false;
const FREE_APP_CAP = 50;

const elements = {
  authGate: document.getElementById("authGate"),
  appShell: document.getElementById("appShell"),
  authForm: document.getElementById("authForm"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  authSubmitButton: document.getElementById("authSubmitButton"),
  authStatus: document.getElementById("authStatus"),
  authModeButtons: [...document.querySelectorAll("[data-auth-mode]")],
  googleAuthButton: document.getElementById("googleAuthButton"),
  syncStatus: document.getElementById("syncStatus"),
  accountMenu: document.getElementById("accountMenu"),
  accountMenuButton: document.getElementById("accountMenuButton"),
  accountDropdown: document.getElementById("accountDropdown"),
  signOutButton: document.getElementById("signOutButton"),
  accountEmail: document.getElementById("accountEmail"),
  views: {
    pipeline: document.getElementById("pipelineView"),
    board: document.getElementById("boardView"),
    followups: document.getElementById("followupsView"),
    insights: document.getElementById("insightsView"),
    integrations: document.getElementById("integrationsView")
  },
  kanban: document.getElementById("kanban"),
  navItems: [...document.querySelectorAll(".nav-item")],
  totalApplications: document.getElementById("totalApplications"),
  activeApplications: document.getElementById("activeApplications"),
  heardBackCount: document.getElementById("heardBackCount"),
  followUpCount: document.getElementById("followUpCount"),
  searchInput: document.getElementById("searchInput"),
  statusFilter: document.getElementById("statusFilter"),
  sortSelect: document.getElementById("sortSelect"),
  sourceFilters: document.getElementById("sourceFilters"),
  resultCount: document.getElementById("resultCount"),
  jobList: document.getElementById("jobList"),
  emptyState: document.getElementById("emptyState"),
  followupList: document.getElementById("followupList"),
  statusChart: document.getElementById("statusChart"),
  sourceChart: document.getElementById("sourceChart"),
  openFormButton: document.getElementById("openFormButton"),
  closeDrawerButton: document.getElementById("closeDrawerButton"),
  cancelButton: document.getElementById("cancelButton"),
  drawer: document.getElementById("jobDrawer"),
  drawerBackdrop: document.getElementById("drawerBackdrop"),
  form: document.getElementById("jobForm"),
  drawerTitle: document.getElementById("drawerTitle"),
  deleteButton: document.getElementById("deleteButton"),
  exportButton: document.getElementById("exportButton"),
  importButton: document.getElementById("importButton"),
  importFile: document.getElementById("importFile"),
  csvButton: document.getElementById("csvButton"),
  smartUrlInput: document.getElementById("smartUrlInput"),
  smartTextInput: document.getElementById("smartTextInput"),
  extractTextButton: document.getElementById("extractTextButton"),
  extractUrlButton: document.getElementById("extractUrlButton"),
  clearSmartButton: document.getElementById("clearSmartButton"),
  smartResult: document.getElementById("smartResult"),
  smartAdd: document.getElementById("smartAdd"),
  smartLock: document.getElementById("smartLock"),
  smartLockUpgrade: document.getElementById("smartLockUpgrade"),
  planPill: document.getElementById("planPill"),
  accountPlan: document.getElementById("accountPlan"),
  planActionButton: document.getElementById("planActionButton"),
  upgradeBackdrop: document.getElementById("upgradeBackdrop"),
  upgradeModal: document.getElementById("upgradeModal"),
  upgradeClose: document.getElementById("upgradeClose"),
  upgradeReason: document.getElementById("upgradeReason"),
  upgradeCheckout: document.getElementById("upgradeCheckout"),
  upgradeStatus: document.getElementById("upgradeStatus"),
  deleteAccountButton: document.getElementById("deleteAccountButton"),
  confirmBackdrop: document.getElementById("confirmBackdrop"),
  deleteModal: document.getElementById("deleteModal"),
  deleteCancelButton: document.getElementById("deleteCancelButton"),
  deleteConfirmInput: document.getElementById("deleteConfirmInput"),
  deleteConfirmButton: document.getElementById("deleteConfirmButton"),
  deleteStatus: document.getElementById("deleteStatus"),
  template: document.getElementById("jobCardTemplate")
};

const fields = {
  id: document.getElementById("jobId"),
  role: document.getElementById("roleInput"),
  company: document.getElementById("companyInput"),
  location: document.getElementById("locationInput"),
  dateApplied: document.getElementById("dateAppliedInput"),
  status: document.getElementById("statusInput"),
  heardBack: document.getElementById("heardBackInput"),
  priority: document.getElementById("priorityInput"),
  compensation: document.getElementById("compensationInput"),
  source: document.getElementById("sourceInput"),
  contact: document.getElementById("contactInput"),
  url: document.getElementById("urlInput"),
  followUp: document.getElementById("followUpInput"),
  notes: document.getElementById("notesInput")
};

function parseStoredJobs(stored) {
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(normalizeJob) : [];
  } catch {
    return [];
  }
}

function localJobsForCloudMigration(user) {
  const userJobs = parseStoredJobs(localStorage.getItem(userStorageKey(user.id)));
  if (userJobs.length) {
    return userJobs;
  }

  return parseStoredJobs(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
}

async function init() {
  populateStatusOptions();
  bindEvents();
  setAuthMode("login");
  rememberDraftFromUrl();
  await initializeAuth();
}

function populateStatusOptions() {
  statuses.forEach((status) => {
    elements.statusFilter.append(new Option(status, status));
    fields.status.append(new Option(status, status));
  });
}

function bindEvents() {
  elements.authForm.addEventListener("submit", submitEmailAuth);
  elements.authModeButtons.forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });
  elements.googleAuthButton.addEventListener("click", () => startOAuth("google"));
  elements.accountMenuButton.addEventListener("click", toggleAccountMenu);
  elements.signOutButton.addEventListener("click", signOut);

  elements.navItems.forEach((item) => {
    item.addEventListener("click", () => switchView(item.dataset.view));
  });

  elements.searchInput.addEventListener("input", renderJobs);
  elements.statusFilter.addEventListener("change", renderJobs);
  elements.sortSelect.addEventListener("change", renderJobs);
  elements.openFormButton.addEventListener("click", () => openDrawer());
  elements.closeDrawerButton.addEventListener("click", closeDrawer);
  elements.cancelButton.addEventListener("click", closeDrawer);
  elements.drawerBackdrop.addEventListener("click", closeDrawer);
  elements.form.addEventListener("submit", saveForm);
  elements.deleteButton.addEventListener("click", deleteCurrentJob);
  elements.exportButton.addEventListener("click", exportJson);
  elements.importButton.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", importJson);
  elements.csvButton.addEventListener("click", exportCsv);
  elements.extractTextButton.addEventListener("click", extractSmartDetails);
  elements.extractUrlButton.addEventListener("click", extractSmartUrl);
  elements.clearSmartButton.addEventListener("click", clearSmartAdd);

  elements.smartLockUpgrade.addEventListener("click", () => openUpgradeModal("smartadd"));
  elements.planActionButton.addEventListener("click", () => {
    if (isPro) {
      manageSubscription();
    } else {
      openUpgradeModal("plan");
    }
  });
  elements.planPill.addEventListener("click", () => {
    if (!isPro) openUpgradeModal("plan");
  });
  elements.upgradeClose.addEventListener("click", closeUpgradeModal);
  elements.upgradeBackdrop.addEventListener("click", closeUpgradeModal);
  elements.upgradeCheckout.addEventListener("click", startCheckout);

  elements.deleteAccountButton.addEventListener("click", openDeleteModal);
  elements.deleteCancelButton.addEventListener("click", closeDeleteModal);
  elements.confirmBackdrop.addEventListener("click", closeDeleteModal);
  elements.deleteConfirmInput.addEventListener("input", () => {
    elements.deleteConfirmButton.disabled = elements.deleteConfirmInput.value.trim().toUpperCase() !== "DELETE";
  });
  elements.deleteConfirmButton.addEventListener("click", performDeleteAccount);

  document.addEventListener("click", (event) => {
    if (!elements.accountMenu.contains(event.target)) {
      closeAccountMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAccountMenu();
      if (!elements.upgradeModal.hidden) {
        closeUpgradeModal();
      }
      if (!elements.deleteModal.hidden) {
        closeDeleteModal();
      }
      if (elements.drawer.classList.contains("open")) {
        closeDrawer();
      }
    }
  });
}

async function initializeAuth() {
  const config = ANTRI_SUPABASE_CONFIG || {};
  if (!config.url || !config.anonKey) {
    showSignedOutApp();
    setAuthDisabled(false);
    setAuthStatus("Add your Supabase project URL and public key in auth-config.js to enable account login.");
    return;
  }

  authClient = window.createAntriAuthClient(config);
  authClient.auth.onAuthStateChange((_event, session) => {
    handleAuthSession(session);
  });

  const { data, error } = await authClient.auth.getSession();
  if (error) {
    showSignedOutApp();
    setAuthStatus(error.message);
    return;
  }

  await handleAuthSession(data.session);
}

async function handleAuthSession(session) {
  if (!session?.user) {
    showSignedOutApp();
    return;
  }

  currentSession = session;
  currentUser = session.user;
  jobs = [];
  elements.accountEmail.textContent = currentUser.email || "Signed in";
  closeAccountMenu();
  elements.authGate.hidden = true;
  elements.appShell.hidden = false;
  setAuthStatus("");
  render();
  setSyncStatus("Loading applications from cloud...");

  try {
    jobs = await loadCloudJobs();
    jobs = await migrateLocalJobsToCloud(jobs);
    await loadSubscription();
    render();
    setSyncStatus(`Cloud synced. ${jobs.length} ${jobs.length === 1 ? "application" : "applications"} loaded.`, "success");
    openDraftFromUrl();
    handleUpgradeReturn();
  } catch (error) {
    render();
    setSyncStatus(cloudStorageErrorMessage(error), "error");
  }
}

function showSignedOutApp() {
  currentSession = null;
  currentUser = null;
  isPro = false;
  jobs = [];
  elements.authGate.hidden = false;
  elements.appShell.hidden = true;
  elements.accountEmail.textContent = "";
  setSyncStatus("");
  closeAccountMenu();
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
  elements.drawer.inert = true;
  elements.drawerBackdrop.hidden = true;
  if (pendingDraftExists()) {
    setAuthStatus("Log in to review the job draft from your browser extension.");
  }
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "login";
  const isSignup = authMode === "signup";
  elements.authModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === authMode);
  });
  elements.authPassword.autocomplete = isSignup ? "new-password" : "current-password";
  elements.authSubmitButton.textContent = isSignup ? "Create account with email" : "Log in with email";
}

async function submitEmailAuth(event) {
  event.preventDefault();
  if (!authClient) {
    setAuthStatus("Account login needs Supabase configuration first.");
    return;
  }

  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  setAuthBusy(true);
  setAuthStatus(authMode === "signup" ? "Creating your account..." : "Logging in...");

  try {
    const result = authMode === "signup"
      ? await authClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: authRedirectUrl() }
      })
      : await authClient.auth.signInWithPassword({ email, password });

    if (result.error) throw result.error;
    if (authMode === "signup" && !result.data.session) {
      setAuthStatus("Check your email to confirm the account, then log in.");
      setAuthMode("login");
      return;
    }

    setAuthStatus("");
  } catch (error) {
    setAuthStatus(error.message || "Email login failed.");
  } finally {
    setAuthBusy(false);
  }
}

async function startOAuth(provider) {
  if (!authClient) {
    setAuthStatus("Account login needs Supabase configuration first.");
    return;
  }

  setAuthBusy(true);
  setAuthStatus("Opening Google login...");
  const { error } = await authClient.auth.signInWithOAuth({
    provider,
    options: { redirectTo: authRedirectUrl() }
  });

  if (error) {
    setAuthBusy(false);
    setAuthStatus(error.message);
  }
}

async function signOut() {
  if (!authClient) return;
  closeAccountMenu();
  const { error } = await authClient.auth.signOut();
  if (error) {
    setAuthStatus(error.message);
    return;
  }
  showSignedOutApp();
  setAuthBusy(false);
  setAuthStatus("Signed out.");
}

function setAuthDisabled(disabled) {
  [
    elements.authEmail,
    elements.authPassword,
    elements.authSubmitButton,
    elements.googleAuthButton,
    ...elements.authModeButtons
  ].forEach((control) => {
    control.disabled = disabled;
  });
}

function setAuthBusy(busy) {
  setAuthDisabled(busy);
}

function setAuthStatus(message) {
  elements.authStatus.textContent = message;
}

function setSyncStatus(message, tone = "") {
  elements.syncStatus.textContent = message;
  if (tone) {
    elements.syncStatus.dataset.tone = tone;
  } else {
    delete elements.syncStatus.dataset.tone;
  }
}

function toggleAccountMenu() {
  const willOpen = elements.accountDropdown.hidden;
  elements.accountDropdown.hidden = !willOpen;
  elements.accountMenuButton.setAttribute("aria-expanded", String(willOpen));
}

function closeAccountMenu() {
  elements.accountDropdown.hidden = true;
  elements.accountMenuButton.setAttribute("aria-expanded", "false");
}

function authRedirectUrl() {
  const origin = window.location.hostname === "antri.onrender.com"
    ? "https://antri.xyz"
    : window.location.origin;
  return `${origin}${window.location.pathname}`;
}

async function loadCloudJobs() {
  const rows = await cloudRequest(
    `${CLOUD_TABLE}?select=${encodeURIComponent(CLOUD_COLUMNS)}&order=date_applied.desc.nullslast,created_at.desc`
  );
  return Array.isArray(rows) ? rows.map(cloudRowToJob) : [];
}

async function migrateLocalJobsToCloud(cloudJobs) {
  if (cloudJobs.length || !currentUser || localStorage.getItem(cloudMigrationKey(currentUser.id))) {
    return cloudJobs;
  }

  const localJobs = localJobsForCloudMigration(currentUser);
  if (!localJobs.length) {
    localStorage.setItem(cloudMigrationKey(currentUser.id), "empty");
    return cloudJobs;
  }

  const shouldUpload = confirm(
    "Upload the Antri applications saved in this browser to this account's cloud storage?"
  );
  localStorage.setItem(cloudMigrationKey(currentUser.id), shouldUpload ? "uploaded" : "skipped");
  if (!shouldUpload) {
    return cloudJobs;
  }

  setSyncStatus("Uploading browser-saved applications to cloud...");
  await upsertCloudJobs(localJobs);
  return loadCloudJobs();
}

async function upsertCloudJobs(nextJobs) {
  if (!nextJobs.length) {
    return [];
  }

  const rows = nextJobs.map(jobToCloudRow);
  const savedRows = await cloudRequest(
    `${CLOUD_TABLE}?on_conflict=id&select=${encodeURIComponent(CLOUD_COLUMNS)}`,
    {
      method: "POST",
      body: rows,
      prefer: "resolution=merge-duplicates,return=representation"
    }
  );
  return Array.isArray(savedRows) ? savedRows.map(cloudRowToJob) : [];
}

async function deleteCloudJob(id) {
  await cloudRequest(`${CLOUD_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    prefer: "return=minimal"
  });
}

async function cloudRequest(path, { method = "GET", body, prefer = "" } = {}) {
  const session = await getActiveSession();
  const response = await fetch(`${trimTrailingSlash(ANTRI_SUPABASE_CONFIG.url)}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANTRI_SUPABASE_CONFIG.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await parseCloudPayload(response);

  if (!response.ok) {
    throw new Error(readCloudError(payload, response.status));
  }

  return payload;
}

async function getActiveSession() {
  if (!authClient) {
    throw new Error("Log in again before syncing applications.");
  }

  const { data, error } = await authClient.auth.getSession();
  if (error) {
    throw error;
  }
  if (!data.session?.access_token) {
    throw new Error("Your session expired. Log in again.");
  }

  currentSession = data.session;
  currentUser = data.session.user;
  return currentSession;
}

// --------------------------------------------------------------------------
// Subscription / paywall (Free: 50 applications; Pro: unlimited + Smart Add)
// --------------------------------------------------------------------------
async function loadSubscription() {
  isPro = false;
  try {
    const rows = await cloudRequest("subscriptions?select=status,current_period_end&limit=1");
    const sub = Array.isArray(rows) ? rows[0] : null;
    if (sub && (sub.status === "active" || sub.status === "trialing")) {
      isPro = !sub.current_period_end || new Date(sub.current_period_end) > new Date();
    }
  } catch (error) {
    // No subscriptions table yet, or a transient error: treat as Free and keep
    // the app working rather than blocking on the paywall layer.
    isPro = false;
  }
}

function updatePlanUI() {
  const pill = elements.planPill;
  const planLine = elements.accountPlan;
  const action = elements.planActionButton;
  if (!pill || !action) return;

  if (isPro) {
    pill.hidden = false;
    pill.dataset.plan = "pro";
    pill.textContent = "Pro";
    pill.title = "Antri Pro — unlimited applications";
    if (planLine) {
      planLine.innerHTML = '<span class="plan-tag pro">Antri Pro</span><span>Unlimited applications</span>';
    }
    action.hidden = false;
    action.textContent = "Manage subscription";
  } else {
    const remaining = Math.max(0, FREE_APP_CAP - jobs.length);
    pill.hidden = false;
    pill.dataset.plan = jobs.length >= FREE_APP_CAP ? "full" : "free";
    pill.textContent = `${jobs.length} / ${FREE_APP_CAP}`;
    pill.title = `Free plan — ${remaining} application${remaining === 1 ? "" : "s"} left. Upgrade for unlimited.`;
    if (planLine) {
      planLine.innerHTML = `<span class="plan-tag">Free plan</span><span>${jobs.length} / ${FREE_APP_CAP} applications</span>`;
    }
    action.hidden = false;
    action.textContent = "Upgrade to Pro";
  }
}

function applySmartLock() {
  const locked = !isPro;
  if (elements.smartLock) elements.smartLock.hidden = !locked;
  if (elements.smartAdd) elements.smartAdd.classList.toggle("is-locked", locked);
  [
    elements.smartUrlInput, elements.smartTextInput, elements.extractTextButton,
    elements.extractUrlButton, elements.clearSmartButton
  ].forEach((el) => { if (el) el.disabled = locked; });
}

const UPGRADE_COPY = {
  cap: "You've reached the free plan's 50-application limit. Upgrade to Pro for unlimited tracking.",
  smartadd: "Smart Add turns any job link into a filled draft. It's part of Antri Pro.",
  extension: "The browser saver extension is part of Antri Pro.",
  plan: "Go unlimited and unlock automation with Antri Pro."
};

function openUpgradeModal(reason = "plan") {
  elements.upgradeReason.textContent = UPGRADE_COPY[reason] || UPGRADE_COPY.plan;
  elements.upgradeStatus.textContent = "";
  elements.upgradeCheckout.disabled = false;
  closeAccountMenu();
  elements.upgradeBackdrop.hidden = false;
  elements.upgradeModal.hidden = false;
  elements.upgradeModal.setAttribute("aria-hidden", "false");
  elements.upgradeCheckout.focus();
}

function closeUpgradeModal() {
  elements.upgradeBackdrop.hidden = true;
  elements.upgradeModal.hidden = true;
  elements.upgradeModal.setAttribute("aria-hidden", "true");
}

async function startCheckout() {
  elements.upgradeStatus.textContent = "Opening secure checkout…";
  elements.upgradeCheckout.disabled = true;
  try {
    const session = await getActiveSession();
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ returnUrl: window.location.origin + window.location.pathname })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.url) {
      throw new Error(payload.error || "Checkout isn't available yet. Please try again soon.");
    }
    window.location.assign(payload.url);
  } catch (error) {
    elements.upgradeStatus.textContent = error.message;
    elements.upgradeCheckout.disabled = false;
  }
}

function handleUpgradeReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("upgrade");
  if (!status) return;
  params.delete("upgrade");
  const query = params.toString();
  window.history.replaceState({}, document.title, `${window.location.pathname}${query ? `?${query}` : ""}`);

  if (status === "cancel") {
    setSyncStatus("Checkout canceled — you can upgrade anytime.");
    return;
  }
  if (status !== "success") return;

  setSyncStatus("Welcome to Antri Pro! Activating your plan…", "success");
  let tries = 0;
  const poll = async () => {
    tries += 1;
    await loadSubscription();
    updatePlanUI();
    if (isPro) {
      applySmartLock();
      setSyncStatus("Antri Pro is active — unlimited applications and Smart Add unlocked.", "success");
    } else if (tries < 6) {
      setTimeout(poll, 1500);
    } else {
      setSyncStatus("Payment received. If Pro features don't unlock shortly, refresh the page.", "success");
    }
  };
  setTimeout(poll, 1200);
}

function openDeleteModal() {
  closeAccountMenu();
  elements.deleteConfirmInput.value = "";
  elements.deleteConfirmButton.disabled = true;
  elements.deleteStatus.textContent = "";
  elements.confirmBackdrop.hidden = false;
  elements.deleteModal.hidden = false;
  elements.deleteModal.setAttribute("aria-hidden", "false");
  elements.deleteConfirmInput.focus();
}

function closeDeleteModal() {
  elements.confirmBackdrop.hidden = true;
  elements.deleteModal.hidden = true;
  elements.deleteModal.setAttribute("aria-hidden", "true");
}

async function performDeleteAccount() {
  if (elements.deleteConfirmInput.value.trim().toUpperCase() !== "DELETE") {
    return;
  }
  elements.deleteConfirmButton.disabled = true;
  elements.deleteStatus.textContent = "Deleting your account…";
  try {
    const session = await getActiveSession();
    const response = await fetch("/api/delete-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.deleted) {
      throw new Error(payload.error || "Could not delete your account. Please try again or contact support.");
    }
    closeDeleteModal();
    try {
      await authClient.auth.signOut();
    } catch (signOutError) {
      // The account is already gone; clearing the local session is enough.
    }
    showSignedOutApp();
    setAuthStatus("Your account and all its data have been permanently deleted.");
  } catch (error) {
    elements.deleteStatus.textContent = error.message;
    elements.deleteConfirmButton.disabled = false;
  }
}

async function manageSubscription() {
  closeAccountMenu();
  try {
    const session = await getActiveSession();
    const response = await fetch("/api/portal-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ returnUrl: window.location.origin + window.location.pathname })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.url) {
      throw new Error(payload.error || "The billing portal isn't available yet.");
    }
    window.location.assign(payload.url);
  } catch (error) {
    setSyncStatus(error.message, "error");
  }
}

function jobToCloudRow(job) {
  const normalized = normalizeJob(job);
  return {
    id: normalized.id,
    user_id: currentUser.id,
    role: normalized.role,
    company: normalized.company,
    location: normalized.location,
    date_applied: normalized.dateApplied || null,
    heard_back: normalized.heardBack,
    status: normalized.status,
    priority: normalized.priority,
    compensation: normalized.compensation,
    source: normalized.source,
    contact: normalized.contact,
    url: normalized.url,
    follow_up: normalized.followUp || null,
    notes: normalized.notes,
    updated_at: new Date().toISOString()
  };
}

function cloudRowToJob(row) {
  return normalizeJob({
    id: row.id,
    role: row.role,
    company: row.company,
    location: row.location,
    dateApplied: row.date_applied || "",
    heardBack: row.heard_back,
    status: row.status,
    priority: row.priority,
    compensation: row.compensation,
    source: row.source,
    contact: row.contact,
    url: row.url,
    followUp: row.follow_up || "",
    notes: row.notes
  });
}

async function parseCloudPayload(response) {
  const text = await response.text();
  if (!text) {
    return [];
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function readCloudError(payload, status) {
  return [
    payload.message,
    payload.details,
    payload.hint,
    payload.code ? `Code ${payload.code}` : ""
  ].filter(Boolean).join(" ") || `Supabase data request failed with HTTP ${status}.`;
}

function cloudStorageErrorMessage(error) {
  const message = error.message || "Unknown cloud sync error.";
  if (/could not find the table|schema cache|PGRST205|42P01|relation .* does not exist/i.test(message)) {
    return "Cloud storage is not ready. Run supabase/job_applications.sql in the Supabase SQL Editor, then refresh Antri.";
  }

  return `Cloud sync failed: ${message}`;
}

function switchView(viewName) {
  currentView = viewName;
  elements.navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
  Object.entries(elements.views).forEach(([name, view]) => {
    view.classList.toggle("active-view", name === viewName);
  });
  render();
}

function render() {
  renderMetrics();
  updatePlanUI();
  renderSourceFilters();
  renderJobs();
  renderBoard();
  renderFollowups();
  renderInsights();
}

function renderMetrics() {
  const activeStatuses = new Set(["Saved", "Applied", "Follow-up", "Interviewing", "Offer"]);
  const today = startOfToday();
  const dueFollowUps = jobs.filter((job) => job.followUp && new Date(job.followUp) <= today).length;

  elements.totalApplications.textContent = jobs.length;
  elements.activeApplications.textContent = jobs.filter((job) => activeStatuses.has(job.status)).length;
  elements.heardBackCount.textContent = jobs.filter((job) => job.heardBack).length;
  elements.followUpCount.textContent = dueFollowUps;
}

function renderJobs() {
  const filtered = getFilteredJobs();
  elements.resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`;
  elements.jobList.replaceChildren();
  elements.emptyState.hidden = filtered.length !== 0;

  filtered.forEach((job) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    card.querySelector("h3").textContent = job.role;
    card.querySelector(".company-line").textContent = [job.company, job.location].filter(Boolean).join(" - ");

    const statusPill = card.querySelector(".status-pill");
    statusPill.textContent = job.status;
    statusPill.classList.add(cssToken(job.status));

    const priorityPill = card.querySelector(".priority-pill");
    priorityPill.textContent = job.priority;
    priorityPill.classList.add(job.priority.toLowerCase());

    card.querySelector(".job-meta").replaceChildren(
      metaChip(`Applied ${formatDate(job.dateApplied)}`),
      metaChip(job.heardBack ? "Heard back" : "No reply yet"),
      metaChip(job.followUp ? `Follow-up ${formatDate(job.followUp)}` : "No follow-up set"),
      metaChip(job.source || "Source unknown")
    );

    card.querySelector(".job-notes").textContent = job.notes || "No notes yet.";

    const link = card.querySelector(".job-link");
    if (job.url) {
      link.href = job.url;
    } else {
      link.hidden = true;
    }

    card.querySelector("button").addEventListener("click", () => openDrawer(job));
    elements.jobList.append(card);
  });
}

function getFilteredJobs() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const status = elements.statusFilter.value;
  const sort = elements.sortSelect.value;

  return jobs
    .filter((job) => {
      const haystack = [
        job.role,
        job.company,
        job.location,
        job.status,
        job.notes,
        job.source,
        job.contact,
        job.compensation
      ].join(" ").toLowerCase();

      const matchesSource = activeSourceFilter === "all" || sourceFilterKey(job.source) === activeSourceFilter;
      return (!query || haystack.includes(query))
        && (status === "all" || job.status === status)
        && matchesSource;
    })
    .sort((a, b) => sortJobs(a, b, sort));
}

function sortJobs(a, b, sort) {
  if (sort === "date-asc") return safeDate(a.dateApplied) - safeDate(b.dateApplied);
  if (sort === "role-asc") return sortText(a.role, b.role);
  if (sort === "role-desc") return sortText(b.role, a.role);
  if (sort === "company-asc") return sortText(a.company, b.company);
  if (sort === "company-desc") return sortText(b.company, a.company);
  if (sort === "followup") return safeDate(a.followUp, true) - safeDate(b.followUp, true);
  if (sort === "priority") return priorityRank(a.priority) - priorityRank(b.priority);
  return safeDate(b.dateApplied) - safeDate(a.dateApplied);
}

function renderSourceFilters() {
  const sourceCounts = jobs.reduce((counts, job) => {
    const key = sourceFilterKey(job.source);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const sourceKeys = Object.keys(sourceCounts).sort((a, b) => sourceFilterLabel(a).localeCompare(sourceFilterLabel(b)));

  if (activeSourceFilter !== "all" && !sourceCounts[activeSourceFilter]) {
    activeSourceFilter = "all";
  }

  elements.sourceFilters.replaceChildren(
    sourceFilterButton("all", "All", jobs.length),
    ...sourceKeys.map((key) => sourceFilterButton(key, sourceFilterLabel(key), sourceCounts[key]))
  );
}

function sourceFilterButton(key, label, count) {
  const button = document.createElement("button");
  button.className = `source-chip ${sourceFilterTone(key)}`;
  button.type = "button";
  button.dataset.source = key;
  button.setAttribute("aria-pressed", String(activeSourceFilter === key));
  button.innerHTML = `<span>${escapeHtml(label)}</span><strong>${count}</strong>`;
  button.addEventListener("click", () => {
    activeSourceFilter = key;
    renderSourceFilters();
    renderJobs();
  });
  return button;
}

function boardJobs() {
  const query = elements.searchInput.value.trim().toLowerCase();
  if (!query) return jobs;
  return jobs.filter((job) => {
    const haystack = [job.role, job.company, job.location, job.status, job.notes, job.source, job.contact]
      .join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function renderBoard() {
  const board = elements.kanban;
  if (!board) return;
  board.replaceChildren();
  const visible = boardJobs();

  statuses.forEach((status) => {
    const columnJobs = visible.filter((job) => job.status === status);

    const column = document.createElement("div");
    column.className = "kanban-col";
    column.dataset.status = status;

    const head = document.createElement("div");
    head.className = "kanban-col-head";
    head.innerHTML =
      `<span class="kanban-col-title ${cssToken(status)}">${escapeHtml(status)}</span>` +
      `<span class="kanban-col-count">${columnJobs.length}</span>`;
    column.appendChild(head);

    const list = document.createElement("div");
    list.className = "kanban-cards";
    columnJobs.forEach((job) => list.appendChild(buildKanbanCard(job)));
    column.appendChild(list);

    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      column.classList.add("drop-target");
    });
    column.addEventListener("dragleave", (event) => {
      if (!column.contains(event.relatedTarget)) column.classList.remove("drop-target");
    });
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      column.classList.remove("drop-target");
      const id = event.dataTransfer.getData("text/plain");
      if (id) updateJobStatus(id, status);
    });

    board.appendChild(column);
  });
}

function buildKanbanCard(job) {
  const card = document.createElement("article");
  card.className = "kanban-card";
  card.draggable = true;
  card.dataset.id = job.id;

  const priority = (job.priority || "Medium").toLowerCase();
  const meta = [];
  if (job.followUp) meta.push(`Follow-up ${formatDate(job.followUp)}`);
  if (job.heardBack) meta.push("Heard back");
  const sub = [job.company, job.location].filter(Boolean).join(" · ") || "—";

  card.innerHTML =
    `<div class="kanban-card-top">` +
      `<strong>${escapeHtml(job.role || "Untitled role")}</strong>` +
      `<span class="priority-pill ${priority}">${escapeHtml(job.priority || "Medium")}</span>` +
    `</div>` +
    `<p class="kanban-card-company">${escapeHtml(sub)}</p>` +
    (meta.length ? `<p class="kanban-card-meta">${escapeHtml(meta.join(" · "))}</p>` : "");

  card.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", job.id);
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("click", () => openDrawer(job));
  return card;
}

async function updateJobStatus(jobId, newStatus) {
  const job = jobs.find((item) => item.id === jobId);
  if (!job || job.status === newStatus) return;

  const previousStatus = job.status;
  job.status = newStatus; // optimistic
  render();
  setSyncStatus("Updating status…");
  try {
    const [savedJob] = await upsertCloudJobs([job]);
    if (savedJob) {
      const index = jobs.findIndex((item) => item.id === jobId);
      if (index >= 0) jobs[index] = savedJob;
    }
    setSyncStatus(`Moved to ${newStatus}.`, "success");
  } catch (error) {
    const reverted = jobs.find((item) => item.id === jobId);
    if (reverted) reverted.status = previousStatus;
    render();
    setSyncStatus(cloudStorageErrorMessage(error), "error");
  }
}

function renderFollowups() {
  const followUps = jobs
    .filter((job) => job.followUp)
    .sort((a, b) => safeDate(a.followUp) - safeDate(b.followUp));

  elements.followupList.replaceChildren();

  if (followUps.length === 0) {
    elements.followupList.append(emptyMessage("No follow-ups scheduled."));
    return;
  }

  followUps.forEach((job) => {
    const item = document.createElement("article");
    item.className = "timeline-item";
    item.innerHTML = `
      <span class="timeline-date">${formatDate(job.followUp)}</span>
      <div>
        <strong>${escapeHtml(job.role)} at ${escapeHtml(job.company)}</strong>
        <p>${escapeHtml(job.notes || "No notes yet.")}</p>
      </div>
      <button class="ghost-button small" type="button">Edit</button>
    `;
    item.querySelector("button").addEventListener("click", () => openDrawer(job));
    elements.followupList.append(item);
  });
}

function renderInsights() {
  renderBarChart(elements.statusChart, countBy(jobs, "status"), statuses);
  const sources = countBy(jobs, "source", "Unknown");
  renderBarChart(elements.sourceChart, sources, Object.keys(sources).sort());
}

function renderBarChart(container, counts, order) {
  container.replaceChildren();
  const max = Math.max(1, ...Object.values(counts));
  const visibleRows = order.filter((key) => counts[key]);

  if (visibleRows.length === 0) {
    container.append(emptyMessage("No data yet."));
    return;
  }

  visibleRows.forEach((key) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <span>${escapeHtml(key)}</span>
      <div class="bar-track"><div class="bar-fill" style="width: ${(counts[key] / max) * 100}%"></div></div>
      <strong>${counts[key]}</strong>
    `;
    container.append(row);
  });
}

function openDrawer(job = null) {
  // Free tier is capped at FREE_APP_CAP applications. Editing existing rows is
  // always allowed; only adding a new one past the cap is blocked.
  if (!job && !isPro && jobs.length >= FREE_APP_CAP) {
    openUpgradeModal("cap");
    return;
  }

  elements.form.reset();
  clearSmartAdd();
  applySmartLock();
  fields.dateApplied.valueAsDate = new Date();
  fields.priority.value = "Medium";
  fields.status.value = "Applied";

  if (job) {
    elements.drawerTitle.textContent = "Edit job";
    elements.deleteButton.hidden = false;
    Object.entries(fields).forEach(([key, input]) => {
      if (key === "heardBack") {
        input.value = String(job.heardBack);
      } else {
        input.value = job[key] || "";
      }
    });
  } else {
    elements.drawerTitle.textContent = "Add job";
    elements.deleteButton.hidden = true;
    fields.id.value = "";
  }

  elements.drawerBackdrop.hidden = false;
  elements.drawer.inert = false;
  elements.drawer.classList.add("open");
  elements.drawer.setAttribute("aria-hidden", "false");
  fields.role.focus();
}

function closeDrawer() {
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
  elements.drawer.inert = true;
  elements.drawerBackdrop.hidden = true;
  elements.openFormButton.focus();
}

async function saveForm(event) {
  event.preventDefault();

  const id = fields.id.value || crypto.randomUUID();
  const nextJob = {
    id,
    role: fields.role.value.trim(),
    company: fields.company.value.trim(),
    location: fields.location.value.trim(),
    dateApplied: fields.dateApplied.value,
    status: fields.status.value,
    heardBack: fields.heardBack.value === "true",
    priority: fields.priority.value,
    compensation: fields.compensation.value.trim(),
    source: fields.source.value.trim(),
    contact: fields.contact.value.trim(),
    url: fields.url.value.trim(),
    followUp: fields.followUp.value,
    notes: fields.notes.value.trim()
  };

  setSyncStatus("Saving application to cloud...");

  try {
    const [savedJob] = await upsertCloudJobs([nextJob]);
    const cloudJob = savedJob || nextJob;
    const existingIndex = jobs.findIndex((job) => job.id === id);
    if (existingIndex >= 0) {
      jobs[existingIndex] = cloudJob;
    } else {
      jobs = [cloudJob, ...jobs];
    }

    closeDrawer();
    render();
    setSyncStatus("Application saved to cloud.", "success");
  } catch (error) {
    setSyncStatus(cloudStorageErrorMessage(error), "error");
  }
}

function extractSmartDetails() {
  const rawText = elements.smartTextInput.value.trim();
  if (!rawText) {
    elements.smartResult.textContent = "Paste a job post first.";
    elements.smartTextInput.focus();
    return;
  }

  const extracted = parseJobPost(rawText);
  const filledCount = applyExtractedJob(extracted);

  elements.smartResult.textContent = filledCount
    ? `Filled ${filledCount} fields. Review before saving.`
    : "No clear fields found. Try pasting more of the post.";
}

async function extractSmartUrl() {
  const url = elements.smartUrlInput.value.trim();
  if (!url) {
    elements.smartResult.textContent = "Paste a job link first.";
    elements.smartUrlInput.focus();
    return;
  }

  if (!/^https?:\/\//i.test(url)) {
    elements.smartResult.textContent = "Use a full link that starts with http or https.";
    elements.smartUrlInput.focus();
    return;
  }

  setSmartLoading(true, "Reading link...");

  try {
    const session = await getActiveSession();
    const response = await fetch("/api/extract-job", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ url, fallbackText: elements.smartTextInput.value.trim() })
    });

    if (response.status === 402) {
      elements.smartResult.textContent = "Smart Add is part of Antri Pro.";
      openUpgradeModal("smartadd");
      return;
    }

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Could not extract this link.");
    }

    const filledCount = applyExtractedJob(payload.job || {});
    const methodLabel = payload.method === "ai" ? "AI extracted" : "Parsed";
    const adapterLabel = payload.adapter && payload.adapter !== "generic"
      ? ` via ${capitalize(payload.adapter)}`
      : "";
    elements.smartResult.textContent = filledCount
      ? `${methodLabel}${adapterLabel} ${filledCount} fields. Review before saving.`
      : "No clear fields found from this link.";
  } catch (error) {
    const fallbackText = elements.smartTextInput.value.trim();
    if (fallbackText) {
      const filledCount = applyExtractedJob(parseJobPost(`${url}\n${fallbackText}`));
      elements.smartResult.textContent = filledCount
        ? `Link failed, text fallback filled ${filledCount} fields.`
        : "Link failed and fallback text did not parse.";
    } else {
      elements.smartResult.textContent = `${error.message} Paste the job text as fallback.`;
    }
  } finally {
    setSmartLoading(false);
  }
}

function applyExtractedJob(extracted) {
  const fieldMap = {
    role: extracted.role,
    company: extracted.company,
    location: extracted.location,
    compensation: extracted.compensation,
    source: extracted.source,
    url: extracted.url || elements.smartUrlInput.value.trim(),
    notes: extracted.notes
  };

  let filledCount = 0;
  Object.entries(fieldMap).forEach(([key, value]) => {
    if (!value) return;
    fields[key].value = value;
    filledCount += 1;
  });

  fields.dateApplied.value = todayInputValue();
  fields.status.value = extracted.status && statuses.includes(extracted.status) ? extracted.status : "Applied";
  fields.heardBack.value = String(Boolean(extracted.heardBack));
  fields.followUp.value = extracted.followUp || addDaysInputValue(7);
  fields.priority.value = ["High", "Medium", "Low"].includes(extracted.priority) ? extracted.priority : "Medium";

  return filledCount;
}

function clearSmartAdd() {
  elements.smartUrlInput.value = "";
  elements.smartTextInput.value = "";
  elements.smartResult.textContent = "";
}

function setSmartLoading(isLoading, message = "") {
  elements.extractUrlButton.disabled = isLoading;
  elements.extractTextButton.disabled = isLoading;
  elements.clearSmartButton.disabled = isLoading;
  if (isLoading || message) {
    elements.smartResult.textContent = message;
  }
}

function rememberDraftFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const encodedDraft = params.get("draft");
  if (!encodedDraft) return;

  try {
    JSON.parse(decodeDraftValue(encodedDraft));
    sessionStorage.setItem(PENDING_DRAFT_KEY, encodedDraft);
  } catch {
    sessionStorage.removeItem(PENDING_DRAFT_KEY);
  }

  params.delete("draft");
  const query = params.toString();
  window.history.replaceState({}, document.title, `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function openDraftFromUrl() {
  const encodedDraft = sessionStorage.getItem(PENDING_DRAFT_KEY);
  if (!encodedDraft) return;

  try {
    const draft = JSON.parse(decodeDraftValue(encodedDraft));
    sessionStorage.removeItem(PENDING_DRAFT_KEY);
    openDrawer();
    if (draft.url) {
      elements.smartUrlInput.value = draft.url;
    }
    const filledCount = applyExtractedJob(draft);
    elements.smartResult.textContent = filledCount
      ? `Extension drafted ${filledCount} fields. Review before saving.`
      : "Extension opened an empty draft. Review before saving.";
  } catch {
    sessionStorage.removeItem(PENDING_DRAFT_KEY);
    openDrawer();
    elements.smartResult.textContent = "The extension draft could not be read.";
  }
}

function pendingDraftExists() {
  return Boolean(sessionStorage.getItem(PENDING_DRAFT_KEY));
}

function decodeDraftValue(value) {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseJobPost(rawText) {
  const text = rawText.replace(/\r/g, "").trim();
  const lines = text
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter(Boolean);

  const url = extractUrl(text);
  const source = inferSource(text, url);
  const compensation = extractCompensation(text);
  const location = extractLocation(lines, text);
  const company = extractCompany(lines, text, url);
  const role = extractRole(lines, company, location);
  const notes = buildSmartNotes(text);

  return {
    role,
    company,
    location,
    compensation,
    source,
    url,
    notes
  };
}

function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0].replace(/[.,;]+$/, "") : "";
}

function inferSource(text, url) {
  const combined = `${url} ${text}`.toLowerCase();
  const sourceRules = [
    ["linkedin", "LinkedIn"],
    ["greenhouse", "Greenhouse"],
    ["lever.co", "Lever"],
    ["indeed", "Indeed"],
    ["workday", "Workday"],
    ["ashbyhq", "Ashby"],
    ["wellfound", "Wellfound"],
    ["ziprecruiter", "ZipRecruiter"],
    ["monster", "Monster"],
    ["glassdoor", "Glassdoor"]
  ];

  const match = sourceRules.find(([needle]) => combined.includes(needle));
  if (match) return match[1];
  if (!url) return "";

  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractCompensation(text) {
  const lines = text
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter(Boolean);
  const labeled = matchLabeledValue(lines, [
    "salary",
    "salary range",
    "compensation",
    "compensation range",
    "pay",
    "pay range",
    "base pay",
    "base salary",
    "hourly pay",
    "wage",
    "expected salary",
    "ote"
  ]);
  if (labeled && hasPaySignal(labeled)) {
    return cleanCompensation(labeled);
  }

  const salaryPatterns = [
    /(?:salary|compensation|pay range|base pay|base salary|hourly pay|wage|expected salary|ote)[^\n:]{0,35}[:\-]?\s*([^\n]{1,140})/i,
    /(?:\bUSD\b|\$)\s*[\d,.]+(?:\s?[kK])?\s*(?:-|to|\u2013|\u2014)\s*(?:\bUSD\b|\$)?\s*[\d,.]+(?:\s?[kK])?(?:\s*(?:\/|per)\s*(?:year|yr|hour|hr|annum|month|mo))?/i,
    /(?:\bUSD\b|\$)\s*[\d,.]+(?:\s?[kK])?(?:\s*(?:\/|per)\s*(?:year|yr|hour|hr|annum|month|mo))/i
  ];

  for (const pattern of salaryPatterns) {
    const match = text.match(pattern);
    const candidate = match?.[1] || match?.[0] || "";
    if (candidate && hasPaySignal(candidate)) {
      return cleanCompensation(candidate);
    }
  }
  return "";
}

function hasPaySignal(value) {
  return /(?:\$|\bUSD\b|\bCAD\b|\bGBP\b|\bEUR\b|\d+\s?k\b|\bper\s+(?:year|yr|hour|hr|month|mo)\b|\/\s*(?:year|yr|hour|hr|month|mo)\b)/i.test(value || "");
}

function cleanCompensation(value) {
  return cleanExtractedValue(value)
    .replace(/\s*(?:\||•)\s*.*$/, "")
    .replace(/^(?:range|is|from)\s+/i, "")
    .slice(0, 120)
    .trim();
}

function extractLocation(lines, text) {
  const labeled = matchLabeledValue(lines, ["location", "locations", "job location", "office", "work location"]);
  if (labeled) return labeled;

  const jobDetailsLocation = extractJobDetailsLocation(lines);
  if (jobDetailsLocation) return jobDetailsLocation;

  const topLocation = lines
    .slice(0, 40)
    .map((line) => extractLocationFromLine(line))
    .find(Boolean);
  if (topLocation) return topLocation;

  const earlyText = lines.slice(0, 80).join("\n");
  const remoteMatch = earlyText.match(/\b(remote|hybrid|on-site|onsite)\b(?:\s*[-,]\s*[A-Za-z .,-]+)?/i);
  if (remoteMatch) return cleanExtractedValue(remoteMatch[0]);

  const cityState = earlyText.match(/\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b/)
    || text.match(/\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b/);
  return cityState ? cleanExtractedValue(cityState[0]) : "";
}

function extractCompany(lines, text, url) {
  const labeled = matchLabeledValue(lines, ["company", "company name", "employer", "hiring organization", "organization"]);
  if (labeled) return labeled;

  const jobIdCompany = extractJobIdCompany(lines);
  if (jobIdCompany) return jobIdCompany;

  const companyPatterns = [
    /\bat\s+([A-Z][A-Za-z0-9&.,' -]{2,70})(?:\s+(?:in|for)\b|\s+-|\s+\||\n|$)/i,
    /([A-Z][A-Za-z0-9&.,' -]{2,70})\s+is\s+(?:hiring|seeking|looking)/i
  ];

  for (const pattern of companyPatterns) {
    const match = text.match(pattern);
    if (match) return cleanExtractedValue(match[1]);
  }

  const roleIndex = lines.slice(0, 30).findIndex((line) => looksLikeRole(line));
  const nearbyLines = roleIndex >= 0
    ? lines.slice(Math.max(0, roleIndex - 3), roleIndex + 7)
    : lines.slice(0, 24);
  const companyLine = nearbyLines.find((line) => looksLikeCompany(line))
    || lines.slice(0, 24).find((line) => looksLikeCompany(line));

  if (companyLine) return companyLine;

  if (!url) return "";
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.split(".")[0].replace(/[-_]/g, " ");
  } catch {
    return "";
  }
}

function extractRole(lines, company, location) {
  const labeled = matchLabeledValue(lines, ["job title", "title", "role", "position"]);
  if (labeled) return cleanRoleTitle(labeled);

  const roleLine = lines.find((line, index) => {
    if (index > 8) return false;
    if (line === company || line === location) return false;
    return looksLikeRole(line);
  });

  if (roleLine) return cleanRoleTitle(roleLine);

  const firstUsefulLine = lines.find((line) => {
    const lower = line.toLowerCase();
    return line.length <= 72
      && line !== company
      && line !== location
      && !lower.includes("apply")
      && !lower.includes("job description")
      && !lower.includes("about us");
  });

  return firstUsefulLine ? cleanRoleTitle(firstUsefulLine) : "";
}

function cleanRoleTitle(value) {
  let title = cleanExtractedValue(value)
    .replace(/\s+/g, " ")
    .replace(/\s+(?:to join|will join|reports? to|is responsible for|you will|you'll|we are|we're|this is)\b.*$/i, "")
    .replace(/\s*[,.;:]\s*(?:this is|you will|you'll|we are|we're|reporting|responsible)\b.*$/i, "")
    .replace(/\s+\bat\s+[A-Z][A-Za-z0-9&.,' -]{2,70}$/i, "");

  if (title.length > 72) {
    const sentenceBreak = title.search(/[.;:]/);
    if (sentenceBreak > 8) {
      title = title.slice(0, sentenceBreak);
    }
  }

  return title.slice(0, 90).trim(" -|,.;:");
}

function matchLabeledValue(lines, labels) {
  const accepted = labels.map((label) => normalizeLabel(label));
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match && accepted.includes(normalizeLabel(match[1]))) {
      return cleanExtractedValue(match[2]);
    }

    if (accepted.includes(normalizeLabel(line.replace(/:$/, "")))) {
      const nextValue = lines
        .slice(index + 1, index + 4)
        .find(Boolean);
      if (nextValue) return cleanExtractedValue(nextValue);
    }
  }
  return "";
}

function looksLikeRole(line) {
  const cleaned = cleanRoleTitle(line);
  if (!cleaned || cleaned.length > 72 || cleaned.split(/\s+/).length > 9) {
    return false;
  }

  const lower = line.toLowerCase();
  const roleWords = [
    "engineer",
    "developer",
    "designer",
    "manager",
    "analyst",
    "associate",
    "specialist",
    "coordinator",
    "director",
    "lead",
    "intern",
    "consultant",
    "administrator",
    "representative",
    "scientist",
    "architect",
    "product",
    "marketing",
    "sales",
    "operations",
    "success"
  ];
  return roleWords.some((word) => lower.includes(word));
}

function looksLikeLocation(line) {
  return /\b(remote|hybrid|on-site|onsite)\b/i.test(line)
    || /\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b/.test(line)
    || /\b(?:USA?|Canada|UK),\s*[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+\b/.test(line);
}

function extractLocationFromLine(line) {
  if (!looksLikeLocation(line)) return "";

  const countryStateCity = line.match(/\b(?:USA?|Canada|UK),\s*[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+\b/);
  if (countryStateCity) return cleanExtractedValue(countryStateCity[0]);

  const cityState = line.match(/\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b/);
  if (cityState) return cleanExtractedValue(cityState[0]);

  const remote = line.match(/\b(remote|hybrid|on-site|onsite)\b(?:\s*[-,]\s*[A-Za-z .,-]+)?/i);
  return remote ? cleanExtractedValue(remote[0]) : cleanExtractedValue(line);
}

function looksLikeCompany(line) {
  const lower = line.toLowerCase();
  const noise = [
    "apply",
    "career",
    "search",
    "sign in",
    "saved",
    "share",
    "skip",
    "job",
    "description",
    "requirement",
    "benefit",
    "location",
    "salary",
    "compensation",
    "remote",
    "hybrid",
    "on-site",
    "onsite",
    "department",
    "employment"
  ];

  return line.length >= 2
    && line.length <= 80
    && !looksLikeRole(line)
    && !looksLikeLocation(line)
    && !noise.some((word) => lower.includes(word));
}

function extractJobIdCompany(lines) {
  for (const line of lines.slice(0, 30)) {
    const match = line.match(/\bJob ID:\s*[^|\n]+\|\s*([^\n]+)/i);
    if (match) return cleanExtractedValue(match[1]);
  }
  return "";
}

function extractJobDetailsLocation(lines) {
  const jobDetailsIndex = lines.findIndex((line) => normalizeLabel(line) === "job details");
  if (jobDetailsIndex < 0) return "";

  return lines
    .slice(jobDetailsIndex + 1, jobDetailsIndex + 18)
    .map((line) => extractLocationFromLine(line))
    .find(Boolean) || "";
}

function normalizeLabel(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildSmartNotes(text) {
  const compact = text
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .slice(0, 12)
    .join("\n");

  return compact.length > 900 ? `${compact.slice(0, 900).trim()}...` : compact;
}

function normalizeLine(line) {
  return line.replace(/\s+/g, " ").trim();
}

function cleanExtractedValue(value) {
  return normalizeLine(value)
    .replace(/^[\-\u2013\u2014|]+/, "")
    .replace(/[\-\u2013\u2014|]+$/, "")
    .trim();
}

function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

async function deleteCurrentJob() {
  const id = fields.id.value;
  if (!id) return;
  const job = jobs.find((item) => item.id === id);
  const label = job ? `${job.role} at ${job.company}` : "this job";
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;

  setSyncStatus("Deleting application from cloud...");
  try {
    await deleteCloudJob(id);
    jobs = jobs.filter((item) => item.id !== id);
    closeDrawer();
    render();
    setSyncStatus("Application deleted from cloud.", "success");
  } catch (error) {
    setSyncStatus(cloudStorageErrorMessage(error), "error");
  }
}

function exportJson() {
  downloadFile("antri-applications.json", JSON.stringify(jobs, null, 2), "application/json");
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error("Expected an array");
      const normalizedJobs = imported.map(normalizeJob);
      setSyncStatus("Importing applications to cloud...");
      await upsertCloudJobs(normalizedJobs);
      jobs = await loadCloudJobs();
      render();
      setSyncStatus(`${normalizedJobs.length} ${normalizedJobs.length === 1 ? "application" : "applications"} imported to cloud.`, "success");
    } catch {
      setSyncStatus("Import failed. Use an exported Antri JSON file and confirm cloud storage is ready.", "error");
    } finally {
      elements.importFile.value = "";
    }
  };
  reader.readAsText(file);
}

function exportCsv() {
  const headers = [
    "Job Role",
    "Company",
    "Location",
    "Date Applied",
    "Heard Back",
    "Status",
    "Priority",
    "Compensation",
    "Source",
    "Contact",
    "Job URL",
    "Follow-up Date",
    "Notes"
  ];

  const rows = getFilteredJobs().map((job) => [
    job.role,
    job.company,
    job.location,
    job.dateApplied,
    job.heardBack ? "Yes" : "No",
    job.status,
    job.priority,
    job.compensation,
    job.source,
    job.contact,
    job.url,
    job.followUp,
    job.notes
  ]);

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  downloadFile("antri-applications.csv", csv, "text/csv");
}

function normalizeJob(job) {
  return {
    id: job.id || crypto.randomUUID(),
    role: job.role || "",
    company: job.company || "",
    location: job.location || "",
    dateApplied: job.dateApplied || "",
    heardBack: Boolean(job.heardBack),
    status: statuses.includes(job.status) ? job.status : "Applied",
    priority: ["High", "Medium", "Low"].includes(job.priority) ? job.priority : "Medium",
    compensation: job.compensation || "",
    source: job.source || "",
    contact: job.contact || "",
    url: job.url || "",
    followUp: job.followUp || "",
    notes: job.notes || ""
  };
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function metaChip(text) {
  const chip = document.createElement("span");
  chip.textContent = text;
  return chip;
}

function emptyMessage(text) {
  const message = document.createElement("div");
  message.className = "empty-state";
  message.textContent = text;
  return message;
}

function countBy(items, key, fallback = "Unknown") {
  return items.reduce((counts, item) => {
    const value = item[key] || fallback;
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function safeDate(value, emptyLast = false) {
  if (!value) return emptyLast ? Number.MAX_SAFE_INTEGER : 0;
  return new Date(value).getTime();
}

function userStorageKey(userId) {
  return `${USER_STORAGE_PREFIX}.${userId}`;
}

function cloudMigrationKey(userId) {
  return `${CLOUD_MIGRATION_PREFIX}.${userId}`;
}

function sortText(first, second) {
  return String(first || "").localeCompare(String(second || ""), undefined, {
    sensitivity: "base",
    numeric: true
  });
}

function sourceFilterKey(source) {
  const value = String(source || "").trim().toLowerCase();
  if (!value) return "unknown";

  const canonicalSources = [
    ["linkedin", "linkedin"],
    ["indeed", "indeed"],
    ["amazon", "amazon"],
    ["greenhouse", "greenhouse"],
    ["lever", "lever"],
    ["workday", "workday"],
    ["ashby", "ashby"],
    ["wellfound", "wellfound"],
    ["ziprecruiter", "ziprecruiter"],
    ["glassdoor", "glassdoor"],
    ["referral", "referral"],
    ["company site", "company-site"],
    ["browser extension", "browser-extension"]
  ];
  const match = canonicalSources.find(([needle]) => value.includes(needle));
  return match ? match[1] : cssToken(value);
}

function sourceFilterLabel(key) {
  const labels = {
    all: "All",
    unknown: "Unknown",
    linkedin: "LinkedIn",
    indeed: "Indeed",
    amazon: "Amazon",
    greenhouse: "Greenhouse",
    lever: "Lever",
    workday: "Workday",
    ashby: "Ashby",
    wellfound: "Wellfound",
    ziprecruiter: "ZipRecruiter",
    glassdoor: "Glassdoor",
    referral: "Referral",
    "company-site": "Company site",
    "browser-extension": "Browser extension"
  };
  if (labels[key]) return labels[key];

  return key
    .split("-")
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function sourceFilterTone(key) {
  const tones = {
    all: "all",
    linkedin: "cyan",
    indeed: "lime",
    amazon: "amber",
    greenhouse: "green",
    lever: "pink",
    workday: "violet",
    ashby: "orange",
    wellfound: "red",
    ziprecruiter: "blue",
    glassdoor: "emerald",
    referral: "magenta",
    "company-site": "silver",
    "browser-extension": "cyan",
    unknown: "silver"
  };
  return tones[key] || "blue";
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function todayInputValue() {
  return dateToInputValue(new Date());
}

function addDaysInputValue(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateToInputValue(date);
}

function dateToInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function priorityRank(priority) {
  return { High: 0, Medium: 1, Low: 2 }[priority] ?? 3;
}

function cssToken(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function formatDate(value) {
  if (!value) return "Not set";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

init();
