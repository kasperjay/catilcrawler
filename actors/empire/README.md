# Empire ATX Calendar Scraper

This Apify Actor scrapes the Empire ATX event calendar and returns one row per artist (band) appearing at each show.

## Features

- Scrapes https://empireatx.com/calendar/
- Handles multiple events per day
- Parses headliners and opening acts correctly
- Automatically removes venue suffixes ("IN THE CONTROL ROOM", "IN THE GARAGE", etc.) from artist names
- Filters out non-concert events using shared keyword filtering
- Distinguishes between Empire Control Room and Empire Garage venues

## Input

- `calendarUrl`: The Empire ATX calendar URL (default: https://empireatx.com/calendar/)
- `maxConcurrency`: Maximum number of concurrent requests (default: 3)

## Output

Each row represents one artist at one event with the following fields:

- `source`: "empireatx.com"
- `eventUrl`: URL of the individual event page
- `eventTitle`: Full event title
- `eventDateText`: Event date text
- `showTime`: Show start time (if available)
- `doorsTime`: Doors open time (if available)
- `priceText`: Ticket price info (if available)
- `venueName`: "Empire Control Room" or "Empire Garage"
- `market`: "Austin, TX"
- `artistName`: Clean artist name (without venue suffixes)
- `role`: "headliner" or "support"
- `scrapedAt`: Timestamp when the data was scraped

## Artist Parsing

The scraper intelligently parses artist names from event titles like:

- "TINY SOUNDS PRESENTS: PIGEON PIT W/ JUNE HENRY, BAD LUCK PENNY & FIRE ANT SEASON IN THE CONTROL ROOM"
- "HEARD PRESENTS: THE BOUNCING SOULS – EAST COAST! F#CK YOU! TOUR W/ H2O, DAVE HAUSE & THE MERMAID IN THE GARAGE"

It correctly identifies:
- Headliners (first artist mentioned)
- Support acts (after "W/")
- Removes presenter info ("HEARD PRESENTS:", etc.)
- Removes tour names and venue information
- Handles multiple support acts separated by commas or "&"