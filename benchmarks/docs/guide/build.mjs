#!/usr/bin/env node
// Builds index.html from src/page.tpl and assets/guide-data.js. No dependencies.
//
//   node benchmarks/docs/guide/build.mjs            write index.html
//   node benchmarks/docs/guide/build.mjs --check    exit 1 if index.html is not what the build produces
//
// Why a build: the guide's content (entities, flows, insights, glossary) lives in one data file so it can be
// kept up to date in one place. The page itself has that content written into the HTML, so it reads with
// JavaScript off and opens from disk with no network; guide.js only adds the interaction on top.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const D = require("./assets/guide-data.js");
const REPO_PREFIX = "../../../"; // from benchmarks/docs/guide/ to the repository root

// ---- geometry constants (SVG units) -------------------------------------------------------------------------
const FLOW_FONT = 14;
const FLOW_LINE = 17;
const FLOW_PAD_X = 12;
const FLOW_PAD_Y = 9;
const CHAR_W = 7.3;
const MAP_LANE_W = 150;
const MAP_LANE_GAP = 32;
const MAP_LANE_X0 = 8;
const MAP_HEAD_H = 44;
const MAP_ROW_H = 50;
const MAP_NODE_W = 132;
const MAP_NODE_H = 38;

const fail = (m) => { throw new Error("guide build: " + m); };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = (s) => String(s).replace(/`/g, "");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- lookups ------------------------------------------------------------------------------------------------
const by = (arr, key = "id") => Object.fromEntries(arr.map((x) => [x[key], x]));
const ENT = by(D.entities);
const GRP = by(D.groups);
const GLO = by(D.glossary);
const FLW = by(D.flows);
const INS = by(D.insights);
const PRB = by(D.problems);
const COMP = by(D.components);
for (const [name, list] of [["entity", D.entities], ["glossary", D.glossary], ["flow", D.flows], ["insight", D.insights], ["problem", D.problems], ["component", D.components]]) {
  const seen = new Set();
  for (const x of list) { if (seen.has(x.id)) fail(`duplicate ${name} id ${x.id}`); seen.add(x.id); }
}

// ---- inline markup ------------------------------------------------------------------------------------------
// `code`, **bold**, {g:term|text} glossary, {e:entity|text}, {f:flow|text}, {i:insight|text}, {p:problem|text},
// {c:component|text}, [text](repo/path or https://…).
export function repoHref(p) {
  if (/^(https?:|#|mailto:)/.test(p)) return p;
  return REPO_PREFIX + p;
}

function term(id, text) {
  if (!GLO[id]) fail(`unknown glossary term {g:${id}}`);
  return `<a class="term" href="#g-${id}" data-term="${id}">${text}</a>`;
}

function markup(src, doEsc) {
  const codes = [];
  let s = String(src).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  if (doEsc) s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\{g:([a-z0-9-]+)(?:\|([^}]*))?\}/g, (_, id, t) => term(id, t ?? (GLO[id] ? esc(GLO[id].term) : id)));
  s = s.replace(/\{e:([a-z0-9-]+)(?:\|([^}]*))?\}/g, (_, id, t) => {
    if (!ENT[id]) fail(`unknown entity {e:${id}}`);
    return `<a class="ent" href="#e-${id}" data-entity="${id}">${t ?? esc(ENT[id].name)}</a>`;
  });
  s = s.replace(/\{f:([a-z0-9-]+)(?:\|([^}]*))?\}/g, (_, id, t) => {
    if (!FLW[id]) fail(`unknown flow {f:${id}}`);
    return `<a href="#flow-${id}">${t ?? esc(FLW[id].short)}</a>`;
  });
  s = s.replace(/\{i:([a-z0-9-]+)(?:\|([^}]*))?\}/g, (_, id, t) => {
    if (!INS[id]) fail(`unknown insight {i:${id}}`);
    return `<a class="ins-link" href="#i-${id}" data-insight="${id}">${t ?? esc(INS[id].title)}</a>`;
  });
  s = s.replace(/\{p:([a-z0-9-]+)(?:\|([^}]*))?\}/g, (_, id, t) => {
    if (!PRB[id]) fail(`unknown problem {p:${id}}`);
    return `<a href="#p-${id}">${t ?? esc(PRB[id].title)}</a>`;
  });
  s = s.replace(/\{c:([a-z0-9-]+)(?:\|([^}]*))?\}/g, (_, id, t) => {
    if (!COMP[id]) fail(`unknown component {c:${id}}`);
    return `<a href="#c-${id}">${t ?? esc(COMP[id].name)}</a>`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
    const href = repoHref(u.replace(/&amp;/g, "&"));
    const ext = /^https?:/.test(href);
    return `<a href="${esc(href)}"${ext ? ' rel="noopener" class="ext"' : ' class="repo"'}>${t}</a>`;
  });
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  return s;
}
export const inline = (src) => markup(src, true);
const para = (s) => `<p>${inline(s)}</p>`;
const paras = (a) => (Array.isArray(a) ? a : [a]).map(para).join("\n");
const li = (a) => a.map((x) => `<li>${inline(x)}</li>`).join("");
const repoLinks = (a) => (a || []).map(([p, label]) => `<li><a class="repo" href="${esc(repoHref(p))}">${esc(plain(label || p))}</a></li>`).join("");

const STATE = {
  built: { label: "Built", sym: "\u2713" },
  "in-progress": { label: "In progress", sym: "\u25D0" },
  planned: { label: "Planned", sym: "\u25CB" },
  idea: { label: "Idea only", sym: "\u25CB" },
};
const badge = (state, text) => {
  const st = STATE[state] || fail(`unknown state ${state}`);
  return `<span class="state state-${state}"><span aria-hidden="true">${st.sym}</span> ${esc(text || st.label)}</span>`;
};

// ---- insights (panels) --------------------------------------------------------------------------------------
const THEMES = { performance: "Performance", behaviour: "Behaviour", security: "Security", method: "Method" };

function chart(c) {
  if (!c) return "";
  const max = Math.max(...c.items.map((i) => i.value));
  const rows = c.items.map((i) => {
    const pct = Math.max(2, Math.round((i.value / max) * 100));
    return `<li><span class="bar-label">${esc(i.label)}</span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${pct}%"></span></span><span class="bar-value">${esc(i.text ?? String(i.value))}</span></li>`;
  }).join("");
  return `<figure class="bars"><figcaption>${inline(c.title)}</figcaption><ul>${rows}</ul>${c.note ? `<p class="bars-note">${inline(c.note)}</p>` : ""}</figure>`;
}

