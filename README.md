# Lacombe Deals

**Site:** https://jaybeehan.github.io/LacombeDeals/

Grocery flyer deals and restaurant/delivery promos for Lacombe, AB. Refreshed automatically every 6 hours by GitHub Actions — nothing to run or host.

## What it does

**Groceries**
- **My items** – add things you buy (chicken breast, butter, coffee…). Each one is matched against every grocery flyer for the area and rated **Stock up / Great deal / Good deal / Regular price / Pricier than usual**, with a 6-month price sparkline. Set a target price (⋯ button) and anything at or under it shows as *Stock up*. Hide wrong matches with *Not this* or exclude words.
- **Top deals** – the best-rated deals across all stores, by department.
- **Compare** – search anything and see every store's price sorted by $/lb, $/L or each.
- **Flyers** – every grocery flyer, searchable, with a link to the full flyer on Flipp.
- **List** – tap **+** on any deal to build a shopping list grouped by store; copy it to text.
- *Lacombe stores only* toggle and per-store choices (most other flyers are Red Deer stores).

**Restaurants**
- Current delivery promos for Lacombe restaurants (Uber Eats; DoorDash when it allows it), with a NEW tag for promos that just appeared.
- Restaurant chain and delivery-app deals posted on RedFlagDeals (Lacombe chains first).
- Your own notes for weekly specials, and a list of every Lacombe restaurant with menu and deal-search links.

Your items, list, store choices and notes are saved in your browser. Use **Share them to another phone** on the *My items* page to copy them to another device.

## How ratings work

Each run records every flyer price (store, size, $/kg or $/L) on the `data` branch. A price is compared with the median of past prices for the same item: 7%+ below = Good, 18%+ = Great, 30%+ = Stock up, 12%+ above = Pricier than usual. While history is still short, ratings lean on the store's own "% off" and on other stores' prices this week, so they get sharper after a few weeks.

## Running it

- **Refresh now:** Actions → *Update deals & publish site* → *Run workflow*.
- **Change what's tracked:** edit `collector/config.py` (postal code, Lacombe store list, searched staples, restaurant chains).
- Code: `collector/` (Python, runs in Actions) and `site/` (static page).

Data sources: Flipp (store flyers), Uber Eats Lacombe page, DoorDash Lacombe page, RedFlagDeals Hot Deals feed. Always confirm prices in the store's flyer.
