# Continental Gallery Calendar Crawler

Scrapes The Continental Gallery calendar using the Timely API (same feed used by the embedded widget) and outputs one row per artist. Multi-artist titles with inline `@time` segments are split into separate entries.

## Features
- Timely API fetch with venue filter (Gallery)
- Date range control via `daysAhead`
- Splits multi-artist titles like `Artist A @9pm, Artist B @10:30pm`
- Normalizes date/time, price text, and strips HTML

## Usage

```bash
apify run
```

### Input
- `daysAhead` – Days ahead to fetch (default 120)
- `maxEvents` – Max artist rows (0 = unlimited)

## Output

Each record includes:
- `artist`, `eventDate`, `eventTime`, `venue`, `eventURL`, `description`, `price`, `scrapedAt`