function insightPanel(id, { first = true } = {}) {
  const x = INS[id] || fail(`unknown insight ${id}`);
  const themeName = THEMES[x.theme] || fail(`unknown theme ${x.theme}`);
  const combos = (x.combos || []).map(esc).join(", ");
  const src = x.sources.map(([p, label]) => `<a class="repo" href="${esc(repoHref(p))}">${esc(label)}</a>`).join("; ");
  const quotes = (x.quotes || []).map((q) => `<blockquote><p>${esc(q.text)}</p><footer>${esc(q.who)}</footer></blockquote>`).join("");
  const ident = first ? ` id="i-${id}" data-search data-title="${esc(x.title)}"` : "";
  return `<details class="insight"${ident} data-insight="${id}" data-theme="${x.theme}">
<summary><span class="in-practice">In practice</span><span class="ins-title">${esc(x.title)}</span><span class="ins-theme theme-${x.theme}">${themeName}</span></summary>
<div class="ins-body">
${paras(x.body)}
${x.numbers ? `<ul class="ins-nums">${li(x.numbers)}</ul>` : ""}
${chart(x.chart)}
${quotes}
${x.use ? `<p class="ins-use"><strong>What it led to.</strong> ${inline(x.use)}</p>` : ""}
<p class="ins-src">Combinations: ${combos || "all"}. Source: ${src}.</p>
</div>
</details>`;
}
const placed = new Set();
function insightsAt(kind, id, ids) {
  // Every place an insight illustrates shows its panel; only the first one carries the id that links and search use.
  return (ids || []).map((iid) => {
    if (!INS[iid]) fail(`unknown insight ${iid} at ${kind}:${id}`);
    const first = !placed.has(iid);
    placed.add(iid);
    return insightPanel(iid, { first });
  }).join("\n");
}

// ---- problems -----------------------------------------------------------------------------------------------
function renderProblems() {
  return D.problems.map((p) => {
    const ents = (p.entities || []).map((e) => `<a class="ent chip" href="#e-${e}" data-entity="${e}">${esc(ENT[e]?.name || fail("entity " + e))}</a>`).join(" ");
    const flows = (p.flows || []).map((f) => `<a class="chip" href="#flow-${f}">${esc(FLW[f]?.short || fail("flow " + f))}</a>`).join(" ");
    return `<article class="problem" id="p-${p.id}" data-search data-title="${esc(p.title)}">
<h3 id="ph-${p.id}" data-toc="${esc(p.title)}"><span class="p-n">${p.n}</span> ${esc(p.title)}</h3>
<p class="p-q">${inline(p.question)}</p>
${paras(p.text)}
<div class="p-example"><h4>A concrete case</h4>${paras(p.example)}</div>
${insightsAt("problem", p.id, p.insights)}
${p.control ? `<p class="p-control"><strong>How the system deals with it.</strong> ${inline(p.control)}</p>` : ""}
<p class="p-links"><span class="lbl">Entities:</span> ${ents} ${flows ? `<span class="lbl">Flows:</span> ${flows}` : ""}</p>
</article>`;
  }).join("\n");
}

