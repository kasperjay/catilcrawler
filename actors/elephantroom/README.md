# Elephant Room Calendar Crawler

Scrapes the Elephant Room calendar (https://elephantroom.com/calendar) and captures all artists listed in each day block (headliners and supports are together on the calendar).

## Features
- Uses Playwright to load the calendar page
- Parses month/year header and handles previous/next month spillover days
- Emits one row per artist per day; first listing in a day is marked `headliner`, subsequent listings are `support`
- Captures event time from the listing text when available

## Usage

```bash
apify run
```

### Input
- `startUrl` – Calendar URL
- `maxEvents` – Max artist rows to emit (0 = unlimited)
- `requestTimeoutSecs` – Page load timeout

## Output

Each artist row includes:
- `artist` – Artist name
- `role` – `headliner` (first listing of the day) or `support` (others)
- `eventDate` – Date (e.g., “December 1, 2025”)
- `eventTime` – Time parsed from the listing when present
- `venue` – “Elephant Room”
- `eventURL` – Link to the specific event popup
- `description` – Listing text
- `scrapedAt` – ISO timestamp
