# Calendar Crawlers Monorepo

This repo hosts multiple Apify actors for scraping venue calendars. Each actor lives in `actors/<venue>` with its own `.actor` folder, Dockerfile, and `src/main.js`. The root directory is only the workspace scaffold; there is no actor entry point here.

## Structure

- `actors/` – individual actors (for example, `actors/comeandtakeit`)
- `packages/common` – shared utilities available to actors
- `storage/` – local development storage (mirrors Apify local storage layout)

## Getting Started

1. Install all workspace dependencies:
   ```bash
   npm run install-all
   ```
2. Run an actor locally (example: Come & Take It):
   ```bash
   cd actors/comeandtakeit
   apify run
   ```
3. Deploy an actor:
   ```bash
   cd actors/comeandtakeit
   apify push
   ```

## Adding a New Actor

1. Create a new actor directory:
   ```bash
   mkdir -p actors/new-venue/{.actor,src,storage/{datasets,key_value_stores,request_queues}}
   ```
2. Copy starter files from an existing actor (e.g., `actors/comeandtakeit`), then adjust metadata and parsing logic.
3. Install dependencies inside the actor directory:
   ```bash
   npm install
   ```

## Notes

- The Come & Take It actor is canonical at `actors/comeandtakeit`. The former duplicate at the repository root was removed to avoid confusion.
