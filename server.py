from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from html.parser import HTMLParser
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import html as html_lib
import json
import os
import re
import sys


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "4173"))
MODEL = os.environ.get("ANTRI_OPENAI_MODEL", "gpt-4o-mini")
CANONICAL_HOST = os.environ.get("ANTRI_CANONICAL_HOST", "antri.xyz")
RENDER_HOST = "antri.onrender.com"


JOB_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "role": {"type": "string"},
        "company": {"type": "string"},
        "location": {"type": "string"},
        "dateApplied": {"type": "string"},
        "heardBack": {"type": "boolean"},
        "status": {
            "type": "string",
            "enum": ["Saved", "Applied", "Follow-up", "Interviewing", "Offer", "Rejected", "Withdrawn"],
        },
        "priority": {"type": "string", "enum": ["High", "Medium", "Low"]},
        "compensation": {"type": "string"},
        "source": {"type": "string"},
        "contact": {"type": "string"},
        "url": {"type": "string"},
        "followUp": {"type": "string"},
        "notes": {"type": "string"},
    },
    "required": [
        "role",
        "company",
        "location",
        "dateApplied",
        "heardBack",
        "status",
        "priority",
        "compensation",
        "source",
        "contact",
        "url",
        "followUp",
        "notes",
    ],
}


class VisibleTextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.skip_depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip_depth += 1
        if tag in {"p", "div", "li", "br", "h1", "h2", "h3", "section"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg"} and self.skip_depth:
            self.skip_depth -= 1
        if tag in {"p", "div", "li", "h1", "h2", "h3", "section"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.skip_depth:
            return
        cleaned = re.sub(r"\s+", " ", data).strip()
        if cleaned:
            self.parts.append(cleaned)

    def text(self):
        joined = "\n".join(self.parts)
        joined = re.sub(r"\n{3,}", "\n\n", joined)
        return joined.strip()


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.redirect_to_canonical_host():
            return
        super().do_GET()

    def do_POST(self):
        if self.path not in {"/api/extract-job", "/api/extract-page"}:
            self.send_json({"error": "Not found"}, 404)
            return

        try:
            payload = self.read_json()
            url = payload.get("url", "").strip()

            if not url.startswith(("http://", "https://")):
                self.send_json({"error": "Paste a full http or https job link."}, 400)
                return

            if self.path == "/api/extract-page":
                self.extract_captured_page(payload, url)
                return

            fallback_text = payload.get("fallbackText", "").strip()
            fetch_error = ""
            adapter = "generic"
            try:
                adapter_result = fetch_ats_page_text(url)
                if adapter_result:
                    page_text, adapter = adapter_result
                else:
                    page_text = fetch_page_text(url)
            except (HTTPError, URLError) as error:
                if not fallback_text:
                    raise
                page_text = fallback_text
                fetch_error = " The link could not be fetched, so fallback text was used."

            if fallback_text:
                page_text = f"{page_text}\n\nFallback text:\n{fallback_text}".strip()

            job, method = extract_job_from_text(url, page_text)
            self.send_json({"job": job, "method": method, "adapter": adapter, "note": fetch_error.strip()})
        except HTTPError as error:
            self.send_json({"error": f"The job page returned HTTP {error.code}."}, 502)
        except URLError:
            self.send_json({"error": "Could not reach that job page."}, 502)
        except Exception as error:
            self.send_json({"error": str(error)}, 500)

    def extract_captured_page(self, payload, url):
        page_title = normalize_line(payload.get("pageTitle", ""))[:300]
        page_text = payload.get("pageText", "").strip()
        if len(page_text) < 40:
            self.send_json({"error": "The extension could not read enough page text."}, 400)
            return

        captured = "\n".join(
            value for value in [
                page_text[:30000],
                f"Browser page title: {page_title}" if page_title else "",
            ] if value
        )
        job, method = extract_job_from_text(url, captured)
        self.send_json({"job": job, "method": method, "adapter": "browser-extension"})

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length).decode("utf-8")
        return json.loads(data or "{}")

    def redirect_to_canonical_host(self):
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        if host != RENDER_HOST or not CANONICAL_HOST:
            return False

        self.send_response(308)
        self.send_header("Location", f"https://{CANONICAL_HOST}{self.path}")
        self.end_headers()
        return True

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def fetch_page_text(url):
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 AntriJobExtractor/0.1",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urlopen(request, timeout=15) as response:
        content_type = response.headers.get("Content-Type", "")
        raw = response.read(1_500_000)

    if "text/html" not in content_type and b"<html" not in raw[:1000].lower():
        return raw.decode("utf-8", errors="ignore")[:20000]

    html = raw.decode("utf-8", errors="ignore")
    parser = VisibleTextParser()
    parser.feed(html)
    text = parser.text()
    json_ld = "\n\n".join(extract_json_ld_text(html))
    combined = f"{json_ld}\n\n{text}".strip()
    return combined[:30000]


def extract_job_from_text(url, page_text):
    try:
        job = extract_with_ai(url, page_text)
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError):
        job = None

    method = "ai"
    if not job:
        job = extract_with_heuristics(url, page_text)
        method = "heuristic"

    job["url"] = job.get("url") or url
    job["source"] = job.get("source") or infer_source(url)
    return job, method


