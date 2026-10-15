# Story 5's stubbed files (rebuilt)

Pinned at `e89785fbb9a253c20e72a6856c631e243e382e4d` (the corpus commit that follows `f0066f55b`, the code story 5's delete-first run started from).
Story 5 stubbed these eleven functions with `todo!()` in a working copy and did not commit it, so these files are
rebuilt by `fixtures/make_story5_stubs.py` from the pinned commit: collect.rs: kind, name, parse_name, resolve, manifest; collector.rs: plan, store_dir, pull_file, collect_run, wanted; server.rs: file_of.
Signatures and the text between functions are as they stood; only the eleven bodies changed.

They are fixtures for the stub detector (`is_stub`): all eleven must read as stubs. A refresh is deliberate:
change `PINNED_SHORT` in the script, run it, and say why here.
