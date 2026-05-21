const STORAGE_KEY = "antri.applications.v1";
const LEGACY_STORAGE_KEY = "jobflow.applications.v1";

const statuses = [
  "Saved",
  "Applied",
  "Follow-up",
  "Interviewing",
  "Offer",
  "Rejected",
  "Withdrawn"
];

const sampleJobs = [
  {
    id: crypto.randomUUID(),
    role: "Growth Product Manager",
    company: "Northstar Labs",
    location: "Remote",
    dateApplied: "2026-05-12",
    heardBack: true,
    status: "Interviewing",
    priority: "High",
    compensation: "$115k-$145k",
    source: "Referral",
    contact: "Maya Chen",
    url: "https://example.com/jobs/growth-product-manager",
    followUp: "2026-05-22",
    notes: "Recruiter screen complete. Prep examples for funnel analytics, experiments, and onboarding metrics."
  },
  {
    id: crypto.randomUUID(),
    role: "Customer Success Manager",
    company: "Harbor Cloud",
    location: "New York, NY",
    dateApplied: "2026-05-09",
    heardBack: false,
    status: "Follow-up",
    priority: "Medium",
    compensation: "$82k-$100k",
    source: "LinkedIn",
    contact: "",
    url: "https://example.com/jobs/customer-success-manager",
    followUp: "2026-05-20",
    notes: "Strong SaaS fit. Follow up with concise note focused on retention and expansion experience."
  },
  {
    id: crypto.randomUUID(),
    role: "Operations Analyst",
    company: "CivicBridge",
    location: "Washington, DC",
    dateApplied: "2026-05-03",
    heardBack: false,
    status: "Applied",
    priority: "Low",
    compensation: "$70k-$88k",
    source: "Company site",
    contact: "",
    url: "",
    followUp: "",
    notes: "Role emphasizes reporting, process improvement, and cross-functional stakeholder management."
  }
];

let jobs = loadJobs();
let currentView = "pipeline";

const elements = {
  views: {
    pipeline: document.getElementById("pipelineView"),
    followups: document.getElementById("followupsView"),
    insights: document.getElementById("insightsView"),
    integrations: document.getElementById("integrationsView")
  },
  navItems: [...document.querySelectorAll(".nav-item")],
  totalApplications: document.getElementById("totalApplications"),
  activeApplications: document.getElementById("activeApplications"),
  heardBackCount: document.getElementById("heardBackCount"),
  followUpCount: document.getElementById("followUpCount"),
  searchInput: document.getElementById("searchInput"),
  statusFilter: document.getElementById("statusFilter"),
  sortSelect: document.getElementById("sortSelect"),
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

function loadJobs() {
  const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!stored) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleJobs));
    return sampleJobs;
  }

  try {
    const parsed = JSON.parse(stored);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return Array.isArray(parsed) ? parsed : sampleJobs;
  } catch {
    return sampleJobs;
  }
}

function saveJobs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

function init() {
  populateStatusOptions();
  bindEvents();
  render();
}

function populateStatusOptions() {
  statuses.forEach((status) => {
    elements.statusFilter.append(new Option(status, status));
    fields.status.append(new Option(status, status));
  });
}

function bindEvents() {
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.drawer.classList.contains("open")) {
      closeDrawer();
    }
  });
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
  renderJobs();
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

      return (!query || haystack.includes(query)) && (status === "all" || job.status === status);
    })
    .sort((a, b) => sortJobs(a, b, sort));
}

function sortJobs(a, b, sort) {
  if (sort === "date-asc") return safeDate(a.dateApplied) - safeDate(b.dateApplied);
  if (sort === "company") return a.company.localeCompare(b.company);
  if (sort === "followup") return safeDate(a.followUp, true) - safeDate(b.followUp, true);
  if (sort === "priority") return priorityRank(a.priority) - priorityRank(b.priority);
  return safeDate(b.dateApplied) - safeDate(a.dateApplied);
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
  elements.form.reset();
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

function saveForm(event) {
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

  const existingIndex = jobs.findIndex((job) => job.id === id);
  if (existingIndex >= 0) {
    jobs[existingIndex] = nextJob;
  } else {
    jobs = [nextJob, ...jobs];
  }

  saveJobs();
  closeDrawer();
  render();
}

function deleteCurrentJob() {
  const id = fields.id.value;
  if (!id) return;
  const job = jobs.find((item) => item.id === id);
  const label = job ? `${job.role} at ${job.company}` : "this job";
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
  jobs = jobs.filter((job) => job.id !== id);
  saveJobs();
  closeDrawer();
  render();
}

function exportJson() {
  downloadFile("antri-applications.json", JSON.stringify(jobs, null, 2), "application/json");
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error("Expected an array");
      jobs = imported.map(normalizeJob);
      saveJobs();
      render();
    } catch {
      alert("That file could not be imported. Exported Antri JSON files are supported.");
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

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
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

init();
