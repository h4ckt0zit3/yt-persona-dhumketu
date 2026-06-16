#!/usr/bin/env python3
"""
Export a Claude Code session JSONL to readable Markdown.

Usage:
    python scripts/export-session.py [JSONL_PATH] [OUTPUT_PATH]

Defaults: walks ~/.claude/projects/<this-repo>/*.jsonl, picks the most
recent, writes to docs/sessions/session-<YYYY-MM-DD-HHMM>.md.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path


def find_default_jsonl() -> Path | None:
    """Find the most recent session JSONL for this repo under ~/.claude/projects/.

    Claude Code stores sessions in a per-project dir whose name is the
    repo's absolute path with `/`, `\\`, ` `, `:` all replaced by `-`.
    """
    home = Path.home()
    base = home / ".claude" / "projects"
    if not base.exists():
        return None

    repo = Path.cwd().resolve()
    # Slugify the repo path the same way Claude Code does.
    slug = re.sub(r"[\\/:\s]", "-", str(repo))
    slug = slug.strip("-").replace("--", "--")  # preserve double-dashes

    candidate_dirs: list[Path] = []
    exact = base / slug
    if exact.exists():
        candidate_dirs.append(exact)
    # Fallback: substring match on the repo's last-folder name (dashed)
    repo_name_dashed = re.sub(r"[\s]", "-", repo.name)
    for d in base.iterdir():
        if not d.is_dir():
            continue
        if repo_name_dashed in d.name and d not in candidate_dirs:
            candidate_dirs.append(d)

    files: list[Path] = []
    for d in candidate_dirs:
        files.extend(d.glob("*.jsonl"))
    if not files:
        return None
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0]


def render_block(block: dict) -> str:
    """Render a single content block from a message."""
    t = block.get("type")
    if t == "text":
        return block.get("text", "")
    if t == "thinking":
        # Internal reasoning — usually not what the user wants, skip by default
        return ""
    if t == "tool_use":
        name = block.get("name", "?")
        inp = block.get("input", {})
        # One-line summary of the call
        if name == "Bash":
            cmd = (inp.get("command") or "").splitlines()[0][:200]
            return f"\n> **tool:** `Bash` — `{cmd}`\n"
        if name in ("Edit", "Write", "Read"):
            path = inp.get("file_path", "?")
            return f"\n> **tool:** `{name}` — `{path}`\n"
        if name == "Grep":
            pat = inp.get("pattern", "?")
            return f"\n> **tool:** `Grep` — `{pat}`\n"
        if name == "Glob":
            pat = inp.get("pattern", "?")
            return f"\n> **tool:** `Glob` — `{pat}`\n"
        if name == "AskUserQuestion":
            qs = inp.get("questions", [])
            first_q = (qs[0].get("question", "")[:120] if qs else "")
            return f"\n> **tool:** `AskUserQuestion` — _{first_q}…_\n"
        if name == "TaskCreate" or name == "TaskUpdate":
            return f"\n> **tool:** `{name}` — {json.dumps(inp)[:200]}\n"
        if name == "Skill":
            return f"\n> **tool:** `Skill` — `{inp.get('skill', '?')}`\n"
        # Generic fallback
        s = json.dumps(inp)[:200]
        return f"\n> **tool:** `{name}` — `{s}`\n"
    if t == "tool_result":
        content = block.get("content")
        if isinstance(content, list):
            content = "".join(c.get("text", "") if isinstance(c, dict) else str(c) for c in content)
        text = str(content or "").strip()
        if not text:
            return "\n_(tool result: empty)_\n"
        # Truncate very long tool results
        max_len = 1200
        if len(text) > max_len:
            text = text[:max_len] + f"\n\n_…truncated ({len(text) - max_len} chars elided)_"
        return f"\n```\n{text}\n```\n"
    return ""


def render_user(msg) -> str:
    """User messages may be plain strings or lists of blocks (incl. tool_result)."""
    if isinstance(msg, dict):
        content = msg.get("content")
    else:
        content = msg
    if isinstance(content, str):
        text = strip_command_wrappers(content)
        if not text.strip():
            return ""
        return text
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                parts.append(render_block(block))
            else:
                parts.append(str(block))
        return "".join(parts).strip()
    return str(content)


def render_assistant(msg) -> str:
    content = msg.get("content") if isinstance(msg, dict) else msg
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(render_block(b) for b in content if isinstance(b, dict)).strip()
    return str(content)


def strip_command_wrappers(text: str) -> str:
    """Strip Claude Code's <command-*>...</command-*> XML wrappers from user input."""
    # Pull out the human-typed part if it's wrapped in command-name etc.
    # Keep slash command invocations visible but stripped of internal tags.
    text = re.sub(r"<command-(message|name|args|stdout|stderr)>.*?</command-\1>", "", text, flags=re.DOTALL)
    text = re.sub(r"<system-reminder>.*?</system-reminder>", "", text, flags=re.DOTALL)
    text = re.sub(r"<local-command-(stdout|stderr|caveat)>.*?</local-command-\1>", "", text, flags=re.DOTALL)
    return text.strip()


def main() -> int:
    args = sys.argv[1:]
    jsonl_path = Path(args[0]) if args else find_default_jsonl()
    if not jsonl_path or not jsonl_path.exists():
        print(f"Could not find session JSONL. Tried: {jsonl_path}", file=sys.stderr)
        return 1

    out_path = (
        Path(args[1])
        if len(args) > 1
        else Path("docs/sessions") / f"session-{datetime.now().strftime('%Y-%m-%d-%H%M')}.md"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lines_written = 0
    skipped = 0
    out: list[str] = []
    out.append(f"# Claude Code session transcript\n")
    out.append(f"_Source: `{jsonl_path}`_  \n")
    out.append(f"_Exported: {datetime.now().isoformat(timespec='seconds')}_\n\n")
    out.append("---\n\n")

    with jsonl_path.open(encoding="utf-8") as f:
        for raw in f:
            try:
                rec = json.loads(raw)
            except Exception:
                skipped += 1
                continue
            t = rec.get("type")
            if t == "user":
                msg = rec.get("message", rec)
                body = render_user(msg)
                if not body:
                    continue
                out.append("## 👤 User\n\n")
                out.append(body.rstrip() + "\n\n---\n\n")
                lines_written += 1
            elif t == "assistant":
                msg = rec.get("message", {})
                body = render_assistant(msg)
                if not body.strip():
                    continue
                out.append("## 🤖 Claude\n\n")
                out.append(body.rstrip() + "\n\n---\n\n")
                lines_written += 1
            else:
                # ignore system / file-history-snapshot / permission-mode / etc.
                skipped += 1

    out_path.write_text("".join(out), encoding="utf-8")
    print(f"Wrote {out_path}  ({lines_written} turns, {skipped} non-conversational records skipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