def fetch_ats_page_text(url):
    greenhouse = parse_greenhouse_url(url)
    if greenhouse:
        return fetch_greenhouse_text(*greenhouse), "greenhouse"

    lever = parse_lever_url(url)
    if lever:
        return fetch_lever_text(*lever), "lever"

    return None


def parse_greenhouse_url(url):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    path = [part for part in parsed.path.split("/") if part]
    if "greenhouse.io" not in host:
        return None

    if host.startswith("boards.greenhouse.io") and len(path) >= 3 and path[1] == "jobs":
        return path[0], only_digits(path[2])

    query = parse_qs(parsed.query)
    if host.startswith("job-boards.greenhouse.io") and len(path) >= 2:
        job_id = path[-1]
        board = query.get("for", [""])[0] or path[0]
        return board, only_digits(job_id)

    if host.startswith("boards.greenhouse.io") and len(path) >= 2 and path[-2] == "jobs":
        return path[0], only_digits(path[-1])

    return None


def fetch_greenhouse_text(board_token, job_id):
    if not board_token or not job_id:
        raise ValueError("Could not read the Greenhouse board or job ID from this link.")

    api_url = (
        "https://boards-api.greenhouse.io/v1/boards/"
        f"{quote(board_token)}/jobs/{quote(job_id)}?pay_transparency=true"
    )
    data = fetch_json(api_url)
    board = fetch_json(f"https://boards-api.greenhouse.io/v1/boards/{quote(board_token)}")
    location = (data.get("location") or {}).get("name", "")
    content = html_to_text(data.get("content", ""))
    pay = greenhouse_pay_text(data)
    parts = [
        f"Job title: {data.get('title', '')}",
        f"Company: {board.get('name', '') or humanize_site(board_token)}",
        f"Location: {location}",
        f"Source: Greenhouse",
        f"Compensation: {pay}" if pay else "",
        content,
    ]
    return "\n".join(part for part in parts if part).strip()


def greenhouse_pay_text(data):
    pay_ranges = data.get("pay_input_ranges") or []
    labels = []
    for pay_range in pay_ranges:
        min_value = pay_range.get("min_cents")
        max_value = pay_range.get("max_cents")
        currency = pay_range.get("currency_type") or ""
        interval = pay_range.get("pay_period") or ""
        if min_value is None or max_value is None:
            continue
        labels.append(f"{currency} {min_value / 100:,.0f} - {max_value / 100:,.0f} {interval}".strip())
    return "; ".join(labels)


def parse_lever_url(url):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    path = [part for part in parsed.path.split("/") if part]
    if host not in {"jobs.lever.co", "jobs.eu.lever.co"} or len(path) < 2:
        return None
    return path[0], path[1], "eu" if host.startswith("jobs.eu.") else "global"