// ---- entities -----------------------------------------------------------------------------------------------
const incoming = {};
for (const e of D.entities) {
  for (const r of e.rel || []) {
    const [label, to] = r;
    if (!ENT[to]) fail(`entity ${e.id} relates to unknown entity ${to}`);
    (incoming[to] ||= []).push([label, e.id]);
  }
}
for (const e of D.entities) {
  if (!GRP[e.group]) fail(`entity ${e.id} has unknown group ${e.group}`);
}

function entityCard(e) {
  const g = GRP[e.group];
  const out = (e.rel || []).map(([label, to]) => `<li><span class="rel">${esc(label)}</span> <a class="ent" href="#e-${to}" data-entity="${to}">${esc(ENT[to].name)}</a></li>`).join("");
  const inn = (incoming[e.id] || []).map(([label, from]) => `<li><a class="ent" href="#e-${from}" data-entity="${from}">${esc(ENT[from].name)}</a> <span class="rel">${esc(label)}</span> this</li>`).join("");
  const st = e.status ? `<dt>Status</dt><dd>${badge(e.status.state)} ${inline(e.status.note || "")}</dd>` : "";
  return `<article class="entity" id="e-${e.id}" data-entity="${e.id}" data-group="${e.group}" data-search data-title="${esc(e.name)}" tabindex="-1">
<header class="ent-head"><span class="gbadge g-${e.group}" aria-hidden="true">${esc(g.badge)}</span><div><h4>${esc(e.name)}</h4><p class="ent-group">${esc(g.name)}</p></div></header>
<p class="what">${inline(e.what)}</p>
<dl class="ent-dl">
${e.contains?.length ? `<dt>Contains</dt><dd><ul>${li(e.contains)}</ul></dd>` : ""}
<dt>Relates to</dt><dd>${out ? `<ul class="rels">${out}</ul>` : ""}${inn ? `<ul class="rels in">${inn}</ul>` : ""}</dd>
${e.repo?.length ? `<dt>Where it lives</dt><dd><ul>${repoLinks(e.repo)}</ul></dd>` : ""}
<dt>A real example</dt><dd>${inline(e.example)}</dd>
${st}
</dl>
${insightsAt("entity", e.id, e.insights)}
</article>`;
}

function renderEntityCards() {
  return D.groups.map((g) => {
    const list = D.entities.filter((e) => e.group === g.id).sort((a, b) => a.row - b.row);
    return `<section class="ent-group-block" data-group="${g.id}" aria-labelledby="eg-${g.id}">
<h3 class="group-h" id="eg-${g.id}"><span class="gbadge g-${g.id}" aria-hidden="true">${esc(g.badge)}</span> ${esc(g.name)} <span class="group-blurb">${inline(g.blurb)}</span></h3>
<div class="ent-cards">${list.map(entityCard).join("\n")}</div>
</section>`;
  }).join("\n");
}

