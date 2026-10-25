# Lacombe Deals

**Site:** https://jaybeehan.github.io/LacombeDeals/

This week's grocery deals in Lacombe, built around shopping at Sobeys. Refreshed every 6 hours by GitHub Actions.

- **This week** – the week's flyer at a glance: the single best Sobeys deal, Sobeys' biggest savings, five suppers you can make from what's on sale (with cost and one-tap "Add to list"), items worth buying at another Lacombe store instead, pantry stock-ups, and Lacombe restaurant deals from RedFlagDeals.
- **Flip** – swipe through the Sobeys flyer (or every store's) one deal at a time: right adds it to your list, left skips.
- **List** – your shopping list grouped by store, with totals and a Send button to text it.
- **Search** – anything in every Lacombe flyer, cheapest first by the pound or litre.

Stores: Sobeys, No Frills, Co-op, M&M Food Market, Shoppers Drug Mart and Rexall (food and drinks only). The gear button sets your usual store and which stores to include. Your list and settings are saved in your browser.

Code: `collector/` (Python, runs in Actions; edit `config.py` for stores and searches) and `site/` (the page; supper ideas are in `SUPPERS` in `app.js`).