def fetch_lever_text(site, posting_id, region):
    api_host = "api.eu.lever.co" if region == "eu" else "api.lever.co"
    api_url = f"https://{api_host}/v0/postings/{quote(site)}/{quote(posting_id)}"
    data = fetch_json(api_url)
    categories = data.get("categories") or {}
    location = categories.get("location") or ""
    workplace_type = data.get("workplaceType") or ""
    content = "\n".join(
        value for value in [
            data.get("descriptionPlain", ""),
            text_from_lever_lists(data.get("lists") or []),
            data.get("additionalPlain", ""),
        ] if value
    )
    parts = [
        f"Job title: {data.get('text', '')}",
        f"Company: {humanize_site(site)}",
        f"Location: {' - '.join(value for value in [location, workplace_type] if value)}",
        "Source: Lever",
        content,
    ]
    return "\n".join(part for part in parts if part).strip()


def text_from_lever_lists(items):
    return "\n".join(
        "\n".join(
            value for value in [
                item.get("text", ""),
                html_to_text(item.get("content", "")),
            ] if value
        )
        for item in items
    )


def fetch_json(url):
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 AntriJobExtractor/0.1",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def html_to_text(html):
    parser = VisibleTextParser()
    parser.feed(html_lib.unescape(html or ""))
    return parser.text()


def only_digits(value):
    match = re.search(r"\d+", value or "")
    return match.group(0) if match else ""


def extract_json_ld_text(html):
    blocks = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    values = []
    for block in blocks:
        try:
            parsed = json.loads(block.strip())
        except json.JSONDecodeError:
            continue
        values.extend(job_posting_texts(parsed))
    return values


def job_posting_texts(value):
    postings = []
    for node in iter_json_ld_nodes(value):
        node_types = as_list(node.get("@type"))
        if any(str(node_type).lower() == "jobposting" for node_type in node_types):
            postings.append(job_posting_text(node))
    return [posting for posting in postings if posting]


def iter_json_ld_nodes(value):
    if isinstance(value, list):
        for item in value:
            yield from iter_json_ld_nodes(item)
        return
    if not isinstance(value, dict):
        return

    yield value
    for graph_key in ("@graph", "graph"):
        if graph_key in value:
            yield from iter_json_ld_nodes(value[graph_key])


def job_posting_text(posting):
    title = first_text(posting.get("title"), posting.get("name"))
    company = first_text(structured_name(posting.get("hiringOrganization")))
    location = job_posting_location(posting)
    compensation = job_posting_compensation(posting)
    description = html_to_text(first_text(posting.get("description")))[:12000]
    parts = [
        "Structured JobPosting data:",
        f"Job title: {title}" if title else "",
        f"Company: {company}" if company else "",
        f"Location: {location}" if location else "",
        f"Compensation: {compensation}" if compensation else "",
        description,
    ]
    return "\n".join(part for part in parts if part).strip()


def job_posting_location(posting):
    values = []
    location_type = " ".join(str(value) for value in as_list(posting.get("jobLocationType")))
    if "telecommute" in location_type.lower() or "remote" in location_type.lower():
        values.append("Remote")

    for location in as_list(posting.get("jobLocation")):
        values.extend(location_values(location))

    for requirement in as_list(posting.get("applicantLocationRequirements")):
        values.extend(location_values(requirement))

    return " - ".join(unique_values(values))


def job_posting_compensation(posting):
    values = []
    for salary in as_list(posting.get("baseSalary")):
        values.extend(salary_values(salary))
    return "; ".join(unique_values(values))


def salary_values(value):
    if isinstance(value, str):
        return [normalize_line(value)]
    if not isinstance(value, dict):
        return []

    currency = first_text(value.get("currency")) or first_text(value.get("salaryCurrency"))
    amount = value.get("value", value)
    if isinstance(amount, dict):
        min_value = first_text(str(amount.get("minValue"))) if amount.get("minValue") is not None else ""
        max_value = first_text(str(amount.get("maxValue"))) if amount.get("maxValue") is not None else ""
        single_value = first_text(str(amount.get("value"))) if amount.get("value") is not None else ""
        unit = first_text(amount.get("unitText")) or first_text(amount.get("unit"))
    else:
        min_value = ""
        max_value = ""
        single_value = first_text(str(amount)) if amount is not None else ""
        unit = ""

    if min_value and max_value:
        label = f"{currency} {format_pay_number(min_value)} - {format_pay_number(max_value)}".strip()
    elif single_value:
        label = f"{currency} {format_pay_number(single_value)}".strip()
    else:
        return []

    if unit:
        label = f"{label} per {unit.lower()}"
    return [normalize_line(label)]


