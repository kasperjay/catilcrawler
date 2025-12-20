# Haute Spot Calendar Crawler

Scrapes Haute Spot's calendar (`https://hautespot.live/calendar`) and captures headliners plus support acts listed in each event's details.

## Features
- Uses the Squarespace JSON feed for fast, lightweight scraping
- Extracts headliners from the calendar listing and support acts from event details ("SUPPORT:" / "With support from")
- Formats event date/time in Central Time using the feed timestamps
- Grabs door time and price hints when present in the event body
- Stops early once past-only pages are reached or `maxEvents`/`maxPages` are hit

## Usage

```bash
apify run
```

### Input
- `startUrl` – Calendar page (default `https://hautespot.live/calendar`)
- `maxEvents` – Max events to collect (0 = unlimited)
- `maxPages` – Max paginated pages to fetch

## Output

Each artist on an event produces:
- `artist` – Name of the performer
- `role` – `headliner` or `support`
- `eventDate` – Date (e.g., "December 5, 2025")
- `eventTime` – Show time in Central Time
- `doorsTime` – Doors time when available
- `venue` – "Haute Spot"
- `eventURL` – Link to the event
- `price` – Price or text snippet when available
- `description` – Short description/excerpt
- `scrapedAt` – ISO timestamp of the crawl
