# ACL Live at 3TEN Crawler

Scrapes event data from ACL Live at 3TEN venue (https://www.acllive.com/events/venue/acl-live-at-3ten).

## Features

- Handles lazy loading (scrolling to load more events)
- Extracts headliners and support acts
- Captures event dates, times, and ticket links
- Filters out non-music events

## Usage

```bash
apify run
```

## Output

Each scraped event produces records with:
- `artist`: Artist name
- `eventDate`: Date of the event
- `eventTime`: Show time
- `venue`: "ACL Live at 3TEN"
- `eventURL`: Link to event details
- `description`: Event subtitle/description
- `role`: "headliner" or "support"
- `scrapedAt`: Timestamp of scraping