def format_pay_number(value):
    text = normalize_line(str(value or ""))
    try:
        number = float(text.replace(",", ""))
    except ValueError:
        return text
    return f"{number:,.0f}" if number.is_integer() else f"{number:,.2f}"


def location_values(value):
    if isinstance(value, str):
        return [normalize_line(value)]
    if not isinstance(value, dict):
        return []

    address = value.get("address")
    if isinstance(address, str):
        return [normalize_line(address)]
    if isinstance(address, dict):
        parts = [
            first_text(address.get("addressLocality")),
            first_text(address.get("addressRegion")),
            first_text(address.get("addressCountry")),
        ]
        joined = ", ".join(part for part in parts if part)
        if joined:
            return [normalize_line(joined)]

    name = first_text(value.get("name"), value.get("description"))
    return [normalize_line(name)] if name else []


def structured_name(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return first_text(value.get("name"), value.get("legalName"))
    return ""


def first_text(*values):
    for value in values:
        if isinstance(value, str) and value.strip():
            return normalize_line(value)
    return ""


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def unique_values(values):
    unique = []
    seen = set()
    for value in values:
        cleaned = normalize_line(str(value or ""))
        marker = cleaned.lower()
        if cleaned and marker not in seen:
            unique.append(cleaned)
            seen.add(marker)
    return unique


def extract_with_ai(url, page_text):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None

    prompt = (
        "Extract a job application record from this job posting. "
        "Return empty strings for unknown text fields. "
        "Set status to Applied, heardBack to false, and priority to Medium unless the posting suggests otherwise. "
        "Prefer explicit labeled fields and structured JobPosting data when reading company and location. "
        "For compensation, extract explicit salary, hourly, pay range, base pay, OTE, stipend, or baseSalary data. "
        "Keep the pay period when available, such as per year or per hour. Do not invent compensation. "
        "Company means the actual hiring employer, not the job board, applicant tracking system, staffing vendor, "
        "or a company only mentioned in the description unless that company is clearly the employer. "
        "Location means the work location in the job header or JobPosting data. Do not use footer addresses, "
        "legal text, benefit examples, or unrelated office lists. Keep Remote, Hybrid, or On-site context when explicit. "
        "Use notes for a concise summary of the role, responsibilities, requirements, and any useful application context.\n\n"
        f"URL: {url}\n\nJOB POSTING TEXT:\n{page_text}"
    )

    body = {
        "model": MODEL,
        "input": [
            {"role": "system", "content": "You extract structured job application tracking data as JSON."},
            {"role": "user", "content": prompt},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "job_application",
                "strict": True,
                "schema": JOB_SCHEMA,
            }
        },
    }

    request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    with urlopen(request, timeout=45) as response:
        data = json.loads(response.read().decode("utf-8"))

    output_text = find_response_text(data)
    if not output_text:
        return None
    return normalize_job(json.loads(output_text))


def find_response_text(data):
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    for item in data.get("output", []):
        for content in item.get("content", []):
            if isinstance(content.get("text"), str):
                return content["text"]
    return ""


def extract_with_heuristics(url, text):
    lines = [normalize_line(line) for line in text.splitlines()]
    lines = [line for line in lines if line]
    role = find_labeled(lines, ["job title", "title", "role", "position"]) or next((line for line in lines[:12] if looks_like_role(line)), "")
    company = (
        find_labeled(lines, ["company", "company name", "employer", "hiring organization", "organization"])
        or find_job_id_company(lines)
        or infer_company(lines, url)
    )
    location = (
        find_labeled(lines, ["location", "locations", "job location", "work location", "office"])
        or find_job_details_location(lines)
        or infer_location(lines, text)
    )
    compensation = infer_compensation(text)
    return normalize_job(
        {
            "role": role,
            "company": company,
            "location": location,
            "compensation": compensation,
            "source": infer_source(url),
            "url": url,
            "status": "Applied",
            "heardBack": False,
            "priority": "Medium",
            "notes": "\n".join(lines[:14])[:1200],
        }
    )


