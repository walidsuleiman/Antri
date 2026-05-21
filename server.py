from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os
import re
import sys


HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "4173"))
MODEL = os.environ.get("ANTRI_OPENAI_MODEL", "gpt-4o-mini")


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
    def do_POST(self):
        if self.path != "/api/extract-job":
            self.send_json({"error": "Not found"}, 404)
            return

        try:
            payload = self.read_json()
            url = payload.get("url", "").strip()
            fallback_text = payload.get("fallbackText", "").strip()

            if not url.startswith(("http://", "https://")):
                self.send_json({"error": "Paste a full http or https job link."}, 400)
                return

            fetch_error = ""
            try:
                page_text = fetch_page_text(url)
            except (HTTPError, URLError) as error:
                if not fallback_text:
                    raise
                page_text = fallback_text
                fetch_error = " The link could not be fetched, so fallback text was used."

            if fallback_text:
                page_text = f"{page_text}\n\nFallback text:\n{fallback_text}".strip()

            job = extract_with_ai(url, page_text)
            method = "ai"
            if not job:
                job = extract_with_heuristics(url, page_text)
                method = "heuristic"

            job["url"] = job.get("url") or url
            job["source"] = job.get("source") or infer_source(url)
            self.send_json({"job": job, "method": method, "note": fetch_error.strip()})
        except HTTPError as error:
            self.send_json({"error": f"The job page returned HTTP {error.code}."}, 502)
        except URLError:
            self.send_json({"error": "Could not reach that job page."}, 502)
        except Exception as error:
            self.send_json({"error": str(error)}, 500)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length).decode("utf-8")
        return json.loads(data or "{}")

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
    json_ld = "\n".join(extract_json_ld_text(html))
    combined = f"{json_ld}\n\n{text}".strip()
    return combined[:30000]


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
        values.append(json.dumps(parsed, ensure_ascii=False))
    return values


def extract_with_ai(url, page_text):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None

    prompt = (
        "Extract a job application record from this job posting. "
        "Return empty strings for unknown text fields. "
        "Set status to Applied, heardBack to false, and priority to Medium unless the posting suggests otherwise. "
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
    role = next((line for line in lines[:12] if looks_like_role(line)), "")
    company = find_labeled(lines, ["company", "employer", "organization"]) or infer_company(lines, url)
    location = find_labeled(lines, ["location", "job location", "work location"]) or infer_location(text)
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
    for line in lines:
        match = re.match(r"^([^:]+):\s*(.+)$", line)
        if match and match.group(1).strip().lower() in labels:
            return match.group(2).strip()
    return ""


def infer_company(lines, url):
    for line in lines[:8]:
        lower = line.lower()
        if len(line) <= 60 and not looks_like_role(line) and "apply" not in lower and "job" not in lower:
            return line
    host = urlparse(url).hostname or ""
    return host.replace("www.", "").split(".")[0].replace("-", " ")


def infer_location(text):
    remote = re.search(r"\b(remote|hybrid|on-site|onsite)\b(?:\s*[-,]\s*[A-Za-z .,-]+)?", text, re.I)
    if remote:
        return normalize_line(remote.group(0))
    city_state = re.search(r"\b[A-Z][a-zA-Z .'-]+,\s?[A-Z]{2}\b", text)
    return normalize_line(city_state.group(0)) if city_state else ""


def infer_compensation(text):
    salary = re.search(r"\$[\d,]{2,}(?:\s?[kK])?\s?(?:-|to|\u2013|\u2014)\s?\$?[\d,]{2,}(?:\s?[kK])?(?:\s?(?:\/|per)\s?(?:year|yr|hour|hr))?", text, re.I)
    return normalize_line(salary.group(0)) if salary else ""


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
    print("Set OPENAI_API_KEY before starting this server to enable AI extraction.")
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
