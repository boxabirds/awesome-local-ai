"""Does a tool call's arguments object match its JSON schema's types? Just what pi's tool schemas use.

pi sends its tools in strict form: every property listed as required, the optional ones as anyOf [type, null]. A
property whose schema admits null may therefore be left out (pi's own validation allows it); one that doesn't is
truly required. A value of the wrong JSON type, such as "30" where a number is declared (a stringified number), is
a problem, and so is a property the schema does not declare when additionalProperties is false.
"""

from __future__ import annotations

JSON_TYPES = {
    "string": lambda v: isinstance(v, str),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
    "null": lambda v: v is None,
}


def _type_name(v) -> str:
    for name in ("null", "boolean", "integer", "number", "string", "array", "object"):
        if JSON_TYPES[name](v):
            return name
    return type(v).__name__


def admits_null(s: dict) -> bool:
    if "anyOf" in s or "oneOf" in s:
        return any(admits_null(x) for x in s.get("anyOf", s.get("oneOf", [])))
    t = s.get("type")
    return t == "null" or (isinstance(t, list) and "null" in t)


def problems(value, s: dict, path: str = "") -> list[str]:
    """Every way `value` breaks schema `s`, each naming where (e.g. 'edits[0].newText')."""
    where = path or "arguments"
    alts = s.get("anyOf") or s.get("oneOf")
    if alts:
        found = [problems(value, alt, path) for alt in alts]
        if any(not f for f in found):
            return []
        wanted = " or ".join(str(a.get("type", "?")) for a in alts)
        return [f"{where} is a {_type_name(value)} ({value!r:.60}) where the schema says {wanted}"]
    t = s.get("type")
    if t is None:
        return []
    types = t if isinstance(t, list) else [t]
    if not any(JSON_TYPES.get(x, lambda v: True)(value) for x in types):
        return [f"{where} is a {_type_name(value)} ({value!r:.60}) where the schema says {' or '.join(types)}"]
    out: list[str] = []
    if "enum" in s and value not in s["enum"]:
        out.append(f"{where} is {value!r:.60}, not one of {s['enum']}")
    if isinstance(value, dict) and "object" in types:
        props = s.get("properties") or {}
        for name in s.get("required") or []:
            if name not in value and not admits_null(props.get(name, {})):
                out.append(f"{(path + '.' if path else '')}{name} is missing (required)")
        for name, v in value.items():
            sub = f"{path}.{name}" if path else name
            if name in props:
                out += problems(v, props[name], sub)
            elif s.get("additionalProperties") is False:
                out.append(f"{sub} is not a property the schema declares")
    if isinstance(value, list) and "array" in types and isinstance(s.get("items"), dict):
        for i, v in enumerate(value):
            out += problems(v, s["items"], f"{where}[{i}]")
    return out
