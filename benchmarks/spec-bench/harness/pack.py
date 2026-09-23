"""A benchmark pack: a spec plus what the harness needs to drive and score it.

    <pack>/
      bench.json          name, app_line, readme, rules, stack, gate, serve (see benchmarks/vidi)
      spec/               README.md, epics/<slug>.md, stories/NNN-slug/{story,prd,design,tasks}.md
      scope/<name>.json   optional named story lists: {"stories": [{"id": 1}, ...], "out_of_scope_note": ...}
      acceptance/         optional held-out Playwright suite, tests/story-NN.spec.ts per story

Stories are found by the numeric prefix of their folder, so a scope only names ids.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

STORY_DIR_RE = re.compile(r"^(\d+)-")
EPIC_ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|", re.M)
DEFAULT_GATE = ["build", "typecheck", "test:unit", "test:component", "test:integration", "test:e2e"]
DEFAULT_RULES = [
    "Follow the design: its repository layout, file names, named settings, exported interfaces, "
    "and the exact UI text the PRD and design specify.",
    "Work through tasks.md in order. Write the tests the design lists and make them pass. "
    "Do not delete or weaken tests to make them pass.",
    "Before you finish, run the project's build, typecheck and test commands, and fix failures.",
    "Do not ask questions; there is nobody to answer. Make a reasonable decision, note it in `NOTES.md`, and continue.",
    "When the story is complete, commit all work with git using the message `story {{ID}}: {{TITLE}}`.",
]


@dataclass
class Pack:
    dir: Path
    name: str
    app_line: str
    readme: str
    rules: list[str]
    stack: str
    gate: list[str]
    serve: str | None
    stories: dict[int, str] = field(default_factory=dict)  # id -> story folder name

    @property
    def spec(self) -> Path:
        return self.dir / "spec"

    @property
    def acceptance(self) -> Path | None:
        a = self.dir / "acceptance"
        return a if (a / "tests").is_dir() else None

    def title(self, sid: int) -> str:
        first = (self.spec / "stories" / self.stories[sid] / "story.md").read_text().splitlines()[0]
        return first.lstrip("# ").strip()

    def resolve_scope(self, scope: str | None = None, epic: str | None = None,
                      ids: list[int] | None = None) -> dict:
        """-> {"stories": [{"id", "dir"}...], "out_of_scope_note": str}. Exactly one selector, or all stories."""
        note = ""
        if scope:
            doc = json.loads((self.dir / "scope" / f"{scope}.json").read_text())
            ids = [s["id"] for s in doc["stories"]]
            note = doc.get("out_of_scope_note", "")
        elif epic:
            ids = [int(x) for x in EPIC_ROW_RE.findall((self.spec / "epics" / f"{epic}.md").read_text())]
        elif not ids:
            ids = sorted(self.stories)
        missing = [i for i in ids if i not in self.stories]
        if missing:
            raise SystemExit(f"stories {missing} not found under {self.spec / 'stories'}")
        return {"stories": [{"id": i, "dir": self.stories[i]} for i in ids], "out_of_scope_note": note}

    def render_prompt(self, sid: int, done: list[int], note: str, template: str) -> str:
        title = self.title(sid)
        rules = "\n".join(f"{n}. {r}" for n, r in enumerate(self.rules, 1))
        return (template
                .replace("{{APP_LINE}}", self.app_line)
                .replace("{{RULES}}", rules)
                .replace("{{ID}}", str(sid))
                .replace("{{TITLE}}", title)
                .replace("{{SPEC_DIR}}", "spec/")
                .replace("{{STORY_DIR}}", f"spec/stories/{self.stories[sid]}")
                .replace("{{DONE}}", ", ".join(map(str, done)) if done else "none (empty repository)")
                .replace("{{SCOPE_NOTE}}", note))


def load(pack_dir: Path) -> Pack:
    pack_dir = pack_dir.resolve()
    cfg_path = pack_dir / "bench.json"
    cfg = json.loads(cfg_path.read_text()) if cfg_path.exists() else {}
    stories_dir = pack_dir / "spec" / "stories"
    if not stories_dir.is_dir():
        raise SystemExit(f"{pack_dir} is not a pack: no spec/stories/")
    stories = {int(m.group(1)): d.name for d in sorted(stories_dir.iterdir())
               if d.is_dir() and (m := STORY_DIR_RE.match(d.name))}
    name = cfg.get("name", pack_dir.name)
    readme = pack_dir / "spec" / "README.md"
    return Pack(
        dir=pack_dir,
        name=name,
        app_line=cfg.get("app_line", f'You are implementing "{name}" in the current directory, one story at a time.'),
        readme=cfg.get("readme", f"# {name}\n"),
        rules=cfg.get("rules", DEFAULT_RULES),
        stack=cfg.get("stack", "node-web"),
        gate=cfg.get("gate", DEFAULT_GATE),
        serve=cfg.get("serve"),
        stories=stories,
    )
