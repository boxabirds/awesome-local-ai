<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How the benchmark works: a guide</title>
<meta name="description" content="An interactive guide to how the awesome-local-ai benchmark works: the concepts, the problems it solves, the parts, the key flows, and what the analysis of every recorded conversation found.">
<meta name="color-scheme" content="light dark">
<script>document.documentElement.classList.add("js");</script>
<link rel="stylesheet" href="assets/guide.css">
<script src="assets/guide.js" defer></script>
</head>
<body id="top">
<a class="skip" href="#main">Skip to the content</a>

<header class="site-header">
  <div class="bar">
    <a class="brand" href="#top">How the benchmark works <span>a guide to awesome-local-ai</span></a>
    <div class="tools">
      <div class="search" role="search" hidden>
        <label class="visually-hidden" for="search">Search this guide</label>
        <input id="search" type="search" placeholder="Search this guide (press /)" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="search-results" aria-autocomplete="list">
        <div id="search-results" class="search-results" hidden></div>
      </div>
      <button id="theme-btn" class="theme-btn" type="button" hidden>Theme: auto</button>
    </div>
  </div>
</header>

<div class="layout">
<div class="toc-col">
<div class="toc-tools" id="toc-tools" hidden>
  <button id="toc-collapse" type="button" class="toc-collapse-btn" aria-expanded="true" aria-controls="toc" title="Collapse contents">&#9668;</button>
</div>
<nav class="toc-wrap toc" id="toc" aria-label="Contents">
  <details open>
    <summary>Contents</summary>
    <!--@toc-->
  </details>
</nav>
</div>
<div class="toc-resize" id="toc-resize" hidden tabindex="0" role="separator" aria-orientation="vertical" aria-label="Resize the contents panel" aria-controls="toc"></div>

<main id="main">

<section id="what" aria-labelledby="what-h">
  <p class="kicker">awesome-local-ai / benchmarks / guide</p>
  <h1>How the benchmark works</h1>
  <h2 id="what-h" data-toc="What this is">What this is, on one page</h2>
  <p class="lede">awesome-local-ai measures how well a local language model, on a particular inference engine and machine, builds real software when it is left alone, and how that compares with other local setups and with Claude. This guide explains the concepts, the parts, the key flows and what the measurements have shown. Every fact in it comes from the repository's own files; where a document and the code disagree, it describes the code.</p>

  <ol class="pipeline wide">
    <li><strong>{g:pack|Define}</strong><p>A pack: a public {g:spec|spec} of stories, and a private suite of {g:heldout|held-out tests} that the agent never sees.</p></li>
    <li><strong>Run</strong><p>The {g:harness|harness} drives a coding {g:agent|agent} through the stories one at a time, on one {g:combination|combination} of model, engine, machine and client, inside a {g:sandbox|sandbox}.</p></li>
    <li><strong>Score</strong><p>After the run the final build is {g:rescore|re-scored} from committed code on a clean install. That is the {g:score-record|score of record}.</p></li>
    <li><strong>{g:judge|Judge}</strong><p>A person watches a recording of each held-out test and says, before seeing the automated result, whether it passed: that checks the scoring. A blinded grader compares two builds' code.</p></li>
    <li><strong>Show and watch</strong><p>Each story's {g:record|record} is pushed to this repo. A results page shows it, a {g:monitor|monitor} watches for faults, and an analysis reads every conversation.</p></li>
  </ol>

  <h3>How to use this guide</h3>
  <ul>
    <li><strong>Read it in order</strong> for the whole picture: the problems first, then the cast of entities, the parts, the flows.</li>
    <li><strong>Jump in</strong> through the <a href="#cast">entity map</a> (click a box to see what it is and how it relates to the others), a <a href="#flows">flow</a> (step through it with the buttons or the arrow keys), or the search box (press <kbd>/</kbd>).</li>
    <li><strong>Dotted-underlined words</strong> are defined in the <a href="#glossary">glossary</a>; hover or focus one to see the definition, click to go to it.</li>
    <li><strong>"In practice" panels</strong> open to show what the analysis of 436 recorded story conversations measured: real numbers, and where the findings give one, a short quotation. Each says which file it comes from.</li>
  </ul>
  <p>Where something is not finished the guide says so with a badge: {{state-built}} works today, {{state-in-progress}} is built or on main but not yet in use, {{state-planned}} is planned or only an idea. The <a href="#status">status section</a> lists them all. This guide describes the repository as of {{asof}}.</p>
</section>

