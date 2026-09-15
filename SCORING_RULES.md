# Market Forward Test — Automatic Session Classification Rules

These rules are intentionally deterministic. The app should produce the same result from the same market data every time. AI is not used to decide whether a user's forecast was correct.

## 1. Expected opening
Compare the Nifty session open with the previous trading session close.

- **Gap Up**: open is at least `+0.15%` above previous close
- **Gap Down**: open is at least `-0.15%` below previous close
- **Flat**: otherwise

The threshold is a product parameter and can be revised after forward testing.

## 2. Actual market bias
Compare the Nifty session close with the previous trading session close.

- **Bullish**: close is at least `+0.20%` above previous close
- **Bearish**: close is at least `-0.20%` below previous close
- **Sideways**: otherwise

This defines bias on a close-to-close basis, not open-to-close.

## 3. Day type
Primary classification uses 15-minute candles.

### Reversal
A session is classified as **Reversal** when the intraday path shows a meaningful move in one direction followed by a finish in the opposite direction. The pilot checks:

- order of the session high and low,
- excursion from the opening price,
- first-hour move,
- final open-to-close move.

A meaningful excursion currently uses approximately `0.35%` from the open.

### Trend
If a reversal is not detected, a session is classified as **Trend** when:

- candle body is at least 45% of the full daily high-low range,
- directional path efficiency is at least 35%, and
- the close finishes in the upper 28% or lower 28% of the daily range.

### Range
All other sessions are classified as **Range**.

### Fallback
If intraday candles are temporarily unavailable, the system uses daily OHLC only:

- Trend if body >= 55% of range and the close is near an extreme,
- otherwise Range.

Daily OHLC alone cannot reliably identify the sequence of a reversal, so this fallback is intentionally conservative.

## 4. Key levels
The current V1/V2 scoring model compares:

- predicted support with the actual session low,
- predicted resistance with the actual session high.

This is simple and useful for early testing, but it should be revisited before public launch because true support/resistance quality is not identical to predicting the exact session low/high.

## 5. Score weights
Current total = 100 points:

- Bias: 25
- Opening: 20
- Day type: 20
- Support: 17.5
- Resistance: 17.5

Support/resistance receive partial credit based on distance from the session low/high.

## 6. Product principle
Classification rules must be:

- defined before evaluating the user's prediction,
- applied equally to every user,
- versioned when changed,
- auditable from the stored market data,
- free from hindsight rewriting.

Future versions should store a `scoring_rule_version` with every automatic result so historical scores remain reproducible after methodology changes.