def normalize_job(job):
    normalized = {key: "" for key in JOB_SCHEMA["properties"]}
    normalized.update(job or {})
    normalized["heardBack"] = bool(normalized.get("heardBack"))
    normalized["status"] = normalized.get("status") if normalized.get("status") in JOB_SCHEMA["properties"]["status"]["enum"] else "Applied"
    normalized["priority"] = normalized.get("priority") if normalized.get("priority") in {"High", "Medium", "Low"} else "Medium"
    return normalized


def normalize_line(line):
    return re.sub(r"\s+", " ", line).strip()


def find_labeled(lines, labels):
    accepted = {normalize_label(label) for label in labels}
    for index, line in enumerate(lines):
        match = re.match(r"^([^:]+):\s*(.+)$", line)
        if match and normalize_label(match.group(1)) in accepted:
            return match.group(2).strip()
        if normalize_label(line.rstrip(":")) in accepted:
            next_value = next((value for value in lines[index + 1:index + 4] if value), "")
            if next_value:
                return next_value
    return ""


def infer_company(lines, url):
    phrase = find_company_phrase("\n".join(lines[:80]))
    if phrase:
        return phrase

    role_index = next((index for index, line in enumerate(lines[:30]) if looks_like_role(line)), -1)
    if role_index >= 0:
        nearby = lines[max(0, role_index - 3):role_index + 7]
        nearby_company = next((line for line in nearby if looks_like_company(line)), "")
        if nearby_company:
            return nearby_company

    early_company = next((line for line in lines[:24] if looks_like_company(line)), "")
    if early_company:
        return early_company

    host = urlparse(url).hostname or ""
    return host.replace("www.", "").split(".")[0].replace("-", " ")


def infer_location(lines, text):
    top_location = next((location_from_line(line) for line in lines[:40] if location_from_line(line)), "")
    if top_location:
        return top_location

    context = "\n".join(lines[:80])
    remote = re.search(r"\b(remote|hybrid|on-site|onsite)\b(?:\s*[-,]\s*[A-Za-z .,-]+)?", context, re.I)
    if remote:
        return normalize_line(remote.group(0))

    city_state = re.search(r"\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b", context)
    if city_state:
        return normalize_line(city_state.group(0))

    city_state = re.search(r"\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b", text)
    return normalize_line(city_state.group(0)) if city_state else ""


def infer_compensation(text):
    lines = [normalize_line(line) for line in text.splitlines()]
    lines = [line for line in lines if line]
    labeled = find_labeled(
        lines,
        [
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
            "ote",
        ],
    )
    if labeled and has_pay_signal(labeled):
        return normalize_compensation(labeled)

    context_patterns = [
        r"(?:salary|compensation|pay range|base pay|base salary|hourly pay|wage|expected salary|ote)[^\n:]{0,35}[:\-]?\s*([^\n]{1,140})",
        r"(?:\bUSD\b|\$)\s*[\d,.]+(?:\s?[kK])?\s*(?:-|to|\u2013|\u2014)\s*(?:\bUSD\b|\$)?\s*[\d,.]+(?:\s?[kK])?(?:\s*(?:\/|per)\s*(?:year|yr|hour|hr|annum|month|mo))?",
        r"(?:\bUSD\b|\$)\s*[\d,.]+(?:\s?[kK])?(?:\s*(?:\/|per)\s*(?:year|yr|hour|hr|annum|month|mo))",
    ]
    for pattern in context_patterns:
        match = re.search(pattern, text, re.I)
        if match:
            candidate = match.group(1) if match.lastindex else match.group(0)
            if has_pay_signal(candidate):
                return normalize_compensation(candidate)
    return ""