<section id="why" aria-labelledby="why-h">
  <h2 id="why-h" data-toc="The question and the problems">The question, and why it is hard</h2>
  <p class="lede">Which local models, engines and machines are best at building a real multi-story app from a spec, unattended, and how far behind Claude are they?</p>
  <p>That sounds like a speed test. It is not. A fast setup that writes broken code is not a good setup, so the benchmark has an agent implement a real specification story by story and scores the result with tests the agent has never seen. Each {g:run|run} is one combination building the {g:story|stories} of a spec in order. Doing that honestly raises eleven problems. Each one below has a concrete case and the measurements behind it.</p>
  <!--@problems-->
</section>

<section id="cast" aria-labelledby="cast-h">
  <h2 id="cast-h" data-toc="The cast: entities">The cast: entities and how they relate</h2>
  <p>The benchmark has about fifty things worth naming. They fall into seven groups. Click a box to see what it is, what it contains, what it relates to, where it lives in the repo and a real example. The related boxes light up, and the arrows are labelled.</p>
  <!--@map-shell-->
  <details class="entity-reference" id="entity-reference" open>
    <summary>All entities as a list</summary>
    <!--@entity-cards-->
  </details>
</section>

<section id="components" aria-labelledby="components-h">
  <h2 id="components-h" data-toc="Components">Components: what each part does</h2>
  <p>Each tool or part of the system: what it does, why it exists, what goes in and out, how it fails, and what language it is written in. The repo's rule is to build in Rust unless there is good reason not to. dbench, agent-sandbox, vidi-gallery and power-collector are Rust; the harness is Python and Bash; the results page is TypeScript.</p>
  <div class="components wide"><!--@components--></div>
</section>

<section id="flows" aria-labelledby="flows-h">
  <h2 id="flows-h" data-toc="Key flows">Key flows, step by step</h2>
  <p>Nine flows. Each has a picture and a stepper: use <strong>Next</strong> and <strong>Previous</strong>, the numbered buttons, or the left and right arrow keys. The step you are on lights up its part of the picture and shows the real file or command. Each flow starts by saying what is built and what is not.</p>
  <!--@flows-->
</section>

<section id="status" aria-labelledby="status-h">
  <h2 id="status-h" data-toc="What is built and what is not">What is built, and what is not</h2>
  <p>A guide that describes something as working when the code does not do it yet is worse than none. This is the state of each part that is not simply finished, as of {{asof}}, checked against the code and the git history.</p>
  <!--@ledger-->
</section>

<section id="analysis" aria-labelledby="analysis-h">
  <h2 id="analysis-h" data-toc="What the analysis found">What the analysis found</h2>
  <p>On 1 October 2026 the benchmark's recorded conversations were analysed: 436 story conversations in 52 runs, 87,206 model replies and 90,268 tool calls, every one read from its complete log. Nine combinations are covered: seven {g:qwen|Qwen 3.8} combinations through the pi client, and two Claude models (Opus 5.5 and Sonnet 5.5) through Claude Code as the contrast. Each finding is a detector (a query, a pattern, a few lines of code) run over all 436 conversations and reported per combination; samples were read only to check the detectors.</p>
  <p>Three detectors are right less than nine times in ten, so their counts are upper bounds. Claude's thinking is withheld by the provider, so every comparison of thinking is Qwen-only. Seventy-three stories have no tool timings, so every figure in seconds is a lower bound. The stories behind leaked credentials are withheld from the analysis until the keys are changed, and so are they here. The full details, with every table, are in [benchmarks/docs/insights/](benchmarks/docs/insights/README.md).</p>
  <p>Filter the findings by theme or by combination. Each links to the "in practice" panel that illustrates it, and to its source.</p>
  <!--@findings-->
</section>

<section id="reading" aria-labelledby="reading-h">
  <h2 id="reading-h" data-toc="How to read a result">How to read a result</h2>
  <p>The benchmarker shows numbers. This is what they mean, and what they do not.</p>
  <div class="two-col wide">
    <div class="card do">
      <h3>What a result does tell you</h3>
      <ul>
        <li>The <strong>{g:score-record|score}</strong> is how many of the held-out tests pass in the clean re-score of a finished run's final build, for example 68/75. It is the number to rank by. Only finished runs have one.</li>
        <li>A combination row shows the <strong>median, lowest and highest</strong> score of its finished runs, and <strong>n</strong>, how many that is. With 5 runs or fewer per combination, a difference of 12 held-out tests or less cannot separate two combinations: one combination's own runs spread that wide (the benchmarker's own rule, from its methods review).</li>
        <li><strong>Hours per story</strong> and tokens per story are medians over finished runs, with the range. They are cost, not quality.</li>
        <li><strong>Engine speed</strong> (generation and reading tok/s, where the model was timed) says how fast the engine is. It is a different question from how long the agent takes.</li>
        <li>Scores compare only <strong>within one pack version</strong> and one suite version (`vidi-v2`, not `vidi-v1`).</li>
      </ul>
    </div>
    <div class="card dont">
      <h3>What it does not tell you</h3>
      <ul>
        <li><strong>One story from one run is not a measurement.</strong> The same story varied by 23% (median) between four runs of one combination, and occasionally 5 times. Run totals are far steadier.</li>
        <li><strong>A spread is not a verdict.</strong> A low {g:spread|thinking spread} is not good on its own: the same model on mlx-serve thinks at length every time. Read it beside the amount, and only once there are three finished runs.</li>
        <li><strong>A live score is not the score.</strong> It comes from the agent's own workspace right after a story.</li>
        <li><strong>Tokens per second is not quality.</strong> Neither is a green gate nor the agent saying it is done.</li>
        <li><strong>A {g:partial-rerun|partial rerun}</strong> is a diagnostic and is never mixed with full runs; a {g:not-comparable|not-comparable} story run is left out of story-by-story comparisons.</li>
        <li>A <strong>missing figure</strong> is shown as not available. The page never says why.</li>
      </ul>
    </div>
  </div>
  {{insight:variance-spread}}
  <p>What the score covers: whether the app does what the spec says, in a browser, as checked by tests the agent never saw. It does not cover code quality: a blinded AI grader can compare two builds' code, and a person watching test recordings on the review page checks whether the suite's own verdicts were right.</p>
