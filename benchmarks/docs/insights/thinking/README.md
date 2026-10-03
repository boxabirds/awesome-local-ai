# What the model's thinking is made of: theme discovery

3 October 2026. Part of the thinking-spread investigation (`docs/research/20261003-thinking-spread.md`).

The reference models (Claude Opus and Sonnet) are excluded from everything here: they are the quality yardstick, and
including them muddies the optimisation paths (owner's rule, 3 October 2026). Every script reads Qwen stacks only.

## What existed, and what this adds

The 1 October census (`../findings-behaviour.md` section 5, `../findings-performance.md` section 2) used hand-written
keyword detectors for patterns someone had already suspected (invented time limits, "no task was given", the few very
long thoughts that hold a third of all thinking). It found no themes: nothing there discovers what thinking is
made of. This does, from the text alone, with no pre-set categories.

## Method (every step a script here; run in this order)

1. `extract_paragraphs.py`: every paragraph of 40 or more characters of the thinking in the story runs whose thinking
   text is complete (`think_complete = 1` in analytics.db), Qwen combinations: 231 story runs, 47,680 thinking blocks,
   208,753 paragraphs, 52.8 million characters. The paragraph is the unit: a block holds a median of 1 and a mean of
   4.7, and each is one step (a hypothesis, a plan, a doubt).
2. `cluster_paragraphs.py`: TF-IDF over all vocabulary, a rank-100 projection, k-means. Finds subject themes (zoom,
   Yjs sync, undo, storage, wrangler) as much as function themes; subject mostly says which story it is.
3. `cluster_function.py`: the same on terms that occur across the stories only (4,028 of 45,195), plus structural
   features (length, backticks, digits, list start). Finds what the thinking does.
4. `spread_by_theme.py`: splits each story's run-to-run variance of total thinking exactly by theme
   (`Var(total) = sum of Cov(total, theme)`), summed over stories, per combination.

## Results

- **The partition is soft.** k-means with 14 clusters on the function vocabulary: adjusted Rand between seeds
  0.30 to 0.36, silhouette 0.05. On all vocabulary (k = 30): 0.42 to 0.48 and 0.07. The themes are real in the sense
  that a reader recognises them from their strongest terms and nearest paragraphs; their edges are not sharp, and a
  single paragraph's cluster is not reliable. Do not quote a paragraph-level label as fact; quote theme shares.
- **Provisional themes** (named by reading the terms and nearest paragraphs; share of all thinking characters in
  brackets): weighing and correcting itself, "but", "wait", "hmm" (20%); reasoning over the design's state, sync and
  storage cases (11%); code written inside the thinking (10%); reasoning about UI events, selection and drag (9%);
  numbered plans naming files and fixes (7%); diagnosing a failure, "the issue is... actually" (7%); text and box
  geometry (6%); zoom and coordinate arithmetic (6%); checking test cases one by one, "TC-35: ... ✓" (5.5%);
  puzzling over a confusing detail (5%); "let me check", "let me look" (4%); "now let me write" (4.5%); running
  tests (2.5%); applying an update (2%).
- **No single theme carries the spread.** Each theme's share of the run-to-run variance is close to its share of all
  thinking. Swift 1.5 on llama.cpp: weighing and correcting 19%, design and state 15%, code 14%, UI events 9%.
  mlx-serve: 29%, 20%, 12%, 10%. gufo: 21%, 20%, 10%, 10%. A run that thinks more thinks more of everything: it is a
  generally more verbose run, not one that falls into a particular mode. This agrees with the earlier finding that
  the spread is per-call verbosity and not call count (rank correlation 0.93 within a story).

## The softer method, adopted (theme model v1)

`topics_function.py`: non-negative matrix factorisation on the same vocabulary, so each paragraph is a mixture over
topics and not one label. Far more stable than k-means: matched topics have a mean cosine of 0.80 to 0.94 between seeds
and the strongest topic agrees at an adjusted Rand of 0.56 to 0.72 (k-means: 0.30 to 0.36). A paragraph's strongest
topic has a median weight of 0.47, so a paragraph is still a blend. Fourteen topics, named and defined in
`themes_v1.json`; `theme_model.py` fits and saves the model (not in the repo: it is `state/insights/themes/` in the
private repo) and assigns any later paragraph to the same topics.

`themes_to_analytics.py` writes each story run's theme shares into `analytics.db` (`theme`, `theme_story`,
`theme_share`; incremental by the story run's analytics digest; `dbench analyse --rebuild` carries the tables over).
Characters are split by weight, so a story run's `chars` per theme sum to its paragraphs' characters. Backfilled for the
231 story runs with complete thinking text (208,753 paragraphs). Not scheduled: it runs when asked.

With the soft shares, a theme's share of the run-to-run spread is close to its share of all characters in Swift and gufo
(Swift: weighing and correcting 27% of the spread against 25% of the characters; notes, selecting and dragging 13%
against 11%; code drafted in thought 8% and 8%). mlx-serve is the one exception: notes, selecting and dragging carry 22%
of its spread against 14% of its characters (six stories).

## Limits

The themes mix subject and function (several clusters name both); k-means was the only method tried; the
"proportional" result is what uniform scaling would give, so it rules out a special mode but does not say why a
run is verbose. Validating that the themes are recognisable is what `dbench label` is for (blind labels against
cluster names).
