"""Decide how good a price is.

Signals, strongest first:
  1. Your target price (if you set one) - at or under it is always "Stock up".
  2. Price history we have collected for this item (every flyer, every store,
     every 6 hours). Reference = median of past prices. This gets better each week.
  3. Other stores' prices for the same item this week (used while history is thin).
  4. The store's own "was $X / save Y%" claim - trusted least (regular prices are
     often inflated), so on its own it can reach "Great" but never "Stock up".
"""
from __future__ import annotations

import statistics
from datetime import datetime, timezone

TIERS = ["above", "regular", "good", "great", "stockup"]
LABELS = {
    "stockup": "Stock up",
    "great": "Great deal",
    "good": "Good deal",
    "regular": "Regular price",
    "above": "Pricier than usual",
    "unknown": "Not enough info",
}


def _bump(cur, new):
    return new if TIERS.index(new) > TIERS.index(cur) else cur


def rate(unit_price, basis, past, current_others, savings_pct=None,
         target_price=None, target_basis=None):
    """
    unit_price      this item's comparable price
    past            list of unit prices from previous flyers (same basis, same watch)
    current_others  list of unit prices at other stores this week (same basis)
    Returns dict: tier, label, pct (below reference), reference, reason, confidence
    """
    out = {"tier": "unknown", "label": LABELS["unknown"], "pct": None, "reference": None,
           "reason": "", "confidence": "low", "low_ever": False}
    if unit_price is None or unit_price <= 0:
        if savings_pct:
            t = "great" if savings_pct >= 40 else "good" if savings_pct >= 20 else "regular"
            out.update(tier=t, label=LABELS[t], reason=f"Store says {savings_pct}% off")
        return out

    past = [p for p in past if p and p > 0]
    others = [p for p in current_others if p and p > 0]
    reasons = []
    tier = "regular"

    ref = None
    from_history = len(past) >= 4
    if from_history:
        ref = statistics.median(past)
        out["confidence"] = "high" if len(past) >= 12 else "medium"
        src = f"usual {fmt(ref, basis)}"
    elif basis in ("kg", "L") and len(others) >= 2:
        # Other stores this week. Names differ between stores, so this is only a
        # rough guide: it can lift an item to "Good" but never higher, and never
        # marks something as pricey.
        ref = statistics.median(others + [unit_price])
        src = f"typical {fmt(ref, basis)} at other stores this week"
    if ref:
        pct = round(100 * (1 - unit_price / ref))
        if not from_history and abs(pct) > 45:
            # far off other stores' prices = almost certainly a different product
            ref, pct = None, None
    if ref:
        out["pct"], out["reference"] = pct, ref
        if from_history:
            if pct >= 30:
                tier = "stockup"
            elif pct >= 18:
                tier = "great"
            elif pct >= 7:
                tier = "good"
            elif pct <= -12:
                tier = "above"
        elif pct >= 15:
            tier = "good"
        if pct >= 3:
            reasons.append(f"{pct}% below {src}")
        elif pct <= -3 and from_history:
            reasons.append(f"{-pct}% above {src}")
        elif from_history:
            reasons.append(f"about the {src}")
        if len(past) >= 6 and unit_price <= min(past) * 1.001:
            out["low_ever"] = True
            reasons.append("lowest price we've seen")
            if len(past) >= 10:
                tier = _bump(tier, "great")

    if basis in ("kg", "L") and len(others) >= 2 and unit_price <= min(others) * 1.001:
        reasons.append("cheapest store this week")

    if savings_pct:
        t = "great" if savings_pct >= 40 else "good" if savings_pct >= 20 else None
        if t and (ref is None or tier != "above"):
            tier = _bump(tier, t)
        reasons.append(f"store says {savings_pct}% off")

    if target_price and (not target_basis or target_basis == basis) and unit_price <= target_price * 1.001:
        tier = "stockup"
        reasons.insert(0, f"at/under your target {fmt(target_price, basis)}")

    if ref is None and not savings_pct and tier == "regular":
        tier = "unknown"
        reasons.append("still learning prices for this item")

    out.update(tier=tier, label=LABELS[tier], reason=" · ".join(reasons))
    return out


def fmt(v, basis):
    if v is None:
        return ""
    if basis == "kg":
        return f"${v / 2.2046226:.2f}/lb"
    if basis == "L":
        return f"${v:.2f}/L"
    return f"${v:.2f}"


def is_active(valid_to: str) -> bool:
    try:
        return datetime.fromisoformat(valid_to.replace("Z", "+00:00")) > datetime.now(timezone.utc)
    except Exception:
        return True
