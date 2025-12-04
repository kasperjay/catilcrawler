# The Cut ATX Crawler

Scrapes The Cut ATX events via the public DICE API (same feed used by the on-site widget) and captures headliners plus lineup support acts.

## Features
- Pulls events from `https://partners-endpoint.dice.fm/api/v2/events` filtered by venue name
- Formats date/time in Central Time
- Extracts lineup entries for support acts (Lineup section on the DICE event)
- Captures door time and ticket price (min total) when available

## Usage

```bash
apify run
```

### Input
- `venueName` – DICE venue filter (default `The Cut ATX`)
- `apiKey` – DICE embed API key (public from the site)
- `pageSize` – Events per page to request
- `maxEvents` – Max events to process (0 = unlimited)

## Output

Each artist on an event produces:
- `artist` – Name of the performer
- `role` – `headliner` or `support`
- `eventDate` – Date (e.g., "December 14, 2025")
- `eventTime` – Local show time
- `doorsTime` – Doors time when provided
- `venue` – "The Cut ATX"
- `eventUrl` – Ticket/event link
- `price` – Minimum ticket total if available
- `description` – Event description text
- `scrapedAt` – ISO timestamp of the crawl
