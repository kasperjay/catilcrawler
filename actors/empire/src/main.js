import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

// Ensure uniform artistName + eventDate formatting across outputs
const originalPushData = Actor.pushData.bind(Actor);

function formatEventDateValue(value) {
    if (value === undefined || value === null) return '';
    let date;
    if (value instanceof Date) {
        date = value;
    } else if (typeof value === 'number') {
        date = new Date(value);
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return '';
        const parsed = Date.parse(trimmed.replace(' ', 'T'));
        if (!Number.isNaN(parsed)) {
            date = new Date(parsed);
        }
    }
    if (!date || Number.isNaN(date.getTime())) {
        return typeof value === 'string' ? value.trim() : '';
    }
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: '2-digit',
        year: 'numeric',
    });
}

Actor.pushData = async (record) => {
    const artistName = (record?.artistName ?? record?.artist ?? '').trim();
    const eventDateRaw = record?.eventDate ?? record?.eventDateText ?? record?.date ?? record?.startDate ?? record?.start_time ?? record?.dateAttr ?? record?.eventDateStr ?? record?.event_date;
    const eventDate = formatEventDateValue(eventDateRaw);
    const output = { ...record, artistName, eventDate };
    return originalPushData(output);
};
// Non-concert event keywords for filtering
const NON_CONCERT_KEYWORDS = [
    'bingo', 'rock and roll bingo', 'trivia', 'karaoke', 'open mic', 'open-mic',
    'market', 'farmers market', 'brunch', 'yoga', 'workshop', 'class', 'book signing',
    'pop up', 'pop-up', 'paint night', 'dance party', 'dance', 'dinner', 'mixer',
    'meetup', 'meet-up', 'fundraiser', 'fund raiser', 'silent auction', 'auction',
    'craft fair', 'bazaar', 'expo', 'conference', 'festival', 'movie night',
    'film screening', 'screening', 'lecture', 'reading', 'panel', 'networking',
    'open house', 'sound bath', 'fitness', 'wellness', 'charity', 'vendor', 'vendors',
    'crafts', 'bake sale'
];

// Check if an event should be filtered out as non-concert
function isNonConcertEvent(eventTitle, pageText, artistLines = []) {
    const combinedText = `${eventTitle} ${pageText} ${artistLines.join(' ')}`.toLowerCase();
    return NON_CONCERT_KEYWORDS.some((keyword) => combinedText.includes(keyword));
}

// Create a standardized event record
function createEventRecord({
    source, eventUrl, eventTitle, eventDateText, showTime, doorsTime, 
    priceText, venueName, market, artistName, role
}) {
    return {
        source, eventUrl, eventTitle, eventDateText,
        showTime: showTime || '', doorsTime: doorsTime || '', 
        priceText: priceText || '', venueName: venueName || '',
        market, artistName, role, scrapedAt: new Date().toISOString()
    };
}

const MARKETS = { AUSTIN: 'Austin, TX' };

