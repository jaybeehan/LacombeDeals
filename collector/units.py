"""Turn messy flyer price text into comparable unit prices.

Flyers print prices many ways: "6.19 /lb", "1.98 Per 100 g.", "3 for 8",
"6.49 /lb$14.31/kg", "4.49" with "1 L" buried in the product name, and so on.
`unit_price()` reduces each item to one of three comparison bases:

    kg  - price per kilogram (anything sold by weight)
    L   - price per litre (anything sold by volume)
    ea  - price per item, when no size can be determined safely

Only one clear size is ever used. Ranges ("300-700 ML") and alternatives with
different sizes ("300ml or 400g") fall back to "ea" so we never compare a
guess against a real number.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

LB_PER_KG = 2.2046226
OZ_PER_KG = 35.273962


@dataclass
class UnitPrice:
    price: Optional[float]          # what you pay for one (after "3 for $8" -> 2.67)
    unit_price: Optional[float]     # price per basis unit (kg, L or ea)
    basis: str                      # "kg", "L" or "ea"
    multi: Optional[int] = None     # e.g. 3 for "3 for $8"
    size_text: Optional[str] = None # the size we used, for display ("1.5 L")
    per_weight: bool = False        # True when sold by weight at the counter (/lb, /100 g)

    def display(self) -> str:
        """Human friendly unit price: $/lb for weight, $/L for volume."""
        if self.unit_price is None:
            return ""
        if self.basis == "kg":
            return f"${self.unit_price / LB_PER_KG:.2f}/lb · ${self.unit_price:.2f}/kg"
        if self.basis == "L":
            if self.unit_price < 3:
                return f"${self.unit_price:.2f}/L"
            return f"${self.unit_price:.2f}/L · ${self.unit_price / 10:.2f}/100 mL"
        return f"${self.unit_price:.2f} ea"


_NUM = r"(\d+(?:[.,]\d+)?)"
_MULTI_RE = re.compile(r"(\d+)\s*(?:for|/)\s*$", re.I)        # pre_price_text "3 for", "2/"
_MULTI_ANY = re.compile(r"\b(\d+)\s*for\b", re.I)
_DOLLAR_PER_KG = re.compile(r"\$?\s*" + _NUM + r"\s*/\s*kg", re.I)
_DOLLAR_PER_LB = re.compile(r"\$?\s*" + _NUM + r"\s*/\s*lb", re.I)

# sizes inside product names, e.g. "1.5 L", "354 ML", "12 x 355 mL", "284 G", "2 lb"
_SIZE_RE = re.compile(
    r"(?:(\d+)\s*[x×]\s*)?" + _NUM + r"\s*(kg|g|gr|lbs?|oz|ml|l|litres?|liters?)\b(?!\s*[-–]\s*\d)",
    re.I,
)
_RANGE_RE = re.compile(_NUM + r"\s*(?:[-–]|to)\s*" + _NUM + r"\s*(kg|g|ml|l|lb)\b", re.I)
_ALT_RE = re.compile(_NUM + r"\s*/\s*" + _NUM + r"\s*(kg|g|ml|l|lb)\b", re.I)
_PACK_RE = re.compile(r"\b(\d+)\s*(?:'s|pk|pack|ct|count)\b", re.I)


def _f(s: str) -> float:
    return float(s.replace(",", "."))


def _norm_size(qty: float, unit: str):
    u = unit.lower()
    if u in ("kg",):
        return qty, "kg"
    if u in ("g", "gr"):
        return qty / 1000.0, "kg"
    if u in ("lb", "lbs"):
        return qty / LB_PER_KG, "kg"
    if u == "oz":
        return qty / OZ_PER_KG, "kg"
    if u == "ml":
        return qty / 1000.0, "L"
    if u in ("l", "litre", "litres", "liter", "liters"):
        return qty, "L"
    return None, None


def size_from_name(name: str):
    """Return (amount, basis, text) for one unambiguous size in a product name."""
    if not name:
        return None
    if _RANGE_RE.search(name) or re.search(r"\bup to\b", name, re.I):
        return None
    # "1.66/1.74 KG" or "Pizza Pops 8's or Pizza Bites 693 G": the size may only
    # belong to one of several products, so don't trust it.
    if _ALT_RE.search(name) or re.search(r"\bor\b", name, re.I):
        return None
    found = []
    for m in _SIZE_RE.finditer(name):
        count = int(m.group(1)) if m.group(1) else 1
        amt, basis = _norm_size(_f(m.group(2)), m.group(3))
        if amt is None or amt <= 0:
            continue
        found.append((amt * count, basis, m.group(0).strip()))
    if not found:
        return None
    # Several sizes are only OK if they are all the same ("946 ML/ 1 L" is not)
    uniq = {(round(a, 4), b) for a, b, _ in found}
    if len(uniq) > 1:
        return None
    amt, basis, text = found[0]
    # sanity: ignore silly sizes (e.g. "0 g", 500 kg)
    if basis == "kg" and not (0.01 <= amt <= 25):
        return None
    if basis == "L" and not (0.05 <= amt <= 30):
        return None
    return amt, basis, text


def unit_price(name: str, current_price, pre_text: str = None, post_text: str = None,
               sale_story: str = None) -> UnitPrice:
    """Work out a comparable unit price for one flyer item."""
    pre = (pre_text or "").strip()
    post = (post_text or "").strip()
    try:
        price = float(current_price) if current_price not in (None, "") else None
    except (TypeError, ValueError):
        price = None

    multi = None
    m = _MULTI_RE.search(pre) or _MULTI_ANY.search(pre)
    if m:
        n = int(m.group(1))
        if 1 < n <= 12 and price is not None:
            multi = n
            price = price / n

    low_post = post.lower()
    # Some flyers print the per-kg price right in the post text: "/lb$14.31/kg"
    mk = _DOLLAR_PER_KG.search(post)
    if mk and "$" in post:
        return UnitPrice(price, _f(mk.group(1)), "kg", multi, None, True)

    if price is None:
        return UnitPrice(None, None, "ea", multi)

    if "over limit" in low_post:
        low_post = ""  # "OVER LIMIT PAY 5 EA" - the real price is per item

    if re.search(r"100\s*g", low_post):
        return UnitPrice(price, price * 10.0, "kg", multi, "100 g", True)
    if re.search(r"(^|[^a-z])(lb|lbs|pound)\b", low_post):
        return UnitPrice(price, price * LB_PER_KG, "kg", multi, "lb", True)
    if re.search(r"(^|[^a-z])kg\b", low_post):
        return UnitPrice(price, price, "kg", multi, "kg", True)
    if re.search(r"100\s*ml", low_post):
        return UnitPrice(price, price * 10.0, "L", multi, "100 mL", True)

    size = size_from_name(name)
    if size:
        amt, basis, text = size
        return UnitPrice(price, price / amt, basis, multi, text)
    return UnitPrice(price, price, "ea", multi)


def savings_pct(current_price, original_price=None, sale_story: str = None, discount=None):
    """Percent off the store's own regular price, if the flyer tells us."""
    try:
        if original_price and current_price:
            cur, orig = float(current_price), float(original_price)
            if orig > cur > 0:
                return round(100 * (1 - cur / orig))
    except (TypeError, ValueError):
        pass
    if discount:
        try:
            d = float(discount)
            if 0 < d < 95:
                return round(d)
        except (TypeError, ValueError):
            pass
    if sale_story:
        m = re.search(r"(\d{1,2})\s*%\s*off|save\s*(\d{1,2})\s*%", sale_story, re.I)
        if m:
            return int(m.group(1) or m.group(2))
        if re.search(r"buy\s*1\s*get\s*1|bogo|2\s*for\s*1", sale_story, re.I):
            return 50
    return None
