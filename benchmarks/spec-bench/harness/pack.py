"""A benchmark pack: a spec, plus what the harness needs to drive and score it.

The public directory benchmarks/<name>/ names the pack and may hold bench.json; the contents
(which packdir.py finds, private or in this repo) are:

    spec/               README.md, epics/<slug>.md, stories/NNN-slug/{story,prd,design,tasks}.md
    scope/<name>.json   optional named story lists: {"stories": [{"id": 1, "dir": "001-..."}],
                        "out_of_scope_note": "..."}
    prompts/story.md.tmpl   optional; otherwise benchmarks/spec-bench/prompts/story.md.tmpl
    acceptance/         optional held-out Playwright suite, tests/story-NN.spec.ts per story

bench.json (all keys optional): name, app_line and rules (for the generic template), gate (the
npm scripts every story must pass), default_scope, pack_ref (the private repo tag setup-node.sh
pins). A pack with none of these still runs, as a plain spec.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import packdir

STORY_DIR_RE = re.compile(r"^(\d+)-")
EPIC_ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|", re.M)
GENERIC_TEMPLATE = Path(__file__).resolve().parent.parent / "prompts" / "story.md.tmpl"
DEFAULT_GATE = ["build", "typecheck", "test:unit", "test:component", "test:integration", "test:e2e"]
DEFAULT_RULES = [
    "Follow the design: its repository layout, file names, named settings, exported interfaces, "
    "and the exact UI text the PRD and design specify.",
    "Work through tasks.md in order. Write the tests the design lists and make them pass. "
    "Do not delete or weaken tests to make them pass.",
    "Before you finish, run the project's build, typecheck and test commands, and fix failures.",
    "Do not ask questions; there is nobody to answer. Make a reasonable decision, note it in `NOTES.md`, "
    "and continue.",
    "When the story is complete, commit all work with git using the message `story {{ID}}: {{TITLE}}`.",
]


@dataclass
class Pack:
    public: Path          # benchmarks/<name> in this repo
    dir: Path             # where spec/ etc. actually live (private checkout or public)
    name: str
    config: dict = field(default_factory=dict)
    stories: dict[int, str] = field(default_factory=dict)  # id -> story folder name

    @property
    def spec(self) -> Path:
        return self.dir / "spec"

    @property
    def acceptance(self) -> Path | None:
        a = self.dir / "acceptance"
        return a if (a / "tests").is_dir() else None

    @property
    def template(self) -> Path:
        own = self.dir / "prompts" / "story.md.tmpl"
        return own if own.is_file() else GENERIC_TEMPLATE

    @property
    def gate(self) -> list[str]:
        return self.config.get("gate", DEFAULT_GATE)

    @property
    def default_scope(self) -> str | None:
        return self.config.get("default_scope")

    @property
    def pack_ref(self) -> str | None:
        return self.config.get("pack_ref")

    @property
    def app_line(self) -> str:
        return self.config.get("app_line",
                               f'You are implementing "{self.name}" in the current directory, one story at a time.')

    @property
    def rules(self) -> str:
        return "\n".join(f"{n}. {r}" for n, r in enumerate(self.config.get("rules", DEFAULT_RULES), 1))

    def title(self, story_dir: str) -> str:
        first = (self.spec / "stories" / story_dir / "story.md").read_text().splitlines()[0]
        return first.lstrip("# ").strip()

    def scope(self, scope: str | None = None, epic: str | None = None, ids: list[int] | None = None) -> dict:
        """-> {"name", "stories": [{"id", "dir"}...], "out_of_scope_note"}. A named scope, an epic's
        stories, or every story in the pack; ids then narrows the result."""
        if scope:
            doc = json.loads((self.dir / "scope" / f"{scope}.json").read_text())
            stories = [{"id": s["id"], "dir": s.get("dir") or self.stories[s["id"]]} for s in doc["stories"]]
            note = doc.get("out_of_scope_note", "")
            label = doc.get("name", scope)
        else:
            if epic:
                wanted = [int(x) for x in EPIC_ROW_RE.findall((self.spec / "epics" / f"{epic}.md").read_text())]
            else:
                wanted = sorted(self.stories)
            missing = [i for i in wanted if i not in self.stories]
            if missing:
                raise SystemExit(f"stories {missing} not found under {self.spec / 'stories'}")
            stories = [{"id": i, "dir": self.stories[i]} for i in wanted]
            note = ""
            label = f"epic:{epic}" if epic else "all"
        if ids:
            unknown = sorted(set(ids) - {s["id"] for s in stories})
            if unknown:
                raise SystemExit(f"stories {unknown} are not in the chosen scope")
            stories = [s for s in stories if s["id"] in ids]
        return {"name": label, "stories": stories, "out_of_scope_note": note}


def load(pack: str | Path = packdir.DEFAULT_PACK) -> Pack:
    public = packdir.public_dir(pack)
    where = packdir.resolve(pack)
    cfg = {}
    for candidate in (public / "bench.json", where / "bench.json"):
        if candidate.is_file():
            cfg = json.loads(candidate.read_text())
            break
    stories_dir = where / "spec" / "stories"
    if not stories_dir.is_dir():
        raise SystemExit(f"{where} is not a pack: no spec/stories/")
    stories = {int(m.group(1)): d.name for d in sorted(stories_dir.iterdir())
               if d.is_dir() and (m := STORY_DIR_RE.match(d.name))}
    return Pack(public=public, dir=where, name=cfg.get("name", public.name), config=cfg, stories=stories)
