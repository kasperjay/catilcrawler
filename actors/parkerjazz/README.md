# Parker Jazz Club Calendar Scraper

Scrapes upcoming events from Parker Jazz Club (https://parker-jazz.turntabletickets.com/).

## Features

- Scrapes all upcoming jazz performances
- Extracts artist names, dates, times, and show details
- Identifies headliners vs support acts
- Captures pricing and sold-out status
- Handles multiple performers per show

## Input

- **startUrl**: Parker Jazz Club events page (default: https://parker-jazz.turntabletickets.com/)
- **maxEvents**: Maximum number of events to collect (0 = unlimited, default: 500)
- **maxConcurrency**: Maximum parallel pages (default: 3)
- **requestHandlerTimeoutSecs**: Timeout for page processing (default: 120)

## Output

Each record contains:
- `artist`: Name of the performing artist/group
- `description`: Show description
- `eventDate`: Full date (e.g., "December 5, 2025")
- `eventTime`: Show time (e.g., "7:30 pm")
- `venue`: "Parker Jazz Club"
- `eventUrl`: Link to event details
- `price`: Ticket price (if available)
- `soldOut`: Boolean indicating if tickets are sold out
- `role`: "headliner" or "support"
- `scrapedAt`: Timestamp of scraping

## Usage

```bash
# Install dependencies
npm install

# Run locally
apify run

# Deploy to Apify platform
apify push
```

## Notes

- Parker Jazz Club uses the Turntable Tickets platform
- The scraper handles recurring shows like "A Charlie Brown Christmas" and special events
- Multiple show times on the same date are captured separately
- The venue is 21+ only
