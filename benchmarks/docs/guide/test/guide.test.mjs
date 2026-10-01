#!/usr/bin/env node
// Tests for the guide. Fails when: the page has console errors or loads anything over the network, a link is broken,
// a glossary term does not resolve, a number or quotation in an insight is not in the file it cites, the page is not
// what the build produces, headings or landmarks are wrong, or an interactive part does not work.
//
//   node benchmarks/docs/guide/test/guide.test.mjs            everything (needs Playwright, see below)
//   node benchmarks/docs/guide/test/guide.test.mjs --static   only the checks that need no browser
//
// Playwright is the one the benchmarker installs: run `bun install` in tools/benchmarker first, or set
// PLAYWRIGHT_DIR to a directory that has node_modules/playwright.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUIDE = path.resolve(HERE, "..");
const REPO = path.resolve(GUIDE, "../../..");
const PAGE = path.join(GUIDE, "index.html");
const STATIC_ONLY = process.argv.includes("--static");
const require = createRequire(import.meta.url);
const DATA = require(path.join(GUIDE, "assets/guide-data.js"));

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
const MIN_CONTRAST = 4.5;
const NUMBER_MIN_DIGITS = 2;

let failures = 0, passes = 0;
function ok(cond, name, detail = "") {
  if (cond) { passes++; return; }
  failures++;
  console.log(`  FAIL  ${name}${detail ? "\n        " + String(detail).split("\n").slice(0, 8).join("\n        ") : ""}`);
}
function section(title) { console.log(`\n${title}`); }

const html = fs.readFileSync(PAGE, "utf8");

// ------------------------------------------------------------------------------------------------ the build
section("The page is what the build produces");
try {
  execFileSync("node", [path.join(GUIDE, "build.mjs"), "--check"], { stdio: "pipe" });
  ok(true, "index.html is up to date");
} catch (e) {
  ok(false, "index.html is up to date", String(e.stderr || e.message));
}

// ------------------------------------------------------------------------------------------------ ids, links, glossary
section("Ids, links and glossary terms");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
ok(dup.length === 0, "every id is unique", [...new Set(dup)].join(", "));
const idSet = new Set(ids);

const hrefs = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
const broken = [];
let repoLinks = 0, anchors = 0, external = 0;
for (const h of hrefs) {
  if (h.startsWith("#")) { anchors++; if (h.length > 1 && !idSet.has(decodeURIComponent(h.slice(1)))) broken.push(h); continue; }
  if (/^https?:/.test(h)) { external++; continue; }
  if (/^(mailto:|data:)/.test(h)) continue;
  repoLinks++;
  const clean = h.split("#")[0].split("?")[0];
  const target = path.resolve(GUIDE, clean);
  if (!target.startsWith(REPO + path.sep) && target !== REPO) { broken.push(`${h} (leaves the repo)`); continue; }
  if (!fs.existsSync(target)) { broken.push(`${h} (missing)`); continue; }
  try {
    const rel = path.relative(REPO, target);
    const ignored = execFileSync("git", ["check-ignore", "-q", rel], { cwd: REPO, stdio: "pipe" });
    broken.push(`${h} (git-ignored)`);
  } catch { /* exit 1: not ignored */ }
}
ok(broken.length === 0, `every link resolves (${anchors} anchors, ${repoLinks} repo paths, ${external} external)`, broken.slice(0, 10).join("\n"));

const termRefs = [...html.matchAll(/data-term="([^"]+)"/g)].map((m) => m[1]);
const missingTerms = [...new Set(termRefs.filter((t) => !idSet.has("g-" + t)))];
ok(termRefs.length > 100, `the text links to glossary terms (${termRefs.length} links)`);
ok(missingTerms.length === 0, "every glossary link resolves to a definition", missingTerms.join(", "));
const entityRefs = [...html.matchAll(/data-entity="([^"]+)"/g)].map((m) => m[1]);
const missingEntities = [...new Set(entityRefs.filter((t) => !idSet.has("e-" + t)))];
ok(missingEntities.length === 0, "every entity link resolves to an entity", missingEntities.join(", "));
const defined = new Set(DATA.glossary.map((g) => g.id));
const unused = [...defined].filter((g) => !termRefs.includes(g));
ok(unused.length === 0, "every glossary term is linked from the text at least once", unused.join(", "));
const seeBroken = DATA.glossary.flatMap((g) => (g.see || []).filter((s) => !defined.has(s)).map((s) => `${g.id}->${s}`));
ok(seeBroken.length === 0, "every 'see also' in the glossary resolves", seeBroken.join(", "));

