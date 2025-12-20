# Saxon Pub Calendar Scraper

Scrapes upcoming events from Saxon Pub (Austin, TX) events calendar.

## Description

This Actor scrapes event information from The Saxon Pub's events page at https://thesaxonpub.com/events/

## Features

- Extracts artist/band names, dates, times, and descriptions
- Handles various event formats
- Outputs structured JSON data
- Configurable maximum number of events to scrape

## Input Configuration

- **Start URL**: The events page URL (default: https://thesaxonpub.com/events/)
- **Maximum Events**: Limit the number of events to scrape (0 = unlimited)

## Output

The Actor outputs a dataset with the following fields for each event:

- `artist` - Artist or band name
- `eventDate` - Date of the event 
- `eventTime` - Time of the event
- `venue` - Venue name (Saxon Pub)
- `eventURL` - Link to the event details
- `description` - Event description
- `price` - Ticket price information
- `scrapedAt` - Timestamp when the data was scraped

## Usage

Run the Actor with default settings or customize the input parameters as needed. The Actor will automatically extract all upcoming events from the Saxon Pub events calendar.