function renderMap() {
  const lanes = D.groups;
  const maxRows = Math.max(...lanes.map((g) => D.entities.filter((e) => e.group === g.id).length));
  const H = MAP_HEAD_H + maxRows * MAP_ROW_H + 24;
  const MAP_W = MAP_LANE_X0 * 2 + lanes.length * MAP_LANE_W + (lanes.length - 1) * MAP_LANE_GAP;
  const laneX = (i) => MAP_LANE_X0 + i * (MAP_LANE_W + MAP_LANE_GAP);
  const pos = {};
  lanes.forEach((g, i) => {
    D.entities.filter((e) => e.group === g.id).sort((a, b) => a.row - b.row).forEach((e, r) => {
      pos[e.id] = { x: laneX(i) + (MAP_LANE_W - MAP_NODE_W) / 2, y: MAP_HEAD_H + 8 + r * MAP_ROW_H, lane: i, row: r };
    });
  });
  const parts = [];
  parts.push(`<svg class="map-svg" id="entity-map-svg" viewBox="0 0 ${MAP_W} ${H}" role="group" aria-labelledby="map-title map-desc" xmlns="http://www.w3.org/2000/svg">`);
  parts.push(`<title id="map-title">Entity map</title><desc id="map-desc">${esc(D.mapDesc)}</desc>`);
  parts.push(`<defs><marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrow-head"/></marker></defs>`);
  lanes.forEach((g, i) => {
    parts.push(`<g class="lane g-${g.id}" data-group="${g.id}"><rect class="lane-bg" x="${laneX(i)}" y="2" width="${MAP_LANE_W}" height="${H - 4}" rx="10"/><text class="lane-title" x="${laneX(i) + MAP_LANE_W / 2}" y="26" text-anchor="middle">${esc(g.name)}</text></g>`);
  });
  // edges first, under the nodes
  const edgeEls = [];
  for (const e of D.entities) {
    for (const r of e.rel || []) {
      const [label, to, opt] = r;
      if (opt && opt.nomap) continue;
      const a = pos[e.id], b = pos[to];
      let d;
      if (a.lane === b.lane) {
        const x = a.x + MAP_NODE_W, y1 = a.y + MAP_NODE_H / 2, y2 = b.y + MAP_NODE_H / 2;
        const bulge = 14 + 5 * Math.abs(a.row - b.row);
        d = `M${x},${y1} C${x + bulge},${y1} ${x + bulge},${y2} ${x},${y2}`;
      } else {
        const right = b.lane > a.lane;
        const x1 = right ? a.x + MAP_NODE_W : a.x, x2 = right ? b.x : b.x + MAP_NODE_W;
        const y1 = a.y + MAP_NODE_H / 2, y2 = b.y + MAP_NODE_H / 2;
        const dx = Math.max(30, Math.abs(x2 - x1) * 0.5) * (right ? 1 : -1);
        d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      }
      edgeEls.push(`<path class="map-edge" data-from="${e.id}" data-to="${to}" data-label="${esc(label)}" d="${d}" marker-end="url(#map-arrow)"/>`);
    }
  }
  parts.push(`<g class="map-edges">${edgeEls.join("")}</g>`);
  for (const e of D.entities) {
    const p = pos[e.id];
    const lines = splitLabel(e.mapLabel || e.name, 20);
    const ty = p.y + MAP_NODE_H / 2 - ((lines.length - 1) * 8) + 5;
    const inprog = e.status?.state === "in-progress";
    parts.push(`<g class="map-node g-${e.group}${inprog ? " st-in-progress" : ""}" id="n-${e.id}" data-entity="${e.id}" data-group="${e.group}" tabindex="0" role="button" aria-label="${esc(e.name)}: ${esc(plain(e.short))}${inprog ? " (in progress)" : ""}"><title>${esc(e.name)}: ${esc(plain(e.short))}${inprog ? " (in progress)" : ""}</title><rect x="${p.x}" y="${p.y}" width="${MAP_NODE_W}" height="${MAP_NODE_H}" rx="8"/>${inprog ? `<text class="map-flag" x="${p.x + MAP_NODE_W - 6}" y="${p.y + 12}" text-anchor="end" aria-hidden="true">\u25D0</text>` : ""}${lines.map((ln, k) => `<text x="${p.x + MAP_NODE_W / 2}" y="${ty + k * 16}" text-anchor="middle">${esc(ln)}</text>`).join("")}</g>`);
  }
  parts.push(`<g class="map-labels" aria-hidden="true"></g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

function renderMapShell() {
  const chips = D.groups.map((g) => `<button type="button" data-map-group="${g.id}" aria-pressed="false">${esc(g.name)}</button>`).join("");
  return `<div class="map-shell" id="entity-map">
<div class="map-controls" hidden><span class="lbl" id="map-filter-lbl">Show group:</span><div class="chips" role="group" aria-labelledby="map-filter-lbl"><button type="button" data-map-group="" aria-pressed="true">All</button>${chips}</div></div>
<div class="entity-picker" id="entity-picker" hidden><label for="entity-picker-select">Or pick an entity from a list: </label><select id="entity-picker-select"><option value="">Choose an entity</option></select></div>
<div class="map-scroll" tabindex="0" role="region" aria-label="Entity map. It scrolls sideways on narrow screens.">
${renderMap()}
</div>
<p class="map-legend">Each box is an entity. A line reads &ldquo;this box, then the label, then that box&rdquo;. Select a box (click, or Enter) to light up what it relates to; the arrow keys move between boxes. A dashed line points <em>into</em> the selected box. A box with a dashed outline and a half-filled circle (\u25D0) is something that is built or on main but not yet in use: its card says what.</p>
<div id="entity-detail" class="map-detail" tabindex="-1" role="region" aria-live="polite" aria-label="Entity details"><p class="map-empty">Select an entity above to see it here.</p></div>
</div>`;
}

function splitLabel(s, max) {
  if (s.length <= max) return [s];
  const words = s.split(" ");
  const out = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

// ---- components ---------------------------------------------------------------------------------------------
function renderComponents() {
  return D.components.map((c) => `<article class="component" id="c-${c.id}" data-search data-title="${esc(c.name)}">
<header><h3>${esc(c.name)}</h3><p class="c-meta"><span class="lang">${esc(c.lang)}</span> ${c.status ? badge(c.status.state, c.status.label) : ""}</p>${c.status?.note ? `<p class="c-note">${inline(c.status.note)}</p>` : ""}</header>
<p class="what">${inline(c.what)}</p>
<dl class="c-dl">
<dt>Why it exists</dt><dd>${inline(c.why)}</dd>
<dt>Takes in</dt><dd>${inline(c.inputs)}</dd>
<dt>Puts out</dt><dd>${inline(c.outputs)}</dd>
<dt>How it fails</dt><dd>${inline(c.fails)}</dd>
<dt>Where</dt><dd><ul>${repoLinks(c.repo)}</ul></dd>
${c.entities?.length ? `<dt>Entities</dt><dd>${c.entities.map((e) => `<a class="ent chip" href="#e-${e}" data-entity="${e}">${esc(ENT[e]?.name || fail("entity " + e))}</a>`).join(" ")}</dd>` : ""}
</dl>
${insightsAt("component", c.id, c.insights)}
</article>`).join("\n");
}

// ---- flows (diagram + stepper) ------------------------------------------------------------------------------
function nodeBox(n) {
  const lines = String(n.label).split("\n");
  const w = n.w ?? Math.ceil(Math.max(...lines.map((l) => l.length)) * CHAR_W + 2 * FLOW_PAD_X);
  const h = n.h ?? Math.ceil(lines.length * FLOW_LINE + 2 * FLOW_PAD_Y);
  return { ...n, lines, w, h };
}
function clip(box, tx, ty) {
  const dx = tx - box.x, dy = ty - box.y;
  if (dx === 0 && dy === 0) return [box.x, box.y];
  const sx = dx === 0 ? Infinity : (box.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (box.h / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [box.x + dx * s, box.y + dy * s];
}

function renderDiagram(f) {
  const d = f.diagram;
  const boxes = Object.fromEntries(d.nodes.map((n) => [n.id, nodeBox(n)]));
  const mid = `arr-${f.id}`;
  const out = [];
  out.push(`<svg class="dg" viewBox="0 0 ${d.w} ${d.h}" role="img" aria-labelledby="dg-${f.id}-t dg-${f.id}-d" xmlns="http://www.w3.org/2000/svg">`);
  out.push(`<title id="dg-${f.id}-t">${esc(plain(f.title))}: diagram</title><desc id="dg-${f.id}-d">${esc(d.desc)}</desc>`);
  out.push(`<defs><marker id="${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="arrow-head"/></marker></defs>`);
  for (const z of d.zones || []) {
    out.push(`<g class="dg-zone"><rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="10"/><text x="${z.x + 10}" y="${z.y + 18}">${esc(z.label)}</text></g>`);
  }
  for (const e of d.edges) {
    const a = boxes[e.from] || fail(`flow ${f.id}: edge from unknown node ${e.from}`);
    const b = boxes[e.to] || fail(`flow ${f.id}: edge to unknown node ${e.to}`);
    const via = e.via || [];
    const p0 = clip(a, ...(via[0] || [b.x, b.y]));
    const pN = clip(b, ...(via[via.length - 1] || [a.x, a.y]));
    const pts = [p0, ...via, pN];
    const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const m = Math.floor(pts.length / 2);
    const [ax, ay] = pts[pts.length % 2 ? m - 1 : m - 1], [bx, by] = pts[pts.length % 2 ? m : m];
    const midx = (ax + bx) / 2, midy = (ay + by) / 2;
    const vertical = Math.abs(by - ay) > Math.abs(bx - ax);
    const lx = e.lx ?? (vertical ? midx + 8 : midx);
    const ly = e.ly ?? (vertical ? midy + 9 : midy - 1);
    const anchor = e.lx !== undefined ? "middle" : vertical ? "start" : "middle";
    out.push(`<g class="dg-edge${e.dashed ? " dashed" : ""}" data-edge="${e.from}>${e.to}"><path d="${path}" marker-end="url(#${mid})"/>${e.label ? `<text class="dg-elabel" x="${lx.toFixed(1)}" y="${(e.ly !== undefined ? e.ly : ly - 5).toFixed(1)}" text-anchor="${anchor}">${esc(e.label)}</text>` : ""}</g>`);
  }
  for (const n of d.nodes) {
    const b = boxes[n.id];
    const x = b.x - b.w / 2, y = b.y - b.h / 2;
    const ty = b.y - ((b.lines.length - 1) * FLOW_LINE) / 2 + 5;
    const extra = b.kind === "store" ? `<line x1="${x}" y1="${y + 7}" x2="${x + b.w}" y2="${y + 7}"/>` : "";
    const tag = n.status ? `<text class="dg-tag" x="${x + b.w - 6}" y="${y - 4}" text-anchor="end">${esc(STATE[n.status]?.label || n.status)}</text>` : "";
    out.push(`<g class="dg-node k-${b.kind || "proc"}${n.status ? " st-" + n.status : ""}" data-node="${n.id}"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${b.w}" height="${b.h}" rx="${b.kind === "actor" ? 18 : 6}"/>${extra}${b.lines.map((ln, k) => `<text x="${b.x}" y="${(ty + k * FLOW_LINE).toFixed(1)}" text-anchor="middle">${esc(ln)}</text>`).join("")}${tag}</g>`);
  }
  out.push(`</svg>`);
  return out.join("\n");
}

function renderFlows() {
  return D.flows.map((f) => {
    const nodeIds = new Set(f.diagram.nodes.map((n) => n.id));
    const edgeIds = new Set(f.diagram.edges.map((e) => `${e.from}>${e.to}`));
    const st = f.status;
    const stRow = ["built", "in-progress", "planned"].filter((k) => st[k]?.length).map((k) => `<div class="fs fs-${k}">${badge(k)}<ul>${li(st[k])}</ul></div>`).join("");
    const steps = f.steps.map((s, i) => {
      for (const n of s.nodes || []) if (!nodeIds.has(n)) fail(`flow ${f.id} step ${i + 1}: unknown node ${n}`);
      for (const e of s.edges || []) if (!edgeIds.has(e)) fail(`flow ${f.id} step ${i + 1}: unknown edge ${e}`);
      const where = (s.where || []).map(([p, label]) => `<li><a class="repo" href="${esc(repoHref(p))}">${esc(plain(label || p))}</a></li>`).join("");
      return `<li class="step" id="flow-${f.id}-s${i + 1}" data-step="${i + 1}" data-nodes="${(s.nodes || []).join(" ")}" data-edges="${(s.edges || []).join(" ")}" data-search data-title="${esc(plain(f.short + ": " + s.title))}">
<h4><span class="s-n">Step ${i + 1}</span> ${inline(s.title)}</h4>
${(s.nodes || []).length ? `<p class="s-parts"><span class="lbl">In the picture:</span> ${s.nodes.map((n) => esc(plain(String(f.diagram.nodes.find((x) => x.id === n).label).split("\n").join(" ")))).join(" &middot; ")}</p>` : ""}
${paras(s.text)}
${s.cmd ? `<pre class="cmd" tabindex="0"><code>${esc(s.cmd)}</code></pre>` : ""}
${where ? `<p class="where"><span class="lbl">In the repo:</span></p><ul class="where-list">${where}</ul>` : ""}
${s.state ? `<p class="s-state">${badge(s.state, s.stateLabel)} ${inline(s.stateNote || "")}</p>` : ""}
${insightsAt("flow", f.id, s.insights)}
</li>`;
    }).join("\n");
    return `<section class="flow" id="flow-${f.id}" data-flow="${f.id}" aria-labelledby="flow-${f.id}-h" data-search data-title="${esc(plain(f.title))}">
<h3 id="flow-${f.id}-h" data-toc="${esc(f.short)}"><span class="flow-letter">${f.letter}</span> ${inline(f.title)}</h3>
${paras(f.intro)}
<div class="flow-status">${stRow}</div>
<div class="stepper" data-stepper data-steps="${f.steps.length}">
<figure class="diagram">${renderDiagram(f)}<figcaption>${inline(f.caption)}</figcaption></figure>
<div class="step-pane"><ol class="steps">
${steps}
</ol></div>
</div>
</section>`;
  }).join("\n");
}

// ---- safeguarding: the big-picture walkthrough ---------------------------------------------------------------
function renderSafeguarding() {
  const sg = D.safeguarding;
  const big = { id: "sg-big", title: "The big picture", diagram: sg.bigPicture.diagram };
  const dyn = { id: "sg-dyn", title: "What happens, step by step", diagram: sg.dynamic.diagram };
  const nodeIds = new Set(sg.dynamic.diagram.nodes.map((n) => n.id));
  const edgeIds = new Set(sg.dynamic.diagram.edges.map((e) => `${e.from}>${e.to}`));
  const steps = sg.dynamic.steps.map((s, i) => {
    for (const n of s.nodes || []) if (!nodeIds.has(n)) fail(`safeguarding step ${i + 1}: unknown node ${n}`);
    for (const e of s.edges || []) if (!edgeIds.has(e)) fail(`safeguarding step ${i + 1}: unknown edge ${e}`);
    return `<li class="step" id="sg-dyn-s${i + 1}" data-step="${i + 1}" data-nodes="${(s.nodes || []).join(" ")}" data-edges="${(s.edges || []).join(" ")}">
<h4><span class="s-n">Step ${i + 1}</span> ${inline(s.title)}</h4>
${paras(s.text)}
</li>`;
  }).join("\n");
  const rows = sg.mechanisms.rows.map(([label, mac, linux]) =>
    `<tr><th scope="row">${inline(label)}</th><td>${inline(mac)}</td><td>${inline(linux)}</td></tr>`).join("\n");
  return `
<p class="lede">${paras(sg.intro)}</p>
<figure class="diagram wide"><figcaption class="sg-cap-top">${inline(sg.bigPicture.caption)}</figcaption>${renderDiagram(big)}</figure>

<h3 id="sg-mech-h" data-toc="One policy, two mechanisms">One policy, two mechanisms</h3>
<table class="sg-mech">
<thead><tr><th scope="col"></th><th scope="col">macOS</th><th scope="col">Linux</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p>${inline(sg.mechanisms.windows)}</p>

<h3 id="sg-dyn-h" data-toc="What happens, step by step">What happens, step by step</h3>
<div class="stepper" data-stepper data-steps="${sg.dynamic.steps.length}">
<figure class="diagram">${renderDiagram(dyn)}<figcaption>Each attempt below is one the sandbox's own proof actually tests.</figcaption></figure>
<div class="step-pane"><ol class="steps">
${steps}
</ol></div>
</div>

<h3 id="sg-not-h" data-toc="What this does not solve">What this does not solve</h3>
<ul>${li(sg.notSolved)}</ul>
`;
}

// ---- findings explorer --------------------------------------------------------------------------------------
function renderFindings() {
  const rows = D.findings.map((f) => `<tr data-theme="${f.theme}" data-combos="${f.combos.join(" ")}" data-search data-title="${esc(f.title)}">
<th scope="row">${inline(f.title)}</th>
<td data-label="Theme"><span class="ins-theme theme-${f.theme}">${THEMES[f.theme]}</span></td>
<td data-label="What was measured">${inline(f.finding)}</td>
<td class="fc" data-label="Applies to">${f.combos.includes("all") ? "all" : f.combos.map((c) => esc(D.combos[c] || fail("combo " + c))).join(", ")}</td>
<td data-label="Where">${f.insight ? `<a class="ins-link" href="#i-${f.insight}" data-insight="${f.insight}">in practice</a>` : ""}${f.insight ? "; " : ""}<a class="repo" href="${esc(repoHref(f.source[0]))}">${esc(f.source[1])}</a></td>
</tr>`).join("\n");
  const combos = Object.entries(D.combos).map(([id, label]) => `<label class="chk"><input type="checkbox" name="combo" value="${id}"> ${esc(label)}</label>`).join("");
  return `<div class="explorer" id="explorer">
<form class="filters" id="findings-filters" hidden aria-label="Filter the findings">
<fieldset><legend>Theme</legend>
<label class="chk"><input type="radio" name="theme" value="" checked> All</label>
${Object.entries(THEMES).filter(([k]) => k !== "method").map(([k, v]) => `<label class="chk"><input type="radio" name="theme" value="${k}"> ${v}</label>`).join("")}
</fieldset>
<fieldset><legend>Combination (show findings that apply to any ticked one)</legend>${combos}</fieldset>
<label class="txt">Text <input type="search" name="q" placeholder="e.g. credentials"></label>
<p class="filter-count" id="findings-count" role="status" aria-live="polite"></p>
</form>
<div class="table-wrap"><table class="findings" id="findings-table">
<thead><tr><th scope="col">Finding</th><th scope="col">Theme</th><th scope="col">What was measured</th><th scope="col">Applies to</th><th scope="col">Where</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
</div>`;
}

// ---- glossary -----------------------------------------------------------------------------------------------
function renderGlossary() {
  const sorted = [...D.glossary].sort((a, b) => a.term.localeCompare(b.term, "en"));
  const letters = [...new Set(sorted.map((g) => g.term[0].toUpperCase()))];
  const idx = letters.map((l) => `<a href="#gl-${l}">${l}</a>`).join(" ");
  let cur = "";
  const body = sorted.map((g) => {
    const l = g.term[0].toUpperCase();
    const head = l !== cur ? (cur = l, `<dt class="gl-letter" id="gl-${l}" aria-hidden="false"><span>${l}</span></dt><dd class="gl-skip" aria-hidden="true"></dd>`) : "";
    const see = (g.see || []).map((s) => (GLO[s] ? `<a class="term" href="#g-${s}" data-term="${s}">${esc(GLO[s].term)}</a>` : fail(`glossary ${g.id}: see ${s}`))).join(", ");
    return `${head}<dt id="g-${g.id}" data-search data-title="${esc(g.term)}">${esc(g.term)}</dt><dd>${inline(g.def)}${g.entity ? ` <a class="ent" href="#e-${g.entity}" data-entity="${g.entity}">Entity page</a>.` : ""}${see ? ` <span class="see">See also: ${see}.</span>` : ""}</dd>`;
  }).join("\n");
  return `<p class="gl-index" aria-label="Jump to a letter">${idx}</p><dl class="glossary">${body}</dl>`;
}

// ---- ledger -------------------------------------------------------------------------------------------------
function renderLedger() {
  const order = ["in-progress", "planned", "idea", "built"];
  return order.map((k) => {
    const items = D.ledger.filter((x) => x.state === k);
    if (!items.length) return "";
    return `<div class="ledger-block ledger-${k}"><h3>${badge(k)}</h3><ul>${items.map((x) => `<li><strong>${inline(x.item)}.</strong> ${inline(x.detail)}</li>`).join("")}</ul></div>`;
  }).join("\n");
}

// ---- auto-link glossary terms in plain text -----------------------------------------------------------------
const AUTO = [];
for (const g of D.glossary) for (const a of g.auto || []) AUTO.push({ id: g.id, re: new RegExp(`(?<![\\w-])(${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w-])`, "i") });
AUTO.sort((a, b) => b.re.source.length - a.re.source.length);

function autolink(html) {
  const tokens = html.split(/(<(?:[^>"']|"[^"]*"|'[^']*')*>)/);
  const SKIP = new Set(["a", "code", "pre", "h1", "h2", "h3", "h4", "summary", "svg", "button", "script", "style", "title", "dt", "figcaption", "label", "legend", "textarea", "th", "option", "header"]);
  const BLOCK = new Set(["p", "li", "dd", "td", "blockquote"]);
  const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "path", "line", "rect", "circle", "use", "stop"]);
  const stack = [];
  let linked = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("<")) {
      const m = /^<(\/?)([a-zA-Z0-9]+)/.exec(t);
      if (!m) continue;
      const name = m[2].toLowerCase();
      if (/\/>$/.test(t) || VOID.has(name)) continue;
      if (m[1]) { const k = stack.lastIndexOf(name); if (k >= 0) stack.length = k; if (BLOCK.has(name)) linked = new Set(); }
      else { stack.push(name); if (BLOCK.has(name)) linked = new Set(); }
      continue;
    }
    if (!t.trim() || stack.some((s) => SKIP.has(s))) continue;
    const segs = [t];
    for (const a of AUTO) {
      if (linked.has(a.id)) continue;
      for (let k = 0; k < segs.length; k++) {
        if (typeof segs[k] !== "string") continue;
        const m = a.re.exec(segs[k]);
        if (!m) continue;
        const before = segs[k].slice(0, m.index), after = segs[k].slice(m.index + m[0].length);
        segs.splice(k, 1, before, { html: `<a class="term" href="#g-${a.id}" data-term="${a.id}">${m[1]}</a>` }, after);
        linked.add(a.id);
        break;
      }
    }
    tokens[i] = segs.map((x) => (typeof x === "string" ? x : x.html)).join("");
  }
  return tokens.join("");
}

// ---- assemble -----------------------------------------------------------------------------------------------
function build() {
  placed.clear();
  let tpl = fs.readFileSync(path.join(HERE, "src/page.tpl"), "utf8");
  const parts = {
    problems: renderProblems(),
    "map-shell": renderMapShell(),
    "entity-cards": renderEntityCards(),
    components: renderComponents(),
    safeguarding: renderSafeguarding(),
    flows: renderFlows(),
    findings: renderFindings(),
    glossary: renderGlossary(),
    ledger: renderLedger(),
  };
  // The template's own prose carries the same inline markup, and may place insight panels with {{insight:id}}.
  tpl = markup(tpl, false);
  tpl = tpl.replace(/\{\{insight:([a-z0-9-]+)\}\}/g, (_, id) => insightsAt("page", "tpl", [id]));
  tpl = tpl.replace(/<!--@([a-z-]+)-->/g, (m, k) => {
    if (k === "toc") return m;
    if (!(k in parts)) fail(`unknown placeholder ${k}`);
    return parts[k];
  });
  const toc = buildTocHtml(tpl);
  tpl = tpl.replace("<!--@toc-->", toc);
  tpl = autolink(tpl);
  tpl = tpl.replace(/\{\{asof\}\}/g, esc(D.meta.asOf));
  tpl = tpl.replace(/\{\{state-([a-z-]+)\}\}/g, (_, k) => badge(k));
  const left = tpl.match(/\{g:|\{e:|\{f:|\{i:|\{p:|\{c:/);
  if (left) fail("unprocessed inline markup near: " + tpl.slice(Math.max(0, left.index - 60), left.index + 60));
  return tpl;
}

function buildTocHtml(html) {
  const re = /<h([23])\b([^>]*)>/g;
  let out = "<ol>";
  let sub = false, openLi = false, m;
  while ((m = re.exec(html))) {
    const id = /\bid="([^"]+)"/.exec(m[2]);
    const label = /data-toc="([^"]*)"/.exec(m[2]);
    if (!id || !label) continue;
    const a = `<a href="#${id[1]}">${label[1]}</a>`;
    if (m[1] === "2") {
      if (sub) { out += "</ol>"; sub = false; }
      if (openLi) out += "</li>";
      out += `<li>${a}`;
      openLi = true;
    } else {
      if (!sub) { out += "<ol>"; sub = true; }
      out += `<li>${a}</li>`;
    }
  }
  if (sub) out += "</ol>";
  if (openLi) out += "</li>";
  return out + "</ol>";
}

const html = build();
const outFile = path.join(HERE, "index.html");
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  if (cur !== html) { console.error("index.html is out of date: run node benchmarks/docs/guide/build.mjs"); process.exit(1); }
  console.log("index.html is up to date");
} else {
  fs.writeFileSync(outFile, html);
  console.log(`wrote ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
}