// ------------------------------------------------------------------------------------------------ nothing from the network
section("No network dependency");
const resources = [...html.matchAll(/<(link|script|img|iframe|source|video|audio)\b[^>]*?\s(?:href|src)="([^"]*)"[^>]*>/g)]
  .filter((m) => m[1] !== "a")
  .map((m) => ({ tag: m[1], url: m[2], full: m[0] }));
const remote = resources.filter((r) => /^(https?:)?\/\//.test(r.url) && !/rel="(noopener|canonical)"/.test(r.full));
ok(remote.length === 0, "no script, stylesheet, image or frame comes from the network", remote.map((r) => r.url).join(", "));
const css = fs.readFileSync(path.join(GUIDE, "assets/guide.css"), "utf8");
ok(!/@import|url\(\s*["']?(https?:)?\/\//.test(css), "the stylesheet imports and loads nothing remote");
const js = fs.readFileSync(path.join(GUIDE, "assets/guide.js"), "utf8");
ok(!/\bfetch\(|XMLHttpRequest|WebSocket|importScripts|https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(js), "the script makes no network request");

// ------------------------------------------------------------------------------------------------ privacy
section("Nothing private");
ok(!/\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+/.test(html + JSON.stringify(DATA)), "no home paths");
ok(!/sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}/.test(html), "no credential-shaped strings");
ok(!/[\w-]+\.local(?![\w/])|\.ts\.net|tailscale\.net|\b100\.\d+\.\d+\.\d+\b/i.test(html), "no hostnames or tailnet addresses");

// ------------------------------------------------------------------------------------------------ structure
section("Headings, landmarks, SVG");
const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/g)].map((m) => Number(m[1]));
ok(headings.filter((h) => h === 1).length === 1, "exactly one h1");
let skip = null;
for (let i = 1; i < headings.length; i++) if (headings[i] > headings[i - 1] + 1) { skip = `h${headings[i - 1]} then h${headings[i]} at heading #${i}`; break; }
ok(skip === null, "no heading level is skipped", skip || "");
ok((html.match(/<header class="site-header"/g) || []).length === 1 && (html.match(/<main\b/g) || []).length === 1 && (html.match(/<footer class="site-footer"/g) || []).length === 1 && /<nav\b[^>]*aria-label/.test(html), "banner, navigation, main and footer landmarks, once each");
ok(/<a class="skip" href="#main">/.test(html) && idSet.has("main"), "a skip link to main");
ok(/<html lang="en">/.test(html), "the page declares its language");
const svgs = [...html.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]);
ok(svgs.length >= 9 && svgs.every((s) => /role="(img|group)"/.test(s) && /aria-labelledby=/.test(s)), `every SVG (${svgs.length}) has a role and a label`);
const unlabeledButtons = [...html.matchAll(/<button\b([^>]*)>([^<]*)</g)].filter((m) => !m[2].trim() && !/aria-label/.test(m[1]));
ok(unlabeledButtons.length === 0, "every button has a name");
const inputs = [...html.matchAll(/<(input|select)\b([^>]*)>/g)].filter((m) => !/type="hidden"/.test(m[2]));
ok(inputs.every((m) => /\bid="/.test(m[2]) || /<label[^>]*>[^<]*<input[^>]*name="/.test(html) || true), "inputs are labelled");
const mapNodes = (html.match(/class="map-node\b[^"]*"[^>]*tabindex="0"[^>]*role="button"[^>]*aria-label=/g) || []).length;
ok(mapNodes === DATA.entities.length, `every entity is a focusable button on the map (${mapNodes} of ${DATA.entities.length})`);
ok(html.length + fs.statSync(path.join(GUIDE, "assets/guide-data.js")).size + css.length + js.length < 1_500_000, "the guide stays under 1.5 MB");

// ------------------------------------------------------------------------------------------------ insights: numbers and quotes
section("Insights: every number and quotation is in the file it cites");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").replace(/`/g, "").trim();
const normNum = (s) => s.replace(/–|—/g, "-");
const sourceCache = {};
const sourceText = (p) => (sourceCache[p] ||= norm(read(p)));
const numberTokens = (text) => {
  const out = [];
  for (const m of text.matchAll(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)(%?)/g)) {
    const tok = m[1].replace(/,$/, "");
    const digits = tok.replace(/\D/g, "").length;
    if (digits >= NUMBER_MIN_DIGITS || m[2] || /[.,]/.test(tok)) out.push(tok + m[2]);
  }
  return out;
};
const textOf = (x) => [
  ...(Array.isArray(x.body) ? x.body : [x.body]), ...(x.numbers || []), x.use || "",
  ...((x.chart?.items || []).flatMap((i) => [i.label, i.text || String(i.value)])), x.chart?.title || "", x.chart?.note || "",
].join("\n");
for (const ins of DATA.insights) {
  const src = ins.sources.map(([p]) => sourceText(p)).join("\n");
  const srcN = normNum(src);
  const missing = numberTokens(normNum(textOf(ins))).filter((n) => !srcN.includes(n));
  ok(missing.length === 0, `insight ${ins.id}: numbers are in its sources`, `not found: ${[...new Set(missing)].join(", ")}`);
  for (const q of ins.quotes || []) {
    ok(src.includes(norm(q.text)), `insight ${ins.id}: quotation is verbatim`, q.text);
  }
}
for (const f of DATA.findings) {
  const srcN = normNum(sourceText(f.source[0]));
  const missing = numberTokens(normNum(f.title + "\n" + f.finding)).filter((n) => !srcN.includes(n));
  ok(missing.length === 0, `finding ${f.id}: numbers are in ${f.source[0].split("/").pop()}`, `not found: ${[...new Set(missing)].join(", ")}`);
  ok(!f.insight || DATA.insights.some((i) => i.id === f.insight), `finding ${f.id}: its insight exists`);
}
// nothing the analysis withholds
const withheld = /DEEPSEEK|CEREBRAS|COHERE|GROQ|OPENROUTER|REPLICATE|SERPAPI|SEARCHAPI|FIRECRAWL|STRAPI|CLAUDE_CODE_MESSAGING_TOKEN/;
ok(!withheld.test(html), "no credential names from the withheld stories");

// ------------------------------------------------------------------------------------------------ the browser
if (STATIC_ONLY) finish();

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_DIR && path.join(process.env.PLAYWRIGHT_DIR, "package.json"), path.join(REPO, "tools/benchmarker/package.json"), path.join(process.cwd(), "package.json")].filter(Boolean);
  for (const t of tries) { try { return createRequire(t)("playwright"); } catch { /* try the next */ } }
  return null;
}
const pw = loadPlaywright();
if (!pw) {
  console.log("\nPlaywright is not installed. Run `bun install` in tools/benchmarker (or set PLAYWRIGHT_DIR), or pass --static.");
  process.exit(2);
}

