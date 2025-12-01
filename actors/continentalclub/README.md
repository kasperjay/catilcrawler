# Continental Club Austin Calendar Scraper

This actor scrapes event listings from Continental Club Austin's calendar to extract concert information.

## Features

- Extracts event details from https://continentalclub.com/austin
- Filters out non-concert events (bingo, trivia, etc.)
- Uses intelligent artist name detection to avoid promotional content
- Returns structured data with venue, artist, date, time, and event information

## Input

No input parameters required - the actor automatically scrapes the Continental Club Austin calendar.

## Output

The actor outputs event records to the dataset with the following structure:

```json
{
    "venue": "Continental Club Austin",
    "venueUrl": "https://continentalclub.com/austin",
    "title": "Event Title",
    "artist": "Artist Name",
    "date": "Event Date",
    "time": "Event Time",
    "description": "Event Description",
    "ticketUrl": "Ticket Purchase URL",
    "imageUrl": "Event Image URL",
    "genres": ["Genre1", "Genre2"],
    "priceRange": "Price Information",
    "ageRestriction": "Age Requirements",
    "scrapedAt": "2025-12-01T21:30:00.000Z"
}
```

## Notes

- The scraper uses Playwright to handle dynamic content
- Artist name detection filters out promotional content, addresses, and non-artist text
- Only concert events are included (non-music events are filtered out)
- The scraper respects the venue's robots.txt and implements appropriate delays