# Calendar Crawlers Monorepo

This is a monorepo containing multiple Apify actors for scraping calendar and event data from different venues.

## Structure

```
├── packages/
│   └── common/           # Shared utilities and helpers
├── actors/
│   └── comeandtakeit/    # Come & Take It Productions crawler
├── package.json          # Root package.json with workspace config
└── README.md            # This file
```

## Getting Started

1. Install dependencies for all packages:
   ```bash
   npm run install-all
   ```

2. Run a specific actor locally:
   ```bash
   cd actors/comeandtakeit
   apify run
   ```

3. Deploy a specific actor:
   ```bash
   cd actors/comeandtakeit
   apify push
   ```

## Adding a New Actor

1. Create new actor directory:
   ```bash
   mkdir -p actors/new-venue/{.actor,src,storage/{datasets,key_value_stores,request_queues}}
   ```

2. Copy basic files from an existing actor:
   ```bash
   cp actors/comeandtakeit/package.json actors/new-venue/
   cp actors/comeandtakeit/.actor/actor.json actors/new-venue/.actor/
   cp actors/comeandtakeit/Dockerfile actors/new-venue/
   ```

3. Update the new actor's configuration and implement parsing logic in `src/main.js`

4. Install dependencies:
   ```bash
   cd actors/new-venue
   npm install
   ```

## Shared Utilities

The `packages/common` package provides shared functionality:

- `isNonConcertEvent()` - Filter non-concert events using keywords
- `createEventRecord()` - Create standardized event records
- `cleanArtistLines()` - Clean artist name parsing
- `extractTime()` - Extract time from labeled strings
- `MARKETS` - Market/city constants

Import in your actor:
```javascript
import { 
    isNonConcertEvent, 
    createEventRecord, 
    MARKETS 
} from '@calendarcrawlers/common';
```

## Original Actor

The original Come & Take It Productions scraper has been moved to `actors/comeandtakeit/`.