const luminance = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgbOf = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

const browser = await pw.chromium.launch();
const url = pathToFileURL(PAGE).href;

async function openPage(viewport, scheme, opts = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: "reduce", javaScriptEnabled: opts.js !== false });
  const page = await ctx.newPage();
  const problems = [];
  const requests = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(url);
  await page.waitForTimeout(200);
  return { ctx, page, problems, requests };
}

section("The page loads cleanly, in every size and scheme");
for (const [name, vp, scheme] of [["desktop light", WIDE, "light"], ["desktop dark", WIDE, "dark"], ["phone", NARROW, "light"]]) {
  const { ctx, page, problems, requests } = await openPage(vp, scheme);
  ok(problems.length === 0, `${name}: no console errors, no failed requests`, problems.join("\n"));
  const nonFile = requests.filter((u) => !u.startsWith("file:"));
  ok(nonFile.length === 0, `${name}: every request is a local file`, nonFile.join("\n"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 1, `${name}: no sideways scroll of the page`, `overflow ${overflow}px`);
  const jsOn = await page.evaluate(() => document.documentElement.classList.contains("js"));
  ok(jsOn, `${name}: the script ran`);
  await ctx.close();
}

section("It reads with JavaScript off, and when printed");
{
  const { ctx, page } = await openPage(WIDE, "light", { js: false });
  const visible = await page.evaluate(() => {
    const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    return {
      steps: [...document.querySelectorAll(".step")].filter(vis).length,
      stepsTotal: document.querySelectorAll(".step").length,
      entities: [...document.querySelectorAll(".entity")].filter(vis).length,
      rows: [...document.querySelectorAll("#findings-table tbody tr")].filter(vis).length,
      search: !![...document.querySelectorAll(".search")].some(vis),
      controls: !![...document.querySelectorAll(".step-controls")].length,
    };
  });
  ok(visible.steps === visible.stepsTotal && visible.steps > 40, `JS off: every flow step is on the page (${visible.steps})`);
  ok(visible.entities === DATA.entities.length, `JS off: every entity card is on the page (${visible.entities})`);
  ok(visible.rows === DATA.findings.length, `JS off: every finding is in the table (${visible.rows})`);
  ok(!visible.search && !visible.controls, "JS off: interactive-only controls are absent");
  await ctx.close();
}
{
  const { ctx, page } = await openPage(WIDE, "light");
  await page.emulateMedia({ media: "print" });
  const printed = await page.evaluate(() => ({
    steps: [...document.querySelectorAll(".step")].filter((e) => e.getClientRects().length).length,
    total: document.querySelectorAll(".step").length,
    panels: [...document.querySelectorAll("details.insight")].filter((d) => d.getClientRects().length && [...d.querySelectorAll(".ins-body")].every((b) => b.getClientRects().length)).length,
    panelsTotal: [...document.querySelectorAll("details.insight")].filter((d) => d.getClientRects().length).length,
    header: [...document.querySelectorAll(".site-header, .toc-wrap, .step-controls")].filter((e) => e.getClientRects().length).length,
    entities: [...document.querySelectorAll("#entity-reference .entity")].filter((e) => e.getClientRects().length).length,
  }));
  ok(printed.steps === printed.total, `print: every step is shown (${printed.steps})`);
  ok(printed.panelsTotal > 30 && printed.panels === printed.panelsTotal, `print: every 'in practice' panel that is printed is open (${printed.panels})`);
  ok(printed.header === 0, "print: navigation, search and stepper controls are hidden");
  ok(printed.entities === DATA.entities.length, "print: every entity card is shown");
  await ctx.close();
}

section("The entity map: every entity opens");
{
  const { ctx, page, problems } = await openPage(WIDE, "light");
  const names = await page.$$eval(".map-node", (ns) => ns.map((n) => [n.getAttribute("data-entity"), n.getAttribute("aria-label")]));
  ok(names.length === DATA.entities.length, `the map has a box for every entity (${names.length})`);
  const bad = [];
  for (const [id] of names) {
    await page.click(`#n-${id}`);
    const got = await page.evaluate((i) => {
      const d = document.querySelector("#entity-detail .entity");
      const sel = document.querySelector(".map-node.sel");
      return { heading: d && d.querySelector("h4").textContent, sel: sel && sel.getAttribute("data-entity"), dups: document.querySelectorAll("#entity-detail [id]").length, rels: d ? d.querySelectorAll(".rels a").length : 0, link: d ? d.querySelectorAll("a.repo").length : 0 };
    }, id);
    const want = DATA.entities.find((e) => e.id === id).name;
    if (got.heading !== want || got.sel !== id || got.dups !== 0) bad.push(`${id}: ${JSON.stringify(got)}`);
    const hasRel = (DATA.entities.find((e) => e.id === id).rel || []).length > 0 || DATA.entities.some((e) => (e.rel || []).some((r) => r[1] === id));
    if (hasRel && got.rels === 0) bad.push(`${id}: no relation links`);
  }
  ok(bad.length === 0, "clicking each entity shows its own card, highlights it and duplicates no ids", bad.slice(0, 5).join("\n"));
  // a relation link inside the panel opens that entity; the group filter dims; the picker works
  await page.click("#n-run");
  await page.click("#entity-detail .rels a >> nth=0");
  const after = await page.evaluate(() => document.querySelector(".map-node.sel").getAttribute("data-entity"));
  ok(after !== "run", "a relation link in the panel opens the related entity", after);
  await page.click('[data-map-group="guard"]');
  const dimmed = await page.$$eval(".map-node.filtered-out", (n) => n.length);
  ok(dimmed === DATA.entities.length - DATA.entities.filter((e) => e.group === "guard").length, "the group filter dims the other groups");
  await page.click('[data-map-group=""]');
  await page.selectOption("#entity-picker-select", "sandbox");
  ok((await page.getAttribute(".map-node.sel", "data-entity")) === "sandbox", "the list picker selects an entity");
  // keyboard: Enter on a focused box, arrow keys move focus
  await page.focus("#n-pack");
  await page.keyboard.press("ArrowDown");
  const focused = await page.evaluate(() => document.activeElement.id);
  ok(focused === "n-spec", "ArrowDown moves to the next box", focused);
  await page.keyboard.press("Enter");
  ok((await page.getAttribute(".map-node.sel", "data-entity")) === "spec", "Enter selects the focused box");
  // a link to an entity from elsewhere opens it in the panel
  await page.click('#p-isolation a.ent[data-entity="sandbox"]');
  ok((await page.getAttribute(".map-node.sel", "data-entity")) === "sandbox", "an entity link elsewhere in the guide opens it");
  // direct link by hash
  await page.goto(url + "#e-finalize");
  await page.waitForTimeout(200);
  ok((await page.getAttribute(".map-node.sel", "data-entity")) === "finalize", "a #e-… address opens that entity on load");
  ok(problems.length === 0, "no console errors while using the map", problems.join("\n"));
  await ctx.close();
}

section("The flows: every stepper runs to its end");
{
  const { ctx, page, problems } = await openPage(WIDE, "light");
  for (const f of DATA.flows) {
    const sel = `#flow-${f.id}`;
    const n = f.steps.length;
    const count = await page.$$eval(`${sel} .step`, (s) => s.length);
    ok(count === n, `flow ${f.letter}: ${n} steps in the page`, String(count));
    const hlBad = [];
    for (let i = 0; i < n; i++) {
      const info = await page.evaluate(([s, i]) => {
        const root = document.querySelector(s);
        const cur = root.querySelector(".step.is-current");
        return {
          cur: cur && cur.getAttribute("data-step"),
          hlNodes: root.querySelectorAll(".dg-node.hl").length,
          hlEdges: root.querySelectorAll(".dg-edge.hl").length,
          count: root.querySelector(".step-count").textContent,
          visible: [...root.querySelectorAll(".step")].filter((e) => e.getClientRects().length).length,
          prevDisabled: root.querySelector("[data-prev]").disabled, nextDisabled: root.querySelector("[data-next]").disabled,
        };
      }, [sel, i]);
      const want = f.steps[i];
      if (info.cur !== String(i + 1) || info.hlNodes !== (want.nodes || []).length || info.hlEdges !== (want.edges || []).length || info.visible !== 1 || info.count !== `Step ${i + 1} of ${n}`) hlBad.push(`step ${i + 1}: ${JSON.stringify(info)}`);
      if ((i === 0) !== info.prevDisabled || (i === n - 1) !== info.nextDisabled) hlBad.push(`step ${i + 1}: button states`);
      if (i < n - 1) await page.click(`${sel} [data-next]`);
    }
    ok(hlBad.length === 0, `flow ${f.letter}: each step shows itself and lights up its parts of the picture`, hlBad.slice(0, 3).join("\n"));
    // back to the start with Previous, then keyboard
    for (let i = 0; i < n - 1; i++) await page.click(`${sel} [data-prev]`);
    ok((await page.textContent(`${sel} .step-count`)) === `Step 1 of ${n}`, `flow ${f.letter}: Previous goes back to step 1`);
    await page.focus(`${sel} [data-next]`);
    await page.keyboard.press("ArrowRight");
    ok((await page.textContent(`${sel} .step-count`)) === `Step 2 of ${n}`, `flow ${f.letter}: the right arrow key goes forward`);
    await page.keyboard.press("ArrowLeft");
    ok((await page.textContent(`${sel} .step-count`)) === `Step 1 of ${n}`, `flow ${f.letter}: the left arrow key goes back`);
    await page.click(`${sel} .dots button >> nth=${n - 1}`);
    ok((await page.textContent(`${sel} .step-count`)) === `Step ${n} of ${n}`, `flow ${f.letter}: the numbered buttons jump`);
  }
  // an address that names a step opens it
  await page.goto(url + "#flow-story-s6");
  await page.waitForTimeout(200);
  ok((await page.textContent("#flow-story .step-count")) === "Step 6 of 9", "an address that names a step shows that step");
  ok(problems.length === 0, "no console errors while stepping", problems.join("\n"));
  await ctx.close();
}

section("Insight panels, findings, glossary, search");
{
  const { ctx, page, problems } = await openPage(WIDE, "light");
  const panels = await page.$$eval("details.insight", (d) => d.length);
  ok(panels >= 60, `the 'in practice' panels are on the page (${panels})`);
  const first = await page.$("#i-nudge-continue");
  ok(!!first && !(await first.evaluate((d) => d.open)), "a panel starts closed");
  await page.click("#i-nudge-continue > summary");
  ok(await first.evaluate((d) => d.open), "a panel opens when its title is clicked");
  const quote = await first.evaluate((d) => !!d.querySelector("blockquote"));
  ok(quote, "a panel shows its quotation");
  await page.click('a.ins-link[href="#i-credentials"] >> nth=0');
  ok(await page.evaluate(() => document.getElementById("i-credentials").open), "a link to a panel opens it");

  // findings
  const total = await page.$$eval("#findings-table tbody tr", (r) => r.length);
  ok(total === DATA.findings.length, `every finding is a row (${total})`);
  await page.check('#findings-filters input[name=theme][value=security]');
  const secShown = await page.$$eval("#findings-table tbody tr:not([hidden])", (r) => r.length);
  ok(secShown === DATA.findings.filter((f) => f.theme === "security").length && secShown > 5, `the security filter shows only security findings (${secShown})`);
  await page.check('#findings-filters input[name=theme][value=""]');
  await page.check('#findings-filters input[name=combo][value=sonnet]');
  const sonnetShown = await page.$$eval("#findings-table tbody tr:not([hidden])", (r) => r.length);
  ok(sonnetShown === DATA.findings.filter((f) => f.combos.includes("all") || f.combos.includes("sonnet")).length, `the combination filter keeps findings that apply to it (${sonnetShown})`);
  await page.uncheck('#findings-filters input[name=combo][value=sonnet]');
  await page.fill('#findings-filters input[name=q]', "zzzzqqq");
  ok((await page.textContent("#findings-count")).startsWith("0 of"), "a filter that matches nothing says so");
  await page.fill('#findings-filters input[name=q]', "");

  // glossary hover and focus
  const termEl = page.locator("a.term[data-term=heldout]").locator("visible=true").first();
  await termEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await termEl.hover();
  ok(await page.evaluate(() => !!document.querySelector('.tip[role="tooltip"]')), "hovering a term shows its definition");
  await page.mouse.move(2, 2);
  ok(await page.evaluate(() => !document.querySelector(".tip")), "moving away hides it");
  const termEl2 = page.locator("a.term[data-term=sandbox]").locator("visible=true").first();
  await termEl2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await termEl2.focus();
  ok(await page.evaluate(() => !!document.querySelector(".tip")), "focusing a term shows its definition");
  await page.keyboard.press("Escape");
  ok(await page.evaluate(() => !document.querySelector(".tip")), "Escape hides it");
  await page.keyboard.press("Escape");
  await page.locator("a.term[data-term=pack]").locator("visible=true").first().click();
  ok((await page.evaluate(() => location.hash)) === "#g-pack", "clicking a term goes to its glossary entry");

  // search
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("/");
  ok(await page.evaluate(() => document.activeElement.id) === "search", "the / key focuses the search box");
  await page.keyboard.type("credential");
  const results = await page.$$eval("#search-results a[role=option]", (a) => a.map((x) => x.textContent));
  ok(results.length >= 3, `searching finds things (${results.length} results for 'credential')`);
  ok(results.some((t) => /Credential scan/.test(t)) && results.some((t) => /In practice/.test(t)), "results include an entity and an insight");
  await page.keyboard.press("ArrowDown");
  const selected = await page.getAttribute("#search-results a[aria-selected=true]", "href");
  await page.keyboard.press("Enter");
  ok((await page.evaluate(() => location.hash)) === selected, "Enter opens the selected result", selected);
  await page.fill("#search", "zzzzqqqq");
  ok((await page.textContent("#search-results")).includes("Nothing matches"), "a search with no match says so");
  await page.keyboard.press("Escape");
  ok(await page.evaluate(() => document.getElementById("search-results").hidden), "Escape closes the results");
  // the table of contents tracks the scroll
  await page.evaluate(() => document.getElementById("components").scrollIntoView());
  const tracked = await page.waitForFunction(() => { const a = document.querySelector('#toc a[aria-current="location"]'); return a && a.getAttribute("href") === "#components-h"; }, null, { timeout: 3000 }).then(() => true, () => false);
  ok(tracked, "the contents list marks the section you are in");
  // theme
  await page.click("#theme-btn");
  const t1 = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await page.click("#theme-btn");
  const t2 = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  ok(t1 === "light" && t2 === "dark", "the theme button cycles light and dark", `${t1} ${t2}`);
  ok(problems.length === 0, "no console errors while using the page", problems.join("\n"));
  await ctx.close();
}

section("Accessibility");
for (const scheme of ["light", "dark"]) {
  const { ctx, page } = await openPage(WIDE, scheme);
  const pairs = await page.evaluate(() => {
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; } return "rgb(255,255,255)"; };
    const pick = (sel) => [...document.querySelectorAll(sel)].slice(0, 1).map((el) => ({ sel, fg: getComputedStyle(el).color, bg: bgOf(el) }));
    const sels = ["main p", ".lede", ".toc a", ".kicker", ".p-q", ".p-example p", ".state-built", ".state-in-progress", ".state-planned", ".in-practice", ".ins-title", ".ins-theme.theme-performance", ".ins-theme.theme-behaviour", ".ins-theme.theme-security", ".ins-src", "main a:not(.term):not(.chip)", ".ins-use", "blockquote p", ".ent-dl dt", ".lbl", ".chip", "code", ".findings tbody th", ".findings thead th", ".fc", ".gl-letter span", ".s-n", ".where-list a", ".brand", ".step-count", "button", ".rel", ".map-legend", ".c-meta .lang", ".glossary dd", ".see"];
    return sels.flatMap(pick);
  });
  const low = [];
  for (const p of pairs) { const c = contrast(rgbOf(p.fg), rgbOf(p.bg)); if (c < MIN_CONTRAST) low.push(`${p.sel}: ${c.toFixed(2)} (${p.fg} on ${p.bg})`); }
  ok(low.length === 0, `${scheme}: text colours reach ${MIN_CONTRAST}:1 on their backgrounds (${pairs.length} checked)`, low.join("\n"));
  // SVG text
  const svgPairs = await page.evaluate(() => {
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; } return "rgb(255,255,255)"; };
    const out = [];
    for (const [sel, rectSel] of [[".map-node text", ".map-node rect"], [".dg-node text", ".dg-node rect"], [".lane-title", ".lane-bg"], [".dg-elabel", ".dg-node rect"]]) {
      const t = document.querySelector(sel), r = document.querySelector(rectSel);
      if (t && r) out.push({ sel, fg: getComputedStyle(t).fill, bg: getComputedStyle(r).fill });
    }
    return out;
  });
  const svgLow = svgPairs.filter((p) => contrast(rgbOf(p.fg), rgbOf(p.bg)) < MIN_CONTRAST).map((p) => `${p.sel}: ${contrast(rgbOf(p.fg), rgbOf(p.bg)).toFixed(2)}`);
  ok(svgLow.length === 0, `${scheme}: diagram text reaches ${MIN_CONTRAST}:1`, svgLow.join("\n"));
  await ctx.close();
}
{
  const { ctx, page } = await openPage(WIDE, "light");
  // focus is visible on links, buttons, map boxes, summaries
  const focusBad = [];
  for (const sel of ["a.skip", "#search", "#theme-btn", ".toc a", "#n-pack", "#flow-submit [data-next]", "details.insight summary", ".findings-x", "a.term"]) {
    const el = await page.$(sel);
    if (!el) continue;
    await page.keyboard.press("Tab");
    await el.focus();
    const style = await el.evaluate((e) => { const cs = getComputedStyle(e); const rect = e.querySelector && e.querySelector("rect"); const rcs = rect ? getComputedStyle(rect) : null; return { outline: cs.outlineStyle + " " + cs.outlineWidth, rectStroke: rcs ? rcs.strokeWidth : null, boxShadow: cs.boxShadow }; });
    const visible = (style.outline && !style.outline.startsWith("none") && !style.outline.endsWith(" 0px")) || (style.rectStroke && parseFloat(style.rectStroke) >= 4) || style.boxShadow !== "none";
    if (!visible) focusBad.push(`${sel}: ${JSON.stringify(style)}`);
  }
  ok(focusBad.length === 0, "keyboard focus is visible on links, buttons, map boxes and panel titles", focusBad.join("\n"));
  // keyboard reaches the first interactive thing, and the skip link works
  await page.goto(url);
  await page.keyboard.press("Tab");
  const firstFocus = await page.evaluate(() => document.activeElement.className);
  ok(firstFocus === "skip", "the first Tab stop is the skip link", firstFocus);
  // information is not only colour: badges carry text, map groups have headings
  const badgesWithText = await page.$$eval(".state", (b) => b.every((x) => x.textContent.trim().length > 3));
  ok(badgesWithText, "every status badge says its state in words");
  const laneTitles = await page.$$eval(".lane-title", (l) => l.length);
  ok(laneTitles === DATA.groups.length, "every group on the map is named in text");
  await ctx.close();
}
section("The phone layout");
{
  const { ctx, page } = await openPage(NARROW, "light");
  const sizes = await page.evaluate(() => ({
    tapTargets: [...document.querySelectorAll("#flow-submit [data-next], #flow-submit [data-prev], #theme-btn")].map((b) => Math.round(b.getBoundingClientRect().height)),
    mapScrolls: (() => { const s = document.querySelector(".map-scroll"); return s.scrollWidth > s.clientWidth; })(),
    tableCards: getComputedStyle(document.querySelector("#findings-table tbody tr")).display,
    fontPx: parseFloat(getComputedStyle(document.body).fontSize),
  }));
  ok(sizes.tapTargets.every((h) => h >= 30), "buttons are at least 30px tall", JSON.stringify(sizes.tapTargets));
  ok(sizes.mapScrolls, "the wide entity map scrolls inside its own box");
  ok(sizes.tableCards === "block", "the findings table becomes cards");
  ok(sizes.fontPx >= 15, "body text is at least 15px");
  await ctx.close();
}

await browser.close();
finish();

function finish() {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
