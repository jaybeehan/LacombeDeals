"""Loose-but-sane text matching between a watch term and flyer item names."""
from __future__ import annotations

import re
import unicodedata

_STOP = {"the", "a", "an", "of", "and", "or", "with", "in", "for", "fresh", "pc", "no", "name"}


def normalize(text: str) -> str:
    """Lowercase, strip accents/trademarks/punctuation; used as the item's identity."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKD", text)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = t.lower().replace("®", " ").replace("™", " ").replace("&", " and ")
    t = re.sub(r"[^a-z0-9%.]+", " ", t)
    t = re.sub(r"(?<![0-9])\.|\.(?![0-9])", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def stem(word: str) -> str:
    """Very small English stemmer: breasts->breast, tomatoes->tomato, berries->berry."""
    w = word
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 4 and w.endswith(("oes", "ches", "shes", "xes", "sses")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def tokens(text: str):
    return [stem(w) for w in normalize(text).split() if w not in _STOP]


def matches(query: str, name: str, exclude=()) -> bool:
    """True when every word of the query appears in the item name (plurals ok),
    and none of the exclude words/phrases do."""
    qt = tokens(query)
    if not qt:
        return False
    nt = set(tokens(name))
    # allow a compound word in the name to satisfy two query words (ground beef ~ groundbeef)
    joined = "".join(tokens(name))
    for w in qt:
        if w not in nt and not any(n.startswith(w) and len(w) >= 4 for n in nt):
            if w not in joined:
                return False
    nn = " " + normalize(name) + " "
    nst = " " + " ".join(tokens(name)) + " "
    for ex in exclude or ():
        ex = (ex or "").strip()
        if not ex:
            continue
        exn = " " + normalize(ex) + " "
        exs = " " + " ".join(tokens(ex)) + " "
        if exn in nn or exs in nst:
            return False
    return True
