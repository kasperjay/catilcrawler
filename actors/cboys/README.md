# C-Boy's Heart & Soul Calendar Scraper

This Apify Actor pulls events from the C-Boy's Timely calendar and outputs one dataset item per performing artist.

## Features
- Fetches events directly from the Timely API
- Splits multi-artist titles so each act gets its own record
- Normalizes inline set times that can appear before or after artist names
- Skips obvious non-music events (e.g., bingo, trivia)

## Input
- `daysAhead` (integer, default 120): How many days from today to fetch.
- `maxEvents` (integer, default 500): Limit the number of events to process (0 = unlimited).

## Output
Each dataset item contains:
- `artist`
- `eventDate`
- `eventTime`
- `venue`
- `eventURL`
- `description`
- `price`
- `scrapedAt`

## Running locally
```bash
npm install
node src/main.js
```