</section>

<section id="running" aria-labelledby="running-h">
  <h2 id="running-h" data-toc="Run it, or add a combination">Run a benchmark, or add a combination</h2>
  <p>The existing scripts and documents hold the detail; this section only points to them.</p>
  <div class="two-col wide">
    <div class="card">
      <h3>Run a benchmark</h3>
      <ul>
        <li>Held-out suites live in a private repo. Ask the repo owner for access, clone it next to this one, then follow [the Vidi README](benchmarks/vidi/README.md#what-is-public-and-what-is-private).</li>
        <li>Make a machine ready: `benchmarks/spec-bench/harness/setup-node.sh` checks tools, pins the pack to its suite tag and proves the sandbox hides the suite.</li>
        <li>Run: `benchmarks/spec-bench/harness/run.sh <install-id> --scope canvas --run-id <id> --record`, or queue it with [dbench](tools/dbench/README.md). Three runs per stack, so spread is visible.</li>
        <li>Check a pack without running a model: `benchmarks/spec-bench/harness/drive.py --pack benchmarks/<name> --dry-run`.</li>
        <li>Everything the harness can do is in [spec-bench's README](benchmarks/spec-bench/README.md); the rules by which a run is judged are in [EVALUATION-POLICY.md](benchmarks/spec-bench/EVALUATION-POLICY.md).</li>
      </ul>
    </div>
    <div class="card">
      <h3>Add a combination</h3>
      <ul>
        <li>The contract is [docs/adding-a-combination.md](docs/adding-a-combination.md). One that reuses the existing adapters is four files and no shell logic: `config.sh`, `profiles.tsv`, `help.txt`, and a root `install-<combination>.sh` pointer.</li>
        <li>Every number in it must be measured, or say that it is not. The installer refuses, with numbers, on hardware it was not measured on.</li>
        <li>Test it: `./tests/run-tests.sh`, `./install.sh --list`, then the installer twice (the second run must change nothing).</li>
        <li>Wanted: results on hardware the project does not have (a DGX Spark, an RTX 3090, AMD Gorgon Halo). See [the README's Contributing section](README.md).</li>
        <li>Engines and models not yet combinations are in [horizon/](horizon/README.md).</li>
      </ul>
    </div>
  </div>
  <div class="card wide">
    <h3>Changing the benchmark itself</h3>
    <ul>
      <li>A bug fix starts with a test that reproduces it; a refactor starts by proving 100% coverage and deleting first. The rules are in [CLAUDE.md](CLAUDE.md).</li>
      <li>A change to what the harness records must update [TELEMETRY.md](benchmarks/spec-bench/TELEMETRY.md); a test fails until it does.</li>
      <li><strong>This guide must change whenever the benchmark system changes in a major way.</strong> How to update it, and a checklist, are in [the guide's README](benchmarks/docs/guide/README.md).</li>
    </ul>
  </div>
</section>

<section id="glossary" aria-labelledby="glossary-h">
  <h2 id="glossary-h" data-toc="Glossary">Glossary</h2>
  <p>Every term used in this guide. A term underlined with dots in the text links here, and shows its definition when you hover or focus it.</p>
  <!--@glossary-->
</section>

</main>
</div>

<footer class="site-footer">
  <p>This guide is part of the repository and works from disk with no network: open <code>index.html</code>. It is generated from <code>assets/guide-data.js</code> and <code>src/page.tpl</code> by <code>build.mjs</code>; see [the guide's README](benchmarks/docs/guide/README.md) for how to keep it current. Facts here come from the repository as of {{asof}}.</p>
</footer>
</body>
</html>
