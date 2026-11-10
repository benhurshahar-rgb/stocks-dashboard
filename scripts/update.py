"""Fetch prices for every stock in config.json and write data.json.

Runs in GitHub Actions (free). Uses Yahoo Finance via yfinance.
Close prices are split-adjusted, not dividend-adjusted (price return).
"""
import json
import math
import datetime as dt
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
NY = "America/New_York"


def closes(ticker, start):
    """Daily closes as a pandas Series indexed by date (python date)."""
    df = yf.download(ticker, start=start, interval="1d", auto_adjust=False,
                     progress=False, threads=False)
    if df is None or df.empty:
        return None
    col = df["Close"]
    if isinstance(col, pd.DataFrame):  # multi-index columns
        col = col.iloc[:, 0]
    col = col.dropna()
    col.index = [d.date() for d in pd.to_datetime(col.index)]
    if ticker.upper().endswith(".TA"):  # Tel Aviv prices come in agorot
        col = col / 100.0
    return col


def at_or_before(series, day):
    s = series[[d <= day for d in series.index]]
    return (s.index[-1], float(s.iloc[-1])) if len(s) else (None, None)


def minus_months(d, n):
    m = d.month - n
    y = d.year + (m - 1) // 12
    m = (m - 1) % 12 + 1
    last = [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return dt.date(y, m, min(d.day, last))


def main():
    today = dt.date.today()
    start = (today - dt.timedelta(days=3 * 366 + 40)).isoformat()
    tickers = sorted({a["ticker"] for a in CFG["assets"] if a.get("type") == "stock" and a.get("ticker")})

    data, missing = {}, []
    for t in tickers:
        try:
            s = closes(t, start)
        except Exception as e:  # noqa: BLE001
            print("fail", t, e)
            s = None
        if s is None or len(s) < 5:
            missing.append(t)
        else:
            data[t] = s

    # Reference calendar: SPY if present, else the longest series
    ref = data.get("SPY")
    if ref is None and data:
        ref = max(data.values(), key=len)
    if ref is None:
        raise SystemExit("no data at all")
    days = list(ref.index)
    as_of = days[-1]
    prev_days = [d for d in days if d < as_of]

    targets = {
        "1d": prev_days[-1],
        "1w": as_of - dt.timedelta(days=7),
        "1m": minus_months(as_of, 1),
        "ytd": dt.date(as_of.year - 1, 12, 31),
        "1y": minus_months(as_of, 12),
        "3y": minus_months(as_of, 36),
    }
    periods = {}
    for k, d in targets.items():
        dd, _ = at_or_before(ref, d)
        periods[k] = (dd or d).isoformat()

    fx = closes("ILS=X", start)
    fxo = {}
    if fx is not None and len(fx):
        fxo["now"] = round(at_or_before(fx, as_of)[1], 4)
        for k, d in periods.items():
            fxo[k] = round(at_or_before(fx, dt.date.fromisoformat(d))[1], 4)

    prices, series = {}, {}
    cut_daily = as_of - dt.timedelta(days=400)
    for t, s in data.items():
        p = {"now": round(at_or_before(s, as_of)[1], 4)}
        for k, d in periods.items():
            v = at_or_before(s, dt.date.fromisoformat(d))[1]
            if v is not None and not math.isnan(v):
                p[k] = round(v, 4)
        prices[t] = p
        pts, last_month = [], None
        idx = list(s.index)
        for i, d in enumerate(idx):
            v = round(float(s.iloc[i]), 2)
            if d >= cut_daily:
                pts.append([d.isoformat(), v])
            else:  # month-end points before the daily window
                nxt = idx[i + 1] if i + 1 < len(idx) else None
                if nxt is None or nxt.month != d.month or d == idx[0]:
                    pts.append([d.isoformat(), v])
        series[t] = pts

    now_utc = dt.datetime.now(dt.timezone.utc)
    ny = pd.Timestamp(now_utc).tz_convert(NY)
    market_open = (ny.weekday() < 5 and ny.date() == as_of
                   and (ny.hour, ny.minute) >= (9, 30) and (ny.hour, ny.minute) < (16, 0))

    out = {
        "asOf": as_of.isoformat(),
        "updatedAt": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "marketOpen": bool(market_open),
        "periods": periods,
        "fx": fxo,
        "prices": prices,
        "series": series,
        "missing": missing,
    }
    (ROOT / "data.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("asOf", as_of, "tickers", len(prices), "missing", missing, "open", market_open)


if __name__ == "__main__":
    main()
