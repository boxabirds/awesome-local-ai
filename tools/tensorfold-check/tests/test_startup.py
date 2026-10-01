"""Reading the keep-prompt limit from TensorFold's startup log, and what it means for pi's context limit."""

from tfcheck import startup

# The three lines src/tensorfold/cli.py (v0.6.0) prints, as printed.
FITTED = ("[tensorfold] context window 140,288 tokens: the most one request can use in the 107.5 GiB memory budget "
          "and still keep its prompt for the next turn (the model's window is 262,144); have clients compact before it")
EXPLICIT_SHORT = ("[tensorfold] requests up to 98,304 tokens keep their prompt for the next turn in the 89.6 GiB "
                  "memory budget; a longer one is served, and its next turn prefills again")
SERVING = ("[tensorfold] serving bench at http://127.0.0.1:18950/v1 (sampling: temperature 1.0, top_p 0.95, top_k 20; "
           "drafts: on; context: 131072; loaded in 212.4s)")
SERVING_UNLIMITED = SERVING.replace("context: 131072", "context: unlimited")


def test_a_fitted_window_is_the_keep_prompt_limit():
    k = startup.keep_limit("noise\n" + FITTED + "\n" + SERVING.replace("131072", "140288"))
    assert k == {"keep_limit": 140_288, "source": "fitted", "line": FITTED, "context_window": 140_288,
                 "load_seconds": 212.4}


def test_an_explicit_window_that_cannot_keep_every_prompt_says_how_far_it_can():
    k = startup.keep_limit(EXPLICIT_SHORT + "\n" + SERVING)
    assert k["keep_limit"] == 98_304 and k["source"] == "requests-up-to" and k["context_window"] == 131_072


def test_an_explicit_window_with_no_warning_keeps_every_prompt_it_admits():
    k = startup.keep_limit(SERVING)
    assert k["keep_limit"] == 131_072 and k["source"] == "serving-context"


def test_no_limit_can_be_read_from_an_unlimited_window_or_no_serving_line():
    assert startup.keep_limit(SERVING_UNLIMITED)["keep_limit"] is None
    assert startup.keep_limit("[tensorfold] loading...")["keep_limit"] is None
    assert startup.is_serving(SERVING) and not startup.is_serving("[tensorfold] loading...")


def test_pi_context_limit_keeps_pis_compaction_point_plus_reply_inside_the_window():
    # pi compacts once context passes CONTEXT_LIMIT - 16384 and asks for 32768 reply tokens every request
    assert startup.pi_context_limit(200_000) == startup.CONTEXT_CEILING            # room to spare: the same as mlx-serve
    assert startup.pi_context_limit(140_288) == 140_288 - 32_768 + 16_384          # lower, so pi compacts in time
    assert startup.pi_context_limit(131_072 + 32_768 - 16_384) == startup.CONTEXT_CEILING


def test_the_load_time_is_read_from_the_serving_line():
    assert startup.keep_limit(FITTED + "\n" + SERVING)["load_seconds"] == 212.4
    assert startup.keep_limit("[tensorfold] loading...")["load_seconds"] is None