Actor.main(async () => {
    const input = await Actor.getInput() || {};

    const {
        calendarUrl = 'https://empireatx.com/calendar/',
        maxConcurrency = 3,
    } = input;

    log.info(`Starting Empire ATX calendar scraper on: ${calendarUrl}`);

    const crawler = new PlaywrightCrawler({
        maxConcurrency,
        requestHandlerTimeoutSecs: 60,

        async requestHandler({ page, request, enqueueLinks, log }) {
            const label = request.userData.label || 'CALENDAR';

            if (label === 'CALENDAR') {
                log.info(`Parsing calendar page: ${request.url}`);

                // Wait for the calendar content to load
                await page.waitForSelector('a[href*="/events/"]', { timeout: 30000 });

                // Extract all event links from the calendar
                const eventLinks = await page.$$eval('a[href*="/events/"]', (links) => {
                    return links
                        .map(link => link.href)
                        .filter(href => href.includes('/events/'))
                        .filter((href, index, arr) => arr.indexOf(href) === index); // dedupe
                });

                log.info(`Found ${eventLinks.length} event detail pages`);

                if (eventLinks.length === 0) {
                    log.warning('No event detail URLs found. Check if the calendar layout changed.');
                }

                await enqueueLinks({
                    urls: eventLinks,
                    userData: { label: 'EVENT' },
                });
            }

            if (label === 'EVENT') {
                log.info(`Parsing event page: ${request.url}`);

                const eventUrl = request.url;

                // Wait for the page to fully load
                await page.waitForSelector('h1, .event-title, [class*="title"]', { timeout: 10000 });

                // Get event title from h1 or similar element
                let eventTitle = '';
                try {
                    eventTitle = await page.$eval('h1', (h1) => h1.textContent.trim());
                } catch {
                    try {
                        eventTitle = await page.$eval('[class*="title"], [class*="event-title"]', (el) => el.textContent.trim());
                    } catch {
                        log.warning(`Could not find event title on ${eventUrl}`);
                    }
                }

                if (!eventTitle) {
                    log.warning(`No event title found on ${eventUrl}, skipping`);
                    return;
                }

                log.info(`Processing event: ${eventTitle}`);

                // Extract date information
                let eventDateText = '';
                try {
                    // Look for date in various formats and selectors
                    const dateSelectors = [
                        '[class*="date"]',
                        '[class*="time"]',
                        '.event-date',
                        '.event-time',
                        'time'
                    ];

                    for (const selector of dateSelectors) {
                        try {
                            const dateEl = await page.$(selector);
                            if (dateEl) {
                                eventDateText = await dateEl.textContent();
                                if (eventDateText && eventDateText.trim()) {
                                    eventDateText = eventDateText.trim();
                                    break;
                                }
                            }
                        } catch (e) {
                            // Continue to next selector
                        }
                    }

                    // If still no date, try to extract from page text
                    if (!eventDateText) {
                        const pageText = await page.textContent('body');
                        const dateMatch = pageText.match(/[A-Za-z]+,?\s+[A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?/);
                        if (dateMatch) {
                            eventDateText = dateMatch[0];
                        }
                    }
                } catch (e) {
                    log.warning(`Could not extract date from ${eventUrl}: ${e.message}`);
                }

                // Extract show time, doors time, and price info
                let showTime = '';
                let doorsTime = '';
                let priceText = '';

                try {
                    const bodyText = await page.textContent('body');
                    
                    // Look for show time
                    const showMatch = bodyText.match(/show[:\s]+(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
                    if (showMatch) {
                        showTime = showMatch[1];
                    }

                    // Look for doors time
                    const doorsMatch = bodyText.match(/doors[:\s]+(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
                    if (doorsMatch) {
                        doorsTime = doorsMatch[1];
                    }

                    // Look for price
                    const priceMatch = bodyText.match(/\$\d+(?:\.\d{2})?(?:\s*-\s*\$\d+(?:\.\d{2})?)?/);
                    if (priceMatch) {
                        priceText = priceMatch[0];
                    }
                } catch (e) {
                    log.warning(`Could not extract time/price info from ${eventUrl}: ${e.message}`);
                }

                // Determine venue from title
                let venueName = 'Empire ATX';
                if (eventTitle.toLowerCase().includes('control room')) {
                    venueName = 'Empire Control Room';
                } else if (eventTitle.toLowerCase().includes('garage')) {
                    venueName = 'Empire Garage';
                }

                // Parse artists from the event title
                const artists = parseEmpireArtists(eventTitle);

                if (artists.length === 0) {
                    log.warning(`No artists parsed from title: ${eventTitle} on ${eventUrl}`);
                    return;
                }

                // Filter out non-concert events
                const allArtistNames = artists.map(a => a.name).join(' ');
                if (isNonConcertEvent(eventTitle, allArtistNames, [])) {
                    log.info(`Skipping non-concert event: ${eventTitle} on ${eventUrl}`);
                    return;
                }

                // Create records for each artist
                for (const artist of artists) {
                    const record = createEventRecord({
                        source: 'empireatx.com',
                        eventUrl,
                        eventTitle,
                        eventDateText,
                        showTime,
                        doorsTime,
                        priceText,
                        venueName,
                        market: MARKETS.AUSTIN,
                        artistName: artist.name,
                        role: artist.role,
                    });

                    await Actor.pushData(record);
                    log.info(`Saved artist: ${artist.name} (${artist.role})`);
                }
            }
        },

        failedRequestHandler({ request, log }) {
            log.error(`Request ${request.url} failed too many times.`);
        },
    });

    await crawler.run([{ url: calendarUrl, userData: { label: 'CALENDAR' } }]);

    log.info('Empire ATX calendar scraping finished.');
});

/**
 * Parse artists from Empire ATX event titles
 * Examples:
 * "TINY SOUNDS PRESENTS: PIGEON PIT W/ JUNE HENRY, BAD LUCK PENNY & FIRE ANT SEASON IN THE CONTROL ROOM"
 * "HEARD PRESENTS: THE BOUNCING SOULS – EAST COAST! F#CK YOU! TOUR W/ H2O, DAVE HAUSE & THE MERMAID IN THE GARAGE"
 * "LIVE NATION PRESENTS: LOS RETROS IN THE CONTROL ROOM"
 */
function parseEmpireArtists(title) {
    const artists = [];

    // Clean the title - remove venue info at the end
    let cleanTitle = title
        .replace(/\s+(IN THE (CONTROL ROOM|GARAGE)|AT EMPIRE (CONTROL ROOM|GARAGE))$/i, '')
        .trim();

    // Remove presenter info at the beginning
    cleanTitle = cleanTitle.replace(/^[^:]*PRESENTS:\s*/i, '');

    // Remove tour names and other noise
    cleanTitle = cleanTitle
        .replace(/\s+–\s+[^W]+TOUR/i, '') // Remove "– TOUR NAME TOUR"
        .replace(/\s+TOUR$/i, '') // Remove trailing "TOUR"
        .trim();

    // Split on "W/" to separate headliner from support acts
    const parts = cleanTitle.split(/\s+W\/\s+/i);
    
    if (parts.length === 0) {
        return artists;
    }

    // First part is the headliner
    const headliner = parts[0].trim();
    if (headliner) {
        artists.push({
            name: headliner,
            role: 'headliner'
        });
    }

    // Remaining parts are support acts
    if (parts.length > 1) {
        const supportString = parts[1];
        
        // Split support acts on commas and "&"
        const supportActs = supportString
            .split(/,\s*|\s+&\s+/)
            .map(name => name.trim())
            .filter(name => name.length > 0);

        for (const supportAct of supportActs) {
            artists.push({
                name: supportAct,
                role: 'support'
            });
        }
    }

    return artists;
}
