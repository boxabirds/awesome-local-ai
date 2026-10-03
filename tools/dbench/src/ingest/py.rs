//! What the ports need to agree with CPython on: `round(x, n)`, `len(s)` (characters, not bytes),
//! `json.dumps` with its default separators and `ensure_ascii=False`, and `str()` of a JSON value.

use serde_json::Value;

/// `round(x, n)`: correctly rounded on the exact binary value, ties to even, as CPython does it.
/// Rust's `{:.n}` formatting is the same algorithm, so the text round-trips to the same float.
pub fn round_to(x: f64, n: usize) -> f64 {
    if !x.is_finite() {
        return x;
    }
    format!("{x:.n$}").parse().unwrap_or(x)
}

/// `len(s)` for a Python str: code points.
pub fn chars(s: &str) -> usize {
    s.chars().count()
}

/// The last `n` characters of a string (`s[-n:]`).
pub fn tail_chars(s: &str, n: usize) -> &str {
    let total = chars(s);
    if total <= n {
        return s;
    }
    let (i, _) = s.char_indices().nth(total - n).unwrap_or((0, ' '));
    &s[i..]
}

/// The first `n` characters (`s[:n]`).
pub fn head_chars(s: &str, n: usize) -> &str {
    match s.char_indices().nth(n) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

fn push_escaped(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// A float as `repr()` prints it: a whole number keeps its `.0`.
pub fn float_repr(f: f64) -> String {
    if f.is_finite() && f.fract() == 0.0 && f.abs() < 1e16 {
        format!("{f:.1}")
    } else {
        format!("{f}")
    }
}

fn push_value(out: &mut String, v: &Value) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else {
                out.push_str(&float_repr(n.as_f64().unwrap_or(0.0)));
            }
        }
        Value::String(s) => push_escaped(out, s),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                push_value(out, x);
            }
            out.push(']');
        }
        Value::Object(m) => {
            out.push('{');
            for (i, (k, x)) in m.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                push_escaped(out, k);
                out.push_str(": ");
                push_value(out, x);
            }
            out.push('}');
        }
    }
}

/// `json.dumps(v, ensure_ascii=False)`: `", "` and `": "` separators, keys in their original order,
/// non-ASCII characters as they are.
pub fn dumps(v: &Value) -> String {
    let mut out = String::new();
    push_value(&mut out, v);
    out
}

/// `str(v)` for a value out of a JSON object: a string as it is, a number as Python prints it,
/// `True`/`False`/`None`; a list or object as its JSON (near enough to Python's repr for a size).
pub fn str_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => (if *b { "True" } else { "False" }).to_string(),
        Value::Null => "None".to_string(),
        Value::Number(n) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => float_repr(n.as_f64().unwrap_or(0.0)),
        },
        other => dumps(other),
    }
}

/// Python's truthiness of a JSON value (`if x:`).
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(m)) => !m.is_empty(),
    }
}

/// `int(x or 0)` for a usage figure: a number, else 0.
pub fn int_or_zero(v: Option<&Value>) -> i64 {
    v.and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rounding_matches_cpython() {
        assert_eq!(round_to(0.571_428_571, 3), 0.571);
        assert_eq!(round_to(2.675, 2), 2.67); // the classic: 2.675 is below the tie in binary
        assert_eq!(round_to(0.5, 0), 0.0);
        assert_eq!(round_to(1.5, 0), 2.0);
        assert_eq!(round_to(30.799_999_999_999_997, 1), 30.8);
    }

    #[test]
    fn dumps_is_json_dumps() {
        let v = json!({"command": "ls \"x\"\n", "n": 3, "f": 1.0, "ok": true, "none": null, "é": ["a", {"b": 2}]});
        assert_eq!(
            dumps(&v),
            r#"{"command": "ls \"x\"\n", "n": 3, "f": 1.0, "ok": true, "none": null, "é": ["a", {"b": 2}]}"#
        );
        assert_eq!(chars("héllo"), 5);
        assert_eq!(tail_chars("héllo", 3), "llo");
        assert_eq!(head_chars("héllo", 2), "hé");
        assert_eq!(str_of(&json!(5)), "5");
        assert_eq!(str_of(&json!(5.0)), "5.0");
        assert_eq!(str_of(&json!(true)), "True");
        assert_eq!(str_of(&json!(null)), "None");
    }
}
