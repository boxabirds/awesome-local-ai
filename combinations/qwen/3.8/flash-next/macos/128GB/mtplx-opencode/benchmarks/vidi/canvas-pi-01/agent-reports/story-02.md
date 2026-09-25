# Story 2: the Flash-Next agent's own final statements

The last three substantive assistant messages of the story's pi session, verbatim apart from local paths. The session may continue after nudges, so read them as the agent's claims at the end.

Playwright browsers aren't installed here (and the run is sandboxed), so e2e can't execute locally — I'll still author them to run in CI, then validate everything that can run. First the helper + spec:

---

The bug is clear: a fixed-height `overflow:hidden` box always reports `scrollHeight == clientHeight`, so the fit check always thinks text overflows. I'll measure via an offscreen auto-height element instead. First check the unit tests that call it:
