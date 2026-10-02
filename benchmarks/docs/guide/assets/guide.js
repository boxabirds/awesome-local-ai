/* The benchmark guide: interaction on top of a page that already reads without it.
   No dependencies, no network. Everything here is optional: with scripts off the content is all in the HTML. */
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  root.classList.add("js");

  var $ = function (sel, scope) { return (scope || doc).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(sel)); };
  var on = function (el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); };
  var SVG_NS = "http://www.w3.org/2000/svg";

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value);
    } catch (e) { /* storage can be blocked: the page still works */ }
    return null;
  }

  // ------------------------------------------------------------------ theme
  var THEMES = ["auto", "light", "dark"];
  function applyTheme(t) {
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t); else root.removeAttribute("data-theme");
    var b = $("#theme-btn");
    if (b) b.textContent = "Theme: " + (THEMES.indexOf(t) > 0 ? t : "auto");
  }
  (function initTheme() {
    var t = store("guide-theme") || "auto";
    applyTheme(t);
    var b = $("#theme-btn");
    if (!b) return;
    b.hidden = false;
    on(b, "click", function () {
      var cur = THEMES.indexOf(root.getAttribute("data-theme") || "auto");
      var next = THEMES[(cur + 1) % THEMES.length];
      applyTheme(next);
      store("guide-theme", next === "auto" ? null : next);
    });
  })();

  // ------------------------------------------------------------------ table of contents
  (function initToc() {
    var toc = $("#toc");
    if (!toc) return;
    var details = $("details", toc);
    var mq = window.matchMedia("(min-width: 1100px)");
    function sync() { if (details) details.open = mq.matches; }
    sync();
    if (mq.addEventListener) mq.addEventListener("change", sync);
    $$("a", toc).forEach(function (a) {
      on(a, "click", function () { if (!mq.matches && details) details.open = false; });
    });
    var links = {};
    $$("a[href^='#']", toc).forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
    var heads = Object.keys(links).map(function (id) { return doc.getElementById(id); }).filter(Boolean);
    var ticking = false;
    function update() {
      ticking = false;
      var cur = null;
      for (var i = 0; i < heads.length; i++) {
        if (heads[i].getBoundingClientRect().top <= 130) cur = heads[i]; else break;
      }
      $$("a[aria-current]", toc).forEach(function (a) { a.removeAttribute("aria-current"); });
      if (!cur) return;
      var a = links[cur.id];
      a.setAttribute("aria-current", "location");
      var parent = a.closest("ol") && a.closest("ol").parentElement && a.closest("ol").parentElement.closest("li");
      if (parent && parent.firstElementChild && parent.firstElementChild !== a) parent.firstElementChild.setAttribute("aria-current", "location");
      var wrap = $(".toc-wrap");
      if (wrap && mq.matches) {
        var r = a.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
        if (r.top < wr.top + 20) wrap.scrollTop -= wr.top + 20 - r.top;
        else if (r.bottom > wr.bottom - 20) wrap.scrollTop += r.bottom - (wr.bottom - 20);
      }
    }
    on(window, "scroll", function () { if (!ticking) { ticking = true; window.requestAnimationFrame(update); } }, { passive: true });
    update();
  })();

  // ------------------------------------------------------------------ contents panel: collapse and resize
  (function initTocPanel() {
    var MIN_W = 180, MAX_W = 420, DEFAULT_W = 250, STEP = 20;
    var tools = $("#toc-tools"), collapseBtn = $("#toc-collapse"), resizer = $("#toc-resize");
    if (!tools || !collapseBtn || !resizer) return;
    tools.hidden = false;
    resizer.hidden = false;

    function currentWidth() {
      var v = parseInt(getComputedStyle(root).getPropertyValue("--toc-w"), 10);
      return isNaN(v) ? DEFAULT_W : v;
    }
    function applyWidth(w) {
      w = Math.max(MIN_W, Math.min(MAX_W, w));
      root.style.setProperty("--toc-w", w + "px");
      resizer.setAttribute("aria-valuenow", String(w));
      store("toc-width", String(w));
      return w;
    }
    function setCollapsed(on) {
      root.classList.toggle("toc-collapsed", on);
      collapseBtn.setAttribute("aria-expanded", String(!on));
      collapseBtn.innerHTML = on ? "&#9658;" : "&#9668;";
      collapseBtn.title = on ? "Show contents" : "Collapse contents";
      store("toc-collapsed", on ? "1" : "");
    }

    resizer.setAttribute("aria-valuemin", String(MIN_W));
    resizer.setAttribute("aria-valuemax", String(MAX_W));
    var savedW = parseInt(store("toc-width") || "", 10);
    applyWidth(isNaN(savedW) ? DEFAULT_W : savedW);
    setCollapsed(store("toc-collapsed") === "1");

    on(collapseBtn, "click", function () { setCollapsed(!root.classList.contains("toc-collapsed")); });

    var dragging = false, startX = 0, startW = DEFAULT_W;
    on(resizer, "pointerdown", function (e) {
      if (root.classList.contains("toc-collapsed")) return;
      dragging = true; startX = e.clientX; startW = currentWidth();
      if (resizer.setPointerCapture) resizer.setPointerCapture(e.pointerId);
    });
    on(resizer, "pointermove", function (e) { if (dragging) applyWidth(startW + (e.clientX - startX)); });
    on(resizer, "pointerup", function () { dragging = false; });
    on(resizer, "pointercancel", function () { dragging = false; });
    on(resizer, "keydown", function (e) {
      if (root.classList.contains("toc-collapsed")) return;
      if (e.key === "ArrowLeft") { applyWidth(currentWidth() - STEP); e.preventDefault(); }
      else if (e.key === "ArrowRight") { applyWidth(currentWidth() + STEP); e.preventDefault(); }
      else if (e.key === "Home") { applyWidth(MIN_W); e.preventDefault(); }
      else if (e.key === "End") { applyWidth(MAX_W); e.preventDefault(); }
    });
  })();

  // ------------------------------------------------------------------ insight panels and hash targets
  function openAncestors(el) {
    for (var p = el; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
  }
  function revealHash(hash, scroll) {
    if (!hash || hash.length < 2) return;
    var id = decodeURIComponent(hash.slice(1));
    if (id.indexOf("e-") === 0 && map.api) { map.api.select(id.slice(2), { scroll: scroll }); return; }
    var el = doc.getElementById(id);
    if (!el) return;
    openAncestors(el);
    if (el.classList.contains("step")) stepperFor(el).show(Number(el.getAttribute("data-step")) - 1);
    if (el.matches && el.matches("details.insight")) el.open = true;
    if (scroll) el.scrollIntoView({ block: "start" });
  }
  on(window, "hashchange", function () { revealHash(location.hash, true); });
  on(doc, "click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a.ins-link");
    if (a) {
      var el = doc.getElementById(a.getAttribute("href").slice(1));
      if (el) { ev.preventDefault(); openAncestors(el); el.open = true; el.scrollIntoView({ block: "center" }); history.replaceState(null, "", a.getAttribute("href")); var s = $("summary", el); if (s) s.focus({ preventScroll: true }); }
    }
  });

  // ------------------------------------------------------------------ entity map
  var map = { api: null };
  (function initMap() {
    var svg = $("#entity-map-svg");
    if (!svg) return;
    var detail = $("#entity-detail");
    var nodes = {};
    $$(".map-node", svg).forEach(function (n) { nodes[n.getAttribute("data-entity")] = n; });
    var edges = $$(".map-edge", svg);
    var labelLayer = $(".map-labels", svg);
    var ref = $("#entity-reference");
    if (ref) ref.open = false;
    var current = null;

    function clearSel() {
      svg.classList.remove("has-sel");
      Object.keys(nodes).forEach(function (k) { nodes[k].classList.remove("sel", "related"); nodes[k].removeAttribute("aria-pressed"); });
      edges.forEach(function (e) { e.classList.remove("on", "inc"); });
      while (labelLayer.firstChild) labelLayer.removeChild(labelLayer.firstChild);
    }

    function select(id, opt) {
      opt = opt || {};
      var card = doc.getElementById("e-" + id);
      if (!card || !nodes[id]) return false;
      clearSel();
      current = id;
      svg.classList.add("has-sel");
      nodes[id].classList.add("sel");
      nodes[id].setAttribute("aria-pressed", "true");
      edges.forEach(function (e) {
        var f = e.getAttribute("data-from"), t = e.getAttribute("data-to");
        if (f !== id && t !== id) return;
        e.classList.add("on");
        if (t === id) e.classList.add("inc");
        var other = f === id ? t : f;
        if (nodes[other]) nodes[other].classList.add("related");
        try {
          var len = e.getTotalLength();
          var pt = e.getPointAtLength(len * (f === id ? 0.62 : 0.38));
          var tx = doc.createElementNS(SVG_NS, "text");
          tx.setAttribute("x", pt.x.toFixed(1));
          tx.setAttribute("y", (pt.y - 4).toFixed(1));
          tx.setAttribute("text-anchor", "middle");
          tx.textContent = e.getAttribute("data-label");
          labelLayer.appendChild(tx);
        } catch (err) { /* geometry not available: labels are optional */ }
      });
      // the detail panel: a copy of the entity's card, without ids so none are duplicated
      var clone = card.cloneNode(true);
      [clone].concat($$("[id]", clone)).forEach(function (n) { n.removeAttribute("id"); });
      $$("[data-search]", clone).concat([clone]).forEach(function (n) { n.removeAttribute("data-search"); });
      clone.removeAttribute("tabindex");
      clone.classList.remove("is-target");
      detail.innerHTML = "";
      detail.appendChild(clone);
      detail.setAttribute("aria-label", "Entity: " + (card.getAttribute("data-title") || id));
      var picker = $("#entity-picker-select");
      if (picker) picker.value = id;
      if (opt.history !== false && location.hash !== "#e-" + id) history.replaceState(null, "", "#e-" + id);
      if (opt.scroll) {
        var target = opt.scroll === "map" ? $("#entity-map") : detail;
        target.scrollIntoView({ block: opt.scroll === "map" ? "start" : "nearest" });
      }
      if (opt.focusDetail) detail.focus({ preventScroll: true });
      return true;
    }

    // keyboard on nodes: Enter/Space select, arrows move to a neighbouring node
    var order = Object.keys(nodes).map(function (k) { var r = nodes[k].querySelector("rect"); return { id: k, x: +r.getAttribute("x"), y: +r.getAttribute("y") }; });
    function neighbour(id, dx, dy) {
      var me = order.filter(function (o) { return o.id === id; })[0];
      var best = null, bestD = Infinity;
      order.forEach(function (o) {
        if (o.id === id) return;
        var ddx = o.x - me.x, ddy = o.y - me.y;
        if (dx && Math.sign(ddx) !== dx) return;
        if (dy && (Math.sign(ddy) !== dy || Math.abs(ddx) > 40)) return;
        var d = dx ? Math.abs(ddx) * 4 + Math.abs(ddy) : Math.abs(ddy) * 4 + Math.abs(ddx);
        if (d < bestD) { bestD = d; best = o; }
      });
      return best && best.id;
    }
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      on(n, "click", function () { select(id, { focusDetail: false }); });
      on(n, "keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(id, { focusDetail: true }); return; }
        var dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[ev.key];
        if (!dir) return;
        var to = neighbour(id, dir[0], dir[1]);
        if (to) { ev.preventDefault(); nodes[to].focus(); }
      });
    });

    // group filter
    var chips = $$("[data-map-group]");
    chips.forEach(function (b) {
      on(b, "click", function () {
        var g = b.getAttribute("data-map-group");
        chips.forEach(function (c) { c.setAttribute("aria-pressed", c === b ? "true" : "false"); });
        Object.keys(nodes).forEach(function (k) {
          nodes[k].classList.toggle("filtered-out", !!g && nodes[k].getAttribute("data-group") !== g);
        });
      });
    });

    // picker (a plain list for keyboards and phones)
    var picker = $("#entity-picker-select");
    if (picker) {
      var groups = {};
      $$(".entity").forEach(function (c) {
        var g = c.getAttribute("data-group");
        (groups[g] = groups[g] || []).push(c);
      });
      var names = {};
      $$(".lane", svg).forEach(function (l) { names[l.getAttribute("data-group")] = $(".lane-title", l).textContent; });
      Object.keys(names).forEach(function (g) {
        var og = doc.createElement("optgroup");
        og.label = names[g];
        (groups[g] || []).forEach(function (c) {
          var o = doc.createElement("option");
          o.value = c.getAttribute("data-entity");
          o.textContent = c.getAttribute("data-title");
          og.appendChild(o);
        });
        picker.appendChild(og);
      });
      picker.value = "";
      on(picker, "change", function () { if (picker.value) select(picker.value, { scroll: "detail" }); });
      $("#entity-picker").hidden = false;
    }
    $(".map-controls").hidden = false;

    // links to an entity anywhere on the page open it in the panel
    on(doc, "click", function (ev) {
      var a = ev.target.closest && ev.target.closest("a[data-entity]");
      if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      var id = a.getAttribute("data-entity");
      if (!nodes[id]) return;
      ev.preventDefault();
      var inside = !!a.closest("#entity-detail");
      select(id, { scroll: inside ? false : "detail", focusDetail: !inside });
    });

    map.api = { select: select };
  })();

  // ------------------------------------------------------------------ steppers
  var steppers = [];
  function stepperFor(step) {
    var el = step.closest("[data-stepper]");
    for (var i = 0; i < steppers.length; i++) if (steppers[i].el === el) return steppers[i];
    return { show: function () {} };
  }
  $$("[data-stepper]").forEach(function (el) {
    var steps = $$(".step", el);
    var pane = $(".step-pane", el);
    var svg = $("svg.dg", el);
    var cur = 0;
    var nodeEls = {}, edgeEls = {};
    $$("[data-node]", svg).forEach(function (n) { nodeEls[n.getAttribute("data-node")] = n; });
    $$("[data-edge]", svg).forEach(function (n) { edgeEls[n.getAttribute("data-edge")] = n; });

    var controls = doc.createElement("div");
    controls.className = "step-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Step through this flow");
    controls.innerHTML = '<button type="button" data-prev>Previous</button><span class="step-count" aria-hidden="true"></span><button type="button" data-next>Next</button><div class="dots"></div><p class="visually-hidden" role="status" aria-live="polite"></p>';
    pane.insertBefore(controls, pane.firstChild);
    var prev = $("[data-prev]", controls), next = $("[data-next]", controls), count = $(".step-count", controls);
    var live = $("[role=status]", controls), dots = $(".dots", controls);
    var dotEls = steps.map(function (s, i) {
      var b = doc.createElement("button");
      b.type = "button";
      b.textContent = String(i + 1);
      b.setAttribute("aria-label", "Step " + (i + 1) + ": " + $("h4", s).textContent.replace(/^Step \d+\s*/, ""));
      on(b, "click", function () { show(i, true); });
      dots.appendChild(b);
      return b;
    });

    function show(i, focus) {
      if (i < 0 || i >= steps.length) return;
      cur = i;
      steps.forEach(function (s, k) { s.classList.toggle("is-current", k === i); });
      var s = steps[i];
      var ns = (s.getAttribute("data-nodes") || "").split(" ").filter(Boolean);
      var es = (s.getAttribute("data-edges") || "").split(" ").filter(Boolean);
      Object.keys(nodeEls).forEach(function (k) { nodeEls[k].classList.toggle("hl", ns.indexOf(k) >= 0); });
      Object.keys(edgeEls).forEach(function (k) { edgeEls[k].classList.toggle("hl", es.indexOf(k) >= 0); });
      el.classList.add("is-active");
      count.textContent = "Step " + (i + 1) + " of " + steps.length;
      prev.disabled = i === 0;
      next.disabled = i === steps.length - 1;
      dotEls.forEach(function (b, k) { if (k === i) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); b.setAttribute("aria-pressed", k === i ? "true" : "false"); });
      live.textContent = "Step " + (i + 1) + " of " + steps.length + ": " + $("h4", s).textContent.replace(/^Step \d+\s*/, "");
      if (focus) { var b = dotEls[i]; if (b) b.focus({ preventScroll: true }); }
    }
    on(prev, "click", function () { show(cur - 1); if (prev.disabled) next.focus(); });
    on(next, "click", function () { show(cur + 1); if (next.disabled) prev.focus(); });
    on(el, "keydown", function (ev) {
      var t = ev.target;
      if (t.closest && t.closest("input, textarea, select")) return;
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (ev.key === "ArrowRight") { ev.preventDefault(); show(cur + 1, t.closest(".dots") !== null); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); show(cur - 1, t.closest(".dots") !== null); }
      else if (ev.key === "Home" && t.closest(".step-controls")) { ev.preventDefault(); show(0, true); }
      else if (ev.key === "End" && t.closest(".step-controls")) { ev.preventDefault(); show(steps.length - 1, true); }
    });
    // clicking a box in the picture jumps to the first step that uses it
    Object.keys(nodeEls).forEach(function (k) {
      nodeEls[k].style.cursor = "pointer";
      on(nodeEls[k], "click", function () {
        for (var i = 0; i < steps.length; i++) {
          if ((steps[i].getAttribute("data-nodes") || "").split(" ").indexOf(k) >= 0) { show(i); return; }
        }
      });
    });
    steppers.push({ el: el, show: show });
    show(0);
  });

  // ------------------------------------------------------------------ findings explorer
  (function initFindings() {
    var form = $("#findings-filters");
    var table = $("#findings-table");
    if (!form || !table) return;
    form.hidden = false;
    var rows = $$("tbody tr", table);
    var count = $("#findings-count");
    function apply() {
      var theme = (form.elements.theme.value || "");
      var ticked = $$("input[name=combo]:checked", form).map(function (i) { return i.value; });
      var q = (form.elements.q.value || "").trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (tr) {
        var ok = true;
        if (theme && tr.getAttribute("data-theme") !== theme) ok = false;
        if (ok && ticked.length) {
          var cs = tr.getAttribute("data-combos").split(" ");
          ok = cs.indexOf("all") >= 0 || ticked.some(function (t) { return cs.indexOf(t) >= 0; });
        }
        if (ok && q) ok = tr.textContent.toLowerCase().indexOf(q) >= 0;
        tr.hidden = !ok;
        if (ok) shown++;
      });
      count.textContent = shown + " of " + rows.length + " findings shown" + (shown === 0 ? ". Clear a filter to see more." : ".");
    }
    on(form, "input", apply);
    on(form, "change", apply);
    on(form, "submit", function (e) { e.preventDefault(); });
    apply();
  })();

  // ------------------------------------------------------------------ glossary hover and focus
  (function initGlossary() {
    var tip = null;
    function defOf(id) {
      var dt = doc.getElementById("g-" + id);
      if (!dt) return null;
      var dd = dt.nextElementSibling;
      var clone = dd.cloneNode(true);
      $$(".see", clone).forEach(function (n) { n.remove(); });
      var text = clone.textContent.replace(/\s+Entity page\.?/, "").trim();
      if (text.length > 260) text = text.slice(0, 257).replace(/\s+\S*$/, "") + "…";
      return { term: dt.textContent, text: text };
    }
    function show(a) {
      var d = defOf(a.getAttribute("data-term"));
      if (!d) return;
      hide();
      tip = doc.createElement("div");
      tip.className = "tip";
      tip.id = "tip-live";
      tip.setAttribute("role", "tooltip");
      var s = doc.createElement("strong");
      s.textContent = d.term;
      tip.appendChild(s);
      tip.appendChild(doc.createTextNode(d.text));
      doc.body.appendChild(tip);
      a.setAttribute("aria-describedby", "tip-live");
      var r = a.getBoundingClientRect();
      var top = window.scrollY + r.bottom + 6;
      var left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + doc.documentElement.clientWidth - tip.offsetWidth - 8));
      tip.style.top = top + "px";
      tip.style.left = left + "px";
    }
    function hide() {
      if (tip) { tip.remove(); tip = null; }
      $$("[aria-describedby='tip-live']").forEach(function (n) { n.removeAttribute("aria-describedby"); });
    }
    on(doc, "mouseover", function (e) { var a = e.target.closest && e.target.closest("a.term"); if (a) show(a); });
    on(doc, "mouseout", function (e) { if (e.target.closest && e.target.closest("a.term")) hide(); });
    on(doc, "focusin", function (e) { var a = e.target.closest && e.target.closest("a.term"); if (a) show(a); });
    on(doc, "focusout", hide);
    on(doc, "keydown", function (e) { if (e.key === "Escape") hide(); });
    on(window, "scroll", hide, { passive: true });
  })();

  // ------------------------------------------------------------------ search
  (function initSearch() {
    var input = $("#search");
    var box = $("#search-results");
    if (!input || !box) return;
    $(".search").hidden = false;
    var index = null;
    var sel = -1;
    var current = [];

    function norm(s) { return s.replace(/\s+/g, " ").trim(); }
    function kindOf(el) {
      if (el.classList.contains("problem")) return "Problem";
      if (el.classList.contains("entity")) return "Entity";
      if (el.classList.contains("component")) return "Component";
      if (el.classList.contains("step")) return "Flow step";
      if (el.classList.contains("flow")) return "Flow";
      if (el.classList.contains("insight")) return "In practice";
      if (el.tagName === "DT") return "Glossary";
      if (el.tagName === "TR") return "Finding";
      return "Section";
    }
    function build() {
      index = $$("[data-search]").filter(function (el) { return !el.closest("#entity-detail") && el.id; }).map(function (el) {
        var title = el.getAttribute("data-title") || "";
        var text = el.tagName === "DT" ? norm(el.textContent + " " + el.nextElementSibling.textContent) : norm(el.textContent);
        return { id: el.id, title: title, kind: kindOf(el), text: text, lt: text.toLowerCase(), ltitle: title.toLowerCase() };
      });
    }
    function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function snippet(it, toks) {
      var pos = -1;
      for (var i = 0; i < toks.length && pos < 0; i++) pos = it.lt.indexOf(toks[i]);
      if (pos < 0) pos = 0;
      var from = Math.max(0, pos - 50), to = Math.min(it.text.length, pos + 110);
      var s = esc(it.text.slice(from, to));
      toks.forEach(function (t) { s = s.replace(new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>"); });
      return (from > 0 ? "…" : "") + s + (to < it.text.length ? "…" : "");
    }
    function run() {
      var q = norm(input.value).toLowerCase();
      if (!q) { close(); return; }
      if (!index) build();
      var toks = q.split(" ").filter(Boolean);
      var hits = [];
      index.forEach(function (it) {
        var score = 0;
        for (var i = 0; i < toks.length; i++) {
          var inT = it.ltitle.indexOf(toks[i]) >= 0, inB = it.lt.indexOf(toks[i]) >= 0;
          if (!inT && !inB) return;
          score += (inT ? 12 : 0) + 1;
        }
        if (it.kind === "Entity" || it.kind === "Glossary") score += 3;
        hits.push({ it: it, score: score });
      });
      hits.sort(function (a, b) { return b.score - a.score; });
      current = hits.slice(0, 14);
      sel = current.length ? 0 : -1;
      if (!current.length) { box.innerHTML = '<p class="search-empty">Nothing matches “' + esc(q) + '”.</p>'; box.hidden = false; input.setAttribute("aria-expanded", "true"); return; }
      box.innerHTML = "<ul role='listbox' aria-label='Search results'>" + current.map(function (h, i) {
        return "<li role='presentation'><a role='option' id='sr-" + i + "' href='#" + h.it.id + "' aria-selected='" + (i === 0) + "'><span class='r-kind'>" + h.it.kind + "</span><span class='r-title'>" + esc(h.it.title) + "</span><span class='r-snip'>" + snippet(h.it, toks) + "</span></a></li>";
      }).join("") + "</ul>";
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-activedescendant", "sr-0");
    }
    function close() {
      box.hidden = true;
      box.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      sel = -1;
      current = [];
    }
    function move(d) {
      if (!current.length) return;
      var items = $$("a[role=option]", box);
      sel = (sel + d + items.length) % items.length;
      items.forEach(function (a, i) { a.setAttribute("aria-selected", String(i === sel)); });
      input.setAttribute("aria-activedescendant", "sr-" + sel);
      items[sel].scrollIntoView({ block: "nearest" });
    }
    function go(hit) {
      close();
      location.hash = "#" + hit.it.id;
      revealHash("#" + hit.it.id, true);
    }
    on(input, "input", run);
    on(input, "focus", function () { if (input.value) run(); });
    on(input, "keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { if (sel >= 0 && current[sel]) { e.preventDefault(); go(current[sel]); } }
      else if (e.key === "Escape") { if (!box.hidden) { e.preventDefault(); close(); } else input.blur(); }
    });
    on(box, "click", function (e) {
      var a = e.target.closest("a[role=option]");
      if (!a) return;
      e.preventDefault();
      var i = Number(a.id.slice(3));
      if (current[i]) go(current[i]);
    });
    on(doc, "click", function (e) { if (!e.target.closest(".search")) close(); });
    on(doc, "keydown", function (e) {
      if (e.key === "/" && !e.target.closest("input, textarea, select, [contenteditable]") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); input.focus(); input.select(); }
    });
  })();

  // ------------------------------------------------------------------ start
  if (location.hash) {
    // wait a frame so layout (and the map's geometry) exists
    window.requestAnimationFrame(function () { revealHash(location.hash, true); });
  }
})();
