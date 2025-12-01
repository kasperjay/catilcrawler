import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

Actor.main(async () => {
    const input = await Actor.getInput() || {};

    const {
        calendarUrl = 'https://comeandtakeitproductions.com/calendar/',
        maxConcurrency = 3,
    } = input;

    log.info(`Starting Come & Take It Productions calendar scraper on: ${calendarUrl}`);

    const crawler = new PlaywrightCrawler({
        maxConcurrency,
        requestHandlerTimeoutSecs: 60,

        async requestHandler({ page, request, enqueueLinks, log }) {
            const label = request.userData.label || 'CALENDAR';

            if (label === 'CALENDAR') {
                log.info(`Parsing calendar page: ${request.url}`);

                // Grab all "More Info" links – those go to individual event pages.
                const detailUrls = await page.$$eval('a', (anchors) => {
                    const urls = anchors
                        .filter(a => a.textContent && a.textContent.includes('More Info'))
                        .map(a => a.href)
                        .filter(Boolean);

                    // De-dupe
                    return Array.from(new Set(urls));
                });

                log.info(`Found ${detailUrls.length} event detail pages`);

                if (detailUrls.length === 0) {
                    log.warning('No event detail URLs found. Check if the calendar layout changed.');
                }

                await enqueueLinks({
                    urls: detailUrls,
                    userData: { label: 'EVENT' },
                });
            }

            if (label === 'EVENT') {
                log.info(`Parsing event page: ${request.url}`);

                const eventUrl = request.url;

                // Event title (big H1)
                let eventTitle = (await page.textContent('h1')) || '';
                eventTitle = eventTitle.trim();

                // Grab the main text block for parsing date, times, bands, etc.
                const mainTextRaw = (await page.textContent('main')) || '';
                const mainText = mainTextRaw.replace(/\r/g, '');
                const lines = mainText
                    .split('\n')
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0);

                // Date line, e.g. "Tuesday, December 02"
                const dateLine =
                    lines.find((l) =>
                        /^[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2}/.test(l)
                    ) || '';

                // Show / Doors / price / venue text
                const showLine =
                    lines.find((l) => l.toLowerCase().startsWith('show:')) || '';
                const doorsLine =
                    lines.find((l) => l.toLowerCase().startsWith('doors:')) || '';
                const priceLine = lines.find((l) => l.includes('$')) || '';

                // Venue name – appears as link "Come and Take it Live" on the page
                let venueName = await page.textContent('a[href*="comeandtakeitlive.com"], a[href*="houseofrock"]');
                if (!venueName) {
                    // Fallback: a link that looks like a venue name (no "Buy Tickets", no URL text, etc.)
                    const venueCandidate = await page.$$eval('main a', (as) => {
                        const badWords = ['Buy Tickets', 'HERE', 'SUBSCRIBE', 'Powered by'];
                        for (const a of as) {
                            const t = (a.textContent || '').trim();
                            if (!t) continue;
                            if (badWords.some((w) => t.includes(w))) continue;
                            // Very naive, but usually venue links are short and title-cased
                            if (t.length < 40) return t;
                        }
                        return '';
                    });
                    venueName = venueCandidate || '';
                }
                venueName = (venueName || '').trim();

                // Artist block
                // Pattern on these pages:
                // "Come and Take It Productions presents…"
                // HEADLINER
                // SUPPORT 1
                // SUPPORT 2
                // ...
                // www.comeandtakeitproductions.com
                //
                // Or:
                // "Come and Take It Productions presents…"
                // ATXMP SHOWCASE 2025
                // Featuring…
                // DARKNESS DIVIDED
                // FUTURE GHOST
                // ...

                const presentsIndex = lines.findIndex((l) =>
                    l.toLowerCase().includes('presents')
                );

                let artistLines = [];

                if (presentsIndex >= 0) {
                    // Collect lines after "presents…" until we hit the website link / venue info
                    for (let i = presentsIndex + 1; i < lines.length; i++) {
                        const line = lines[i];

                        // Stop at footer-ish content
                        const lower = line.toLowerCase();
                        if (lower.startsWith('www.')) break;
                        if (lower.includes('venue info')) break;
                        if (lower.includes('policies and rules')) break;

                        artistLines.push(line);
                    }
                }

                // Handle "Featuring…" line: strip anything like that out
                const featuringIdx = artistLines.findIndex((l) =>
                    l.toLowerCase().startsWith('featuring')
                );
                if (featuringIdx !== -1) {
                    artistLines = artistLines.slice(featuringIdx + 1);
                }

                // Sometimes the first line is just the event name again (“ATXMP SHOWCASE 2025”),
                // and the real bands start after that. We don't strictly need to remove it,
                // because we already have eventTitle. Optional cleanup:
                if (
                    artistLines.length > 1 &&
                    eventTitle &&
                    artistLines[0].toLowerCase() === eventTitle.toLowerCase()
                ) {
                    artistLines = artistLines.slice(1);
                }

                // Final cleanup: kill any obviously non-band lines
                artistLines = artistLines.filter((line) => {
                    const lower = line.toLowerCase();
                    if (lower.includes('all ages')) return false;
                    if (lower.includes('show:')) return false;
                    if (lower.includes('doors:')) return false;
                    if (lower.includes('day of')) return false;
                    if (lower.includes('comandtakeitproductions.com')) return false;
                    if (lower.startsWith('tickets')) return false;
                    return line.length > 0;
                });

                if (artistLines.length === 0) {
                    log.warning(`No artist lines parsed on ${eventUrl}. Layout may have changed.`);
                }

                // Flatten: one row per artist
                const market = 'Austin, TX'; // Logical constant for this actor

                artistLines.forEach((artistName, index) => {
                    const role = index === 0 ? 'headliner' : 'support';

                    const record = {
                        source: 'comeandtakeitproductions.com',
                        eventUrl,
                        eventTitle,
                        eventDateText: dateLine,
                        showTime: showLine.replace(/^show:\s*/i, '').trim() || '',
                        doorsTime: doorsLine.replace(/^doors:\s*/i, '').trim() || '',
                        priceText: priceLine,
                        venueName,
                        market,
                        artistName,
                        role,
                    };

                    Actor.pushData(record);
                });
            }
        },

        failedRequestHandler({ request, log }) {
            log.error(`Request ${request.url} failed too many times.`);
        },
    });

    await crawler.run([{ url: calendarUrl, userData: { label: 'CALENDAR' } }]);

    log.info('Come & Take It Productions calendar scraping finished.');
});
