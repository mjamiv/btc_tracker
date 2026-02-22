#!/usr/bin/env python3
"""Sync Coinbase Advanced Trade BTC fills into transactions.csv."""

from __future__ import annotations

import csv
import datetime as dt
import os
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = REPO_ROOT / "transactions.csv"
CSV_FIELDS = [
    "Timestamp",
    "Quantity Transacted",
    "Price Currency",
    "Price at Transaction",
    "Subtotal",
    "Total",
    "Fees",
    "Exchange",
]
CENT = Decimal("0.01")


def parse_decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def format_usd(value: Decimal) -> str:
    rounded = value.quantize(CENT, rounding=ROUND_HALF_UP)
    return f"${rounded:,.2f}"


def parse_row_timestamp(value: str) -> dt.datetime:
    value = (value or "").strip()
    if not value:
        return dt.datetime.min.replace(tzinfo=dt.timezone.utc)
    try:
        parsed = dt.datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        return parsed.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        pass
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except ValueError:
        return dt.datetime.min.replace(tzinfo=dt.timezone.utc)


def format_timestamp_utc(value: str) -> str:
    parsed = parse_row_timestamp(value)
    return parsed.astimezone(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def row_key(row: dict[str, str]) -> str:
    return "|".join(
        [
            row.get("Timestamp", "").strip(),
            row.get("Quantity Transacted", "").strip(),
            row.get("Price at Transaction", "").strip(),
            row.get("Total", "").strip(),
            row.get("Exchange", "").strip(),
        ]
    )


def normalize_row(row: dict[str, str]) -> dict[str, str]:
    normalized = {field: (row.get(field, "") or "").strip() for field in CSV_FIELDS}
    if not normalized["Price Currency"]:
        normalized["Price Currency"] = "USD"
    return normalized


def load_existing_rows() -> list[dict[str, str]]:
    if not CSV_PATH.exists():
        return []
    with CSV_PATH.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return [normalize_row(row) for row in reader if row.get("Timestamp")]


def write_rows(rows: list[dict[str, str]]) -> None:
    with CSV_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def to_dict(response: object) -> dict:
    if hasattr(response, "to_dict"):
        return response.to_dict()
    if isinstance(response, dict):
        return response
    raise RuntimeError("Unexpected Coinbase response payload")


def fetch_fills(client: object, product_id: str, limit: int, max_pages: int) -> list[dict]:
    fills: list[dict] = []
    cursor: str | None = None

    for _ in range(max_pages):
        kwargs: dict[str, object] = {"product_ids": product_id, "limit": limit}
        if cursor:
            kwargs["cursor"] = cursor

        response = client.get_fills(**kwargs)
        payload = to_dict(response)
        page = payload.get("fills")
        if not isinstance(page, list):
            break

        fills.extend(item for item in page if isinstance(item, dict))
        cursor = payload.get("cursor") if isinstance(payload.get("cursor"), str) else None
        if not cursor or not page:
            break

    return fills


def fill_to_row(fill: dict[str, object], expected_product_id: str) -> dict[str, str] | None:
    side = str(fill.get("side") or "").upper()
    if side != "BUY":
        return None

    product_id = str(fill.get("product_id") or "").upper()
    if expected_product_id and product_id != expected_product_id:
        return None

    size = parse_decimal(fill.get("size"))
    price = parse_decimal(fill.get("price"))
    commission = parse_decimal(fill.get("commission"))
    if size <= 0 or price <= 0:
        return None

    trade_time = str(fill.get("trade_time") or "").strip()
    if not trade_time:
        return None

    subtotal = (size * price).quantize(CENT, rounding=ROUND_HALF_UP)
    total = (subtotal + commission).quantize(CENT, rounding=ROUND_HALF_UP)

    return {
        "Timestamp": format_timestamp_utc(trade_time),
        "Quantity Transacted": f"{size:.8f}",
        "Price Currency": "USD",
        "Price at Transaction": format_usd(price),
        "Subtotal": format_usd(subtotal),
        "Total": format_usd(total),
        "Fees": format_usd(commission),
        "Exchange": "Coinbase",
    }


def main() -> int:
    try:
        from coinbase.rest import RESTClient
    except ModuleNotFoundError:
        print(
            "Missing dependency 'coinbase-advanced-py'. Install with: python -m pip install coinbase-advanced-py",
            file=sys.stderr,
        )
        return 1

    api_key = os.getenv("COINBASE_API_KEY", "").strip()
    api_secret = os.getenv("COINBASE_API_SECRET", "").strip()
    if not api_key or not api_secret:
        print("COINBASE_API_KEY and COINBASE_API_SECRET are required.", file=sys.stderr)
        return 1

    product_ids_raw = os.getenv("COINBASE_PRODUCT_IDS", "BTC-USD")
    product_ids = [item.strip().upper() for item in product_ids_raw.split(",") if item.strip()]
    if not product_ids:
        product_ids = ["BTC-USD"]

    limit = int(os.getenv("COINBASE_FILLS_LIMIT", "100"))
    max_pages = int(os.getenv("COINBASE_MAX_PAGES", "10"))

    existing_rows = load_existing_rows()
    seen = {row_key(row) for row in existing_rows}

    client = RESTClient(api_key=api_key, api_secret=api_secret)

    new_rows: list[dict[str, str]] = []
    for product_id in product_ids:
        try:
            fills = fetch_fills(client, product_id=product_id, limit=limit, max_pages=max_pages)
        except Exception as exc:  # noqa: BLE001
            print(f"Failed to fetch fills for {product_id}: {exc}", file=sys.stderr)
            return 1

        for fill in fills:
            row = fill_to_row(fill, expected_product_id=product_id)
            if not row:
                continue
            key = row_key(row)
            if key in seen:
                continue
            seen.add(key)
            new_rows.append(row)

    if not new_rows:
        print("No new Coinbase fills found.")
        return 0

    combined = existing_rows + new_rows
    combined.sort(key=lambda row: parse_row_timestamp(row.get("Timestamp", "")), reverse=True)
    write_rows(combined)

    print(f"Added {len(new_rows)} new Coinbase transaction row(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
