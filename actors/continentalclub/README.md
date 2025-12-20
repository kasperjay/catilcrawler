# Continental Club Calendar Scraper

This Apify Actor scrapes event information from the Continental Club's calendar page at https://continentalclub.com/austin.

## Features

- Extracts concert and event information including artist names, dates, times, and descriptions
- Filters out promotional content, social media links, and non-event information
- Uses sophisticated artist name detection to ensure quality data
- Handles different event page structures and layouts
- Exports data in structured JSON format

## Input Configuration

The Actor accepts the following input parameters:

- **Start URL** (required): The Continental Club calendar URL (default: https://continentalclub.com/austin)
- **Max Requests per Crawl**: Maximum number of pages to scrape (default: 100, 0 = unlimited)
- **Proxy Configuration**: Proxy settings for anti-bot protection

## Output

The Actor outputs a dataset containing event records with the following fields:

- `artist`: Name of the performing artist or band
- `eventDate`: Date of the event (YYYY-MM-DD format)
- `eventTime`: Time of the event
- `venue`: Name of the venue (Continental Club)
- `eventURL`: URL to the event page (if available)
- `description`: Event description or additional details
- `price`: Ticket price information (if available)
- `scrapedAt`: ISO timestamp when the data was scraped

## Usage

### Run on Apify Platform

1. Create a new Actor run
2. Set the input parameters as needed
3. Start the Actor
4. Download the results from the dataset

### Run Locally

```bash
apify run
```

## Technical Details

- Built with Apify SDK and Crawlee framework
- Uses Playwright for browser automation
- Implements smart filtering to exclude promotional content
- Includes robust error handling and retry mechanisms
- Optimized for the Continental Club's website structure

## Notes

- The scraper is designed to respect the website's robots.txt and terms of service
- Rate limiting is implemented to avoid overwhelming the target server
- The artist name detection algorithm filters out common promotional content and non-artist text

## Support

For issues or questions, please refer to the Apify documentation or contact the actor maintainer.