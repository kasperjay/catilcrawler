# Hotel Vegas Calendar Scraper

Scrapes upcoming events from https://texashotelvegas.com/calendar/ and pushes normalized items to the default dataset.

## Features

- Extracts clean headliner names (without tour or production company info)
- Captures all supporting acts with their individual set times
- Parses event details including:
  - Event date and doors time
  - Individual set times for each artist
  - Venue location (Inside, Patio, or Volstead)
  - Ticket pricing
  - Event URLs

## Run locally

```sh
cd actors/hotelvegas
apify run
```

Optional input:
- `startUrl` (default `https://texashotelvegas.com/calendar/`)
- `maxEvents` (default 500)
- `maxConcurrency` (default 3)

## Output Format

Each artist gets their own record with:
- `artist`: Clean artist name
- `eventDate`: Full date string
- `eventTime`: Set time for this artist
- `doorsTime`: When doors open
- `venue`: Hotel Vegas location (Inside/Patio/Volstead)
- `eventURL`: Link to event details
- `price`: Ticket cost or "Free"
- `role`: "headliner" or "support"
- `scrapedAt`: ISO timestamp

## Notes

- Hotel Vegas often lists multiple artists per show with individual set times
- The scraper extracts set times from the event description (e.g., "10pm – Artist Name")
- Tour names and production company info are stripped from artist names
- Non-concert events (drag brunch, trivia, etc.) are automatically filtered out
