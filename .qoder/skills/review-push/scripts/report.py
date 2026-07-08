#!/usr/bin/env python3
import html
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def read_text(path: Path, limit=12000):
    if not path.exists():
        return ""
    text = path.read_text(errors="replace")
    if len(text) > limit:
        return text[-limit:]
    return text


def git(*args):
    try:
        return subprocess.check_output(["git", *args], text=True).strip()
    except Exception:
        return ""


def status_badge(status):
    cls = "ok" if status in {"passed", "success", "low"} else "bad" if status in {"failed", "high"} else "warn"
    return f'<span class="badge {cls}">{html.escape(status or "unknown")}</span>'


def main():
    if len(sys.argv) < 2:
        print("usage: report.py <run-dir>", file=sys.stderr)
        return 2

    run_dir = Path(sys.argv[1])
    run_dir.mkdir(parents=True, exist_ok=True)

    review = read_json(run_dir / "review.json", {"summary": "not run", "risk": "medium", "findings": []})
    test = read_json(run_dir / "test.json", {"status": "not-run", "commands": []})
    lint = read_json(run_dir / "lint.json", {"status": "not-run", "commands": []})
    push = read_json(run_dir / "push.json", {"status": "not-run", "remote": "origin", "branch": git("branch", "--show-current")})

    branch = git("branch", "--show-current")
    head = git("rev-parse", "--short", "HEAD")
    full_head = git("rev-parse", "HEAD")
    base = "origin/main"
    committed_changed = git("diff", "--stat", f"{base}...HEAD")
    staged_changed = git("diff", "--cached", "--stat")
    uncommitted_changed = git("diff", "--stat")
    untracked = git("ls-files", "--others", "--exclude-standard")
    changed = "\n\n".join(
        part for part in [
            "Committed:\n" + committed_changed if committed_changed else "",
            "Staged:\n" + staged_changed if staged_changed else "",
            "Unstaged:\n" + uncommitted_changed if uncommitted_changed else "",
            "Untracked:\n" + untracked if untracked else "",
        ] if part
    )
    generated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    findings = review.get("findings", [])
    finding_rows = []
    for item in findings:
        resolution = item.get("resolution")
        if resolution:
            res_status = resolution.get("status", "")
            res_detail = resolution.get("detail", "")
            res_cls = "ok" if res_status == "fixed" else "warn" if res_status == "deferred" else "muted"
            res_html = f'<span class="badge {res_cls}">{html.escape(res_status)}</span> {html.escape(res_detail)}'
        else:
            res_html = '<span class="muted">—</span>'
        finding_rows.append(
            "<tr>"
            f"<td>{html.escape(item.get('severity', ''))}</td>"
            f"<td>{html.escape(item.get('action', ''))}</td>"
            f"<td>{html.escape(str(item.get('file') or ''))}</td>"
            f"<td>{html.escape(item.get('description', ''))}</td>"
            f"<td>{html.escape(item.get('recommendation', ''))}</td>"
            f"<td>{res_html}</td>"
            "</tr>"
        )
    if not finding_rows:
        finding_rows.append('<tr><td colspan="6" class="muted">No findings</td></tr>')

    html_doc = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Review Push Report</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --text: #172033;
      --muted: #667085;
      --line: #d9e0ea;
      --ok: #0f9f6e;
      --warn: #b7791f;
      --bad: #d92d20;
      --accent: #2563eb;
    }}
    body {{ margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }}
    main {{ max-width: 1120px; margin: 0 auto; padding: 32px; }}
    header {{ margin-bottom: 24px; }}
    h1 {{ margin: 0 0 8px; font-size: 28px; }}
    h2 {{ margin: 0 0 14px; font-size: 18px; }}
    .muted {{ color: var(--muted); }}
    .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 20px 0; }}
    .card {{ background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04); }}
    .label {{ color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }}
    .value {{ margin-top: 6px; font-size: 15px; font-weight: 650; word-break: break-word; }}
    .badge {{ display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; }}
    .ok {{ background: #e7f7ef; color: var(--ok); }}
    .warn {{ background: #fff5db; color: var(--warn); }}
    .bad {{ background: #fee4e2; color: var(--bad); }}
    section {{ margin-top: 18px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ border-top: 1px solid var(--line); padding: 10px; text-align: left; vertical-align: top; }}
    th {{ color: var(--muted); font-size: 12px; }}
    pre {{ overflow: auto; background: #0f172a; color: #dbeafe; padding: 14px; border-radius: 8px; font-size: 12px; max-height: 360px; }}
    @media (max-width: 800px) {{ main {{ padding: 18px; }} .grid {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
<main>
  <header>
    <h1>Review Push Report</h1>
    <div class="muted">Generated at {html.escape(generated)}</div>
  </header>

  <div class="grid">
    <div class="card"><div class="label">Branch</div><div class="value">{html.escape(branch)}</div></div>
    <div class="card"><div class="label">Head</div><div class="value">{html.escape(head)}</div></div>
    <div class="card"><div class="label">Review Risk</div><div class="value">{status_badge(review.get("risk", "medium"))}</div></div>
    <div class="card"><div class="label">Push</div><div class="value">{status_badge(push.get("status", "not-run"))}</div></div>
  </div>

  <section class="card">
    <h2>Summary</h2>
    <p>{html.escape(review.get("summary", ""))}</p>
    <p class="muted">Full head: {html.escape(full_head)}</p>
  </section>

  <section class="card">
    <h2>Review Findings</h2>
    <table>
      <thead><tr><th>Severity</th><th>Action</th><th>File</th><th>Description</th><th>Recommendation</th><th>Resolution</th></tr></thead>
      <tbody>{''.join(finding_rows)}</tbody>
    </table>
  </section>

  <section class="card">
    <h2>Validation</h2>
    <table>
      <tbody>
        <tr><th>Test</th><td>{status_badge(test.get("status"))}</td><td>{html.escape(", ".join(test.get("commands", [])))}</td></tr>
        <tr><th>Lint</th><td>{status_badge(lint.get("status"))}</td><td>{html.escape(", ".join(lint.get("commands", [])))}</td></tr>
      </tbody>
    </table>
  </section>

  <section class="card">
    <h2>Changed Files</h2>
    <pre>{html.escape(changed or "No diff stat available")}</pre>
  </section>

  <section class="card">
    <h2>Test Log</h2>
    <pre>{html.escape(read_text(run_dir / "test.log"))}</pre>
  </section>

  <section class="card">
    <h2>Lint Log</h2>
    <pre>{html.escape(read_text(run_dir / "lint.log"))}</pre>
  </section>

  <section class="card">
    <h2>Push Log</h2>
    <pre>{html.escape(read_text(run_dir / "push.log"))}</pre>
  </section>
</main>
</body>
</html>
"""

    report_path = run_dir / "report.html"
    report_path.write_text(html_doc)
    latest = Path(".review-push/latest.html")
    latest.parent.mkdir(parents=True, exist_ok=True)
    latest.write_text(html_doc)
    print(latest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
