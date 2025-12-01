import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

// Embedded shared utilities
const NON_CONCERT_KEYWORDS = [
    'bingo', 'rock and roll bingo', 'trivia'
];

function isNonConcertEvent(eventTitle, pageText, artistLines = [], customKeywords = []) {
    const allKeywords = [...NON_CONCERT_KEYWORDS, ...customKeywords];
    const combinedText = `${eventTitle} ${pageText} ${artistLines.join(' ')}`.toLowerCase();
    return allKeywords.some((keyword) => combinedText.includes(keyword));
}

function createEventRecord({ source, eventUrl, eventTitle, eventDateText, showTime, doorsTime, priceText, venueName, market, artistName, role }) {
    return {
        source, eventUrl, eventTitle, eventDateText,
        showTime: showTime || '', doorsTime: doorsTime || '', priceText: priceText || '',
        venueName: venueName || '', market, artistName, role,
        scrapedAt: new Date().toISOString()
    };
}

function cleanArtistLines(artistLines) {
    return artistLines.filter((line) => {
        const lower = line.toLowerCase();
        if (lower.includes('all ages')) return false;
        if (lower.includes('show:')) return false;
        if (lower.includes('doors:')) return false;
        if (lower.includes('day of')) return false;
        if (lower.includes('comandtakeitproductions.com')) return false;
        if (lower.startsWith('tickets')) return false;
        return line.length > 0;
    });
}

function extractTime(line, label) {
    if (!line) return '';
    return line.replace(new RegExp(`^${label}:\\s*`, 'i'), '').trim();
}

const MARKETS = { AUSTIN: 'Austin, TX' };

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
                let eventTitle = '';
                try {
                    eventTitle = (await page.textContent('h1')) || '';
                    eventTitle = eventTitle.trim();
                } catch {
                    log.warning(`Could not get <h1> title on ${eventUrl}`);
                }

                // Grab all visible text from the page body instead of <main>
                const mainTextRaw = await page.evaluate(() => {
                    return (document.body && document.body.innerText) || '';
                });

                const cleaned = mainTextRaw.replace(/\r/g, '');
                const lines = cleaned
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

                // Venue name – appears as "Come and Take it Live" link on the page
                let venueName = '';
                try {
                    venueName = await page.textContent('a[href*="comeandtakeitlive.com"], a[href*="house-of-rock"]');
                } catch {
                    // Ignore, we'll try a fallback below
                }

                if (!venueName) {
                    // Fallback: a link that looks like a short, title-ish name in the body
                    const venueCandidate = await page.$$eval('body a', (as) => {
                        const badWords = ['Buy Tickets', 'HERE', 'SUBSCRIBE', 'Powered by'];
                        for (const a of as) {
                            const t = (a.textContent || '').trim();
                            if (!t) continue;
                            if (badWords.some((w) => t.includes(w))) continue;
                            if (t.length < 40) return t;
                        }
                        return '';
                    });
                    venueName = venueCandidate || '';
                }
                venueName = (venueName || '').trim();

                // Artist block
                //
                // Pattern on these pages (example):
                // Come and Take It Productions
                // SAVING VICE
                // All Ages
                //
                // Tuesday, December 02
                // Show: 7 pm
                // $...
                // Come and Take it Live
                // Come and Take It Productions presents…
                // SAVING VICE
                // DISPOSITIONS
                // DEAD THINGS
                // ...
                // www.comeandtakeitproductions.com
                // ** Venue info, policies and rules ...
                //
                const presentsIndex = lines.findIndex((l) =>
                    l.toLowerCase().includes('presents')
                );

                let artistLines = [];

                if (presentsIndex >= 0) {
                    // Collect lines after "presents…" until footer-ish content
                    for (let i = presentsIndex + 1; i < lines.length; i++) {
                        const line = lines[i];

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

                // Sometimes the first line is just the event name again.
                if (
                    artistLines.length > 1 &&
                    eventTitle &&
                    artistLines[0].toLowerCase() === eventTitle.toLowerCase()
                ) {
                    artistLines = artistLines.slice(1);
                }

                // Clean artist lines using shared utility
                artistLines = cleanArtistLines(artistLines);

                // Filter out non-concert events using shared utility
                if (isNonConcertEvent(eventTitle, mainTextRaw, artistLines)) {
                    log.info(`Skipping non-concert event detected by keyword on ${eventUrl}: ${eventTitle}`);
                    return;
                }

                if (artistLines.length === 0) {
                    log.warning(`No artist lines parsed on ${eventUrl}. Layout may have changed or pattern didn't match.`);
                }

                // Fallback: if we couldn't parse any artist lines, treat eventTitle as a single headliner.
                if (artistLines.length === 0) {
                    if (eventTitle) {
                        log.warning(`No artist lines parsed on ${eventUrl}. Using eventTitle as single headliner.`);
                        const record = createEventRecord({
                            source: 'comeandtakeitproductions.com',
                            eventUrl,
                            eventTitle,
                            eventDateText: dateLine,
                            showTime: extractTime(showLine, 'show'),
                            doorsTime: extractTime(doorsLine, 'doors'),
                            priceText: priceLine,
                            venueName,
                            market: MARKETS.AUSTIN,
                            artistName: eventTitle,
                            role: 'headliner',
                        });
                        await Actor.pushData(record);
                    } else {
                        log.warning(`No artist lines and no eventTitle on ${eventUrl}. Skipping.`);
                    }
                    return; // don't try to loop artistLines
                }
                
                // Normal case: we have a block of bands after "presents..."
                for (const [index, artistName] of artistLines.entries()) {
                    const role = index === 0 ? 'headliner' : 'support';
                
                    const record = createEventRecord({
                        source: 'comeandtakeitproductions.com',
                        eventUrl,
                        eventTitle,
                        eventDateText: dateLine,
                        showTime: extractTime(showLine, 'show'),
                        doorsTime: extractTime(doorsLine, 'doors'),
                        priceText: priceLine,
                        venueName,
                        market: MARKETS.AUSTIN,
                        artistName,
                        role,
                    });
                
                    await Actor.pushData(record);
                }
            }
        },

        failedRequestHandler({ request, log }) {
            log.error(`Request ${request.url} failed too many times.`);
        },
    });

    await crawler.run([{ url: calendarUrl, userData: { label: 'CALENDAR' } }]);

    log.info('Come & Take It Productions calendar scraping finished.');
});