# Scoot Inn Calendar Scraper

Scrapes upcoming events from Scoot Inn Austin (https://www.scootinnaustin.com/shows).

## Features

- Scrapes all upcoming shows from dynamically loaded page
- Extracts artist names, dates, times, and show details
- Clicks into each event to reveal lineup information
- Identifies headliners vs support acts
- Captures pricing and sold-out status
- Handles lazy-loaded content with scrolling

## Input

- **startUrl**: Scoot Inn shows page (default: https://www.scootinnaustin.com/shows)
- **maxEvents**: Maximum number of events to collect (0 = unlimited, default: 500)
- **maxConcurrency**: Maximum parallel pages (default: 2)
- **requestHandlerTimeoutSecs**: Timeout for page processing (default: 120)

## Output

Each record contains:
- `artist`: Name of the performing artist/group
- `description`: Show description (if available)
- `eventDate`: Full date (e.g., "January 23, 2026")
- `eventTime`: Show time (e.g., "6:00 pm")
- `venue`: "Scoot Inn"
- `eventUrl`: Link to event details on Ticketmaster
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

- Scoot Inn uses a dynamically loaded page with event cards
- The scraper scrolls to load all lazy-loaded events
- Support artists are revealed in a lineup section that requires clicking
- Events link to Ticketmaster for ticket purchases
- Venue is operated by Live Nation
- Located at 1308 E 4th St Austin, TX 78702