def has_pay_signal(value):
    return bool(re.search(r"(?:\$|\bUSD\b|\bCAD\b|\bGBP\b|\bEUR\b|\d+\s?[kK]\b|\bper\s+(?:year|yr|hour|hr|month|mo)\b|/\s*(?:year|yr|hour|hr|month|mo)\b)", value or "", re.I))


def normalize_compensation(value):
    cleaned = normalize_line(value)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"\s*(?:\||•)\s*.*$", "", cleaned)
    cleaned = re.sub(r"^(?:range|is|from)\s+", "", cleaned, flags=re.I)
    return cleaned[:120].strip(" .;,")


def infer_source(url):
    host = (urlparse(url).hostname or "").lower()
    sources = {
        "linkedin": "LinkedIn",
        "greenhouse": "Greenhouse",
        "lever": "Lever",
        "indeed": "Indeed",
        "workday": "Workday",
        "ashbyhq": "Ashby",
        "wellfound": "Wellfound",
        "ziprecruiter": "ZipRecruiter",
        "glassdoor": "Glassdoor",
    }
    for needle, label in sources.items():
        if needle in host:
            return label
    return host.replace("www.", "")


def humanize_site(value):
    return re.sub(r"[-_]+", " ", value or "").title()


def normalize_label(value):
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def looks_like_company(line):
    lower = line.lower()
    noise = (
        "apply", "careers", "career", "search", "sign in", "saved", "share", "skip",
        "job", "description", "requirement", "benefit", "location", "salary", "compensation",
        "remote", "hybrid", "on-site", "onsite", "department", "employment",
    )
    return (
        2 <= len(line) <= 80
        and not looks_like_role(line)
        and not looks_like_location_line(line)
        and not any(word in lower for word in noise)
    )


def find_company_phrase(text):
    patterns = [
        r"\bat\s+([A-Z][A-Za-z0-9&.,' -]{2,70})(?:\s+(?:in|for)\b|\s*[-|]\s*|\n|$)",
        r"([A-Z][A-Za-z0-9&.,' -]{2,70})\s+is\s+(?:hiring|seeking|looking)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return normalize_line(match.group(1))
    return ""


def find_job_id_company(lines):
    for line in lines[:30]:
        match = re.search(r"\bJob ID:\s*[^|\n]+\|\s*([^\n]+)", line, re.I)
        if match:
            return normalize_line(match.group(1))
    return ""


def find_job_details_location(lines):
    job_details_index = next((index for index, line in enumerate(lines) if normalize_label(line) == "job details"), -1)
    if job_details_index < 0:
        return ""

    return next(
        (location_from_line(line) for line in lines[job_details_index + 1:job_details_index + 18] if location_from_line(line)),
        "",
    )


def location_from_line(line):
    if not looks_like_location_line(line):
        return ""
    country_state_city = re.search(r"\b(?:USA?|Canada|UK),\s*[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+\b", line)
    if country_state_city:
        return normalize_line(country_state_city.group(0))
    city_state = re.search(r"\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b", line)
    if city_state:
        return normalize_line(city_state.group(0))
    remote = re.search(r"\b(remote|hybrid|on-site|onsite)\b(?:\s*[-,]\s*[A-Za-z .,-]+)?", line, re.I)
    return normalize_line(remote.group(0)) if remote else normalize_line(line)


def looks_like_location_line(line):
    return bool(
        re.search(r"\b(remote|hybrid|on-site|onsite)\b", line or "", re.I)
        or re.search(r"\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b", line or "")
        or re.search(r"\b(?:USA?|Canada|UK),\s*[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+\b", line or "")
    )


def looks_like_role(line):
    words = (
        "engineer developer designer manager analyst associate specialist coordinator director "
        "lead intern consultant administrator representative scientist architect product marketing "
        "sales operations success"
    ).split()
    lower = line.lower()
    return len(line) <= 90 and any(word in lower for word in words)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"Serving Antri at http://{HOST}:{PORT}/index.html")
    if os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY detected. AI extraction is enabled.")
    else:
        print("Set OPENAI_API_KEY before starting this server to enable AI extraction.")
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
