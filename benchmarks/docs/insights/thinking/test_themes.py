"""themes_to_analytics.aggregate and theme_model.paragraphs. Run: uv run --with pytest --with numpy --with scikit-learn --with scipy --with joblib pytest -q test_themes.py"""
import numpy as np
import theme_model as tm
from themes_to_analytics import aggregate

def test_the_characters_are_split_by_weight_and_sum_to_the_total():
    texts = ["a" * 100, "b" * 50]
    w = np.array([[0.75, 0.25, 0.0], [0.0, 0.4, 0.6]])
    chars, counts = aggregate(texts, w)
    assert chars.tolist() == [75.0, 45.0, 30.0] and chars.sum() == 150.0
    assert counts.tolist() == [1, 0, 1]

def test_a_theme_nobody_is_strongest_in_still_has_a_count_of_zero():
    chars, counts = aggregate(["x" * 10], np.array([[0.2, 0.8]]))
    assert counts.tolist() == [0, 1] and len(chars) == 2

def test_paragraphs_are_blank_line_separated_and_at_least_forty_characters():
    short, long_ = "Let me check.", "x" * 40
    assert tm.paragraphs(f"{short}\n\n{long_}\n \n{long_ + 'y'}") == [long_, long_ + "y"]
    assert tm.paragraphs("") == []
