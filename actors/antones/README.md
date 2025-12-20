# Antone's Nightclub Calendar Scraper

Scrapes upcoming events from https://antonesnightclub.com/calendar/ and pushes normalized items to the default dataset.

## Run locally

```sh
apify run
```

Optional input:
- `startUrl` (default `https://antonesnightclub.com/calendar/`)
- `maxEvents` (default 100)
- `maxConcurrency` (default 1)

## Features

- Extracts event data from JavaScript-based FullCalendar widget
- Parses headliners and supporting acts from event titles
- Handles multiple title patterns:
  - "Headliner w/ Support1 & Support2"
  - "Headliner with Support1 & Support2"  
  - "Headliner: Tour Name w/ Support"
- Extracts doors and show times
- Identifies sold out events
- Filters out non-concert events

## Output Schema

Each record represents one artist performing at an event:

```json
{
  "artist": "Artist Name",
  "role": "headliner|support",
  "eventDate": "December 3, 2025",
  "eventTime": "8:00 pm",
  "doorsTime": "7:00 pm",
  "venue": "Antone's Nightclub",
  "eventURL": "https://antonesnightclub.com/tm-event/event-name/",
  "description": "Event description",
  "price": "$25 or Sold Out",
  "scrapedAt": "2025-12-02T..."
}
```
