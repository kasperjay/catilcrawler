# Broken Spoke Calendar Crawler

Scrapes Broken Spoke’s events calendar (https://www.brokenspokeaustintx.net/events-calendar) and parses headliners plus support acts listed inline on each date line.

## Features
- Uses Playwright to load the Wix-hosted calendar page
- Parses month/year headings to attach the correct year to each date
- Extracts headliner and support acts from inline text (e.g., “Fri. Jan. 1st - HEADLINER 9p dancehall w/ SupportingBand 6-9pm restaurant”)
- Captures first time token as show time and minimum metadata (venue, URL, description)

## Usage

```bash
apify run
```

### Input
- `startUrl` – Calendar URL
- `maxEvents` – Limit on number of event lines to process (0 = unlimited)
- `requestTimeoutSecs` – Page load timeout

## Output

Each artist on an event produces:
- `artist` – Performer name
- `role` – `headliner` or `support`
- `eventDate` – Date (e.g., “December 5, 2025”)
- `eventTime` – First time token on the line (if any)
- `venue` – “Broken Spoke”
- `eventUrl` – Calendar URL
- `description` – Raw event line text
- `scrapedAt` – ISO timestamp
