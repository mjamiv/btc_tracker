#!/usr/bin/env python3
"""Update historical_btc_prices.csv with missing daily BTC close prices."""

import csv
import datetime as dt
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = REPO_ROOT / "historical_btc_prices.csv"
COINGECKO_URLS = [
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max&interval=daily",
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily",
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=120&interval=daily",
]


def format_mdy(date_obj: dt.date) -> str:
    return f"{date_obj.month}/{date_obj.day}/{date_obj.year}"


def load_existing_prices() -> dict[dt.date, str]:
    if not CSV_PATH.exists():
        return {}

    prices: dict[dt.date, str] = {}
    with CSV_PATH.open("r", newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        for row in reader:
            raw_date = (row.get("Date") or "").strip()
            raw_price = (row.get("Price") or "").strip()
            if not raw_date or not raw_price:
                continue
            try:
                parsed_date = dt.datetime.strptime(raw_date, "%m/%d/%Y").date()
            except ValueError:
                continue
            prices[parsed_date] = raw_price
    return prices


def fetch_recent_daily_prices() -> dict[dt.date, int]:
    last_error: Exception | None = None
    for url in COINGECKO_URLS:
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "btc-tracker-updater/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            continue

        points = data.get("prices")
        if not isinstance(points, list):
            last_error = RuntimeError("CoinGecko response missing 'prices' array")
            continue

        recent_prices: dict[dt.date, int] = {}
        for item in points:
            if not isinstance(item, list) or len(item) < 2:
                continue
            ts_ms, price = item[0], item[1]
            if not isinstance(ts_ms, (int, float)) or not isinstance(price, (int, float)):
                continue
            date_utc = dt.datetime.fromtimestamp(ts_ms / 1000, tz=dt.timezone.utc).date()
            recent_prices[date_utc] = int(round(price))
        if recent_prices:
            return recent_prices

    raise RuntimeError(f"Unable to fetch daily prices from CoinGecko: {last_error}")


def write_prices(prices: dict[dt.date, str]) -> None:
    ordered = sorted(prices.items(), key=lambda item: item[0], reverse=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["Date", "Price"])
        for date_obj, price in ordered:
            writer.writerow([format_mdy(date_obj), price])


def main() -> int:
    existing = load_existing_prices()
    latest_existing = max(existing.keys()) if existing else dt.date(2010, 1, 1)

    try:
        recent_prices = fetch_recent_daily_prices()
    except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Failed to fetch BTC daily prices: {exc}", file=sys.stderr)
        return 1

    today_utc = dt.datetime.now(dt.timezone.utc).date()
    latest_allowed = today_utc - dt.timedelta(days=1)

    added = 0
    for date_obj, price in recent_prices.items():
        if date_obj <= latest_existing:
            continue
        if date_obj > latest_allowed:
            continue
        existing[date_obj] = str(price)
        added += 1

    if added == 0:
        print("No historical price updates needed.")
        return 0

    write_prices(existing)
    print(f"Added {added} missing day(s) of BTC prices through {format_mdy(latest_allowed)} UTC.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
