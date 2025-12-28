import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

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
    const pushOne = async (item) => {
        const artistName = (item?.artistName ?? item?.artist ?? '').trim();
        const venueName = (item?.venueName ?? item?.venue ?? '').trim();
        const eventTitle = (item?.eventTitle ?? item?.title ?? item?.name ?? item?.event ?? item?.artist ?? '').trim();
        const eventURL = (item?.eventURL ?? item?.url ?? '').trim();
        const description = (item?.description ?? '').toString().trim();
        const role = (item?.role ?? 'headliner') || 'headliner';
        const eventDateRaw = item?.eventDate ?? item?.eventDateText ?? item?.date ?? item?.startDate ?? item?.start_time ?? item?.dateAttr ?? item?.eventDateStr ?? item?.event_date;
        const eventDate = formatEventDateValue(eventDateRaw);
        const normalized = {
            venueName,
            artistName,
            role,
            eventTitle,
            eventURL,
            eventDate,
            description,
            scrapedAt: item?.scrapedAt || new Date().toISOString(),
        };
        return originalPushData(normalized);
    };

    if (Array.isArray(record)) {
        for (const item of record) await pushOne(item);
        return;
    }

    return pushOne(record);
};
function strip(text = '') {
    return text.replace(/\s+/g, ' ').trim();
}

function monthIndex(name) {
    const m = name?.slice(0, 3).toLowerCase();
    return {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    }[m] ?? null;
}

function parseDateFromText(text) {
    if (!text) return '';
    // Match patterns like "DEC 2 @ 9:00 PM – DEC 3 @ 12:30 AM" or "DEC 2"
    const re = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s*@|\s*,|\s+(\d{4}))?/i;
    const m = text.match(re);
    if (!m) return '';
    const now = new Date();
    const year = m[3] ? Number(m[3]) : now.getFullYear();
    const month = monthIndex(m[1]);
    const day = Number(m[2]);
    if (month == null || !day) return '';
    const d = new Date(year, month, day);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function parseDoorsTime(text) {
    if (!text) return '';
    const doors = (text.match(/doors\s*(?:at|@)?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i) || [])[1] || '';
    return doors.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseSetTimes(text) {
    if (!text) return [];
    // Pattern: "10pm – Artist Name" or "10:45pm – Artist Name"
    // The times are typically in a continuous block, not on separate lines
    // Example: "Doors at 9pm10pm – A.L. West10:45pm – Amelia's Best Friend11:30pm – Elnuh"
    
    const matches = [];
    // Match all occurrences of time + dash + artist name
    // Use lookahead to stop before the next time pattern
    const regex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[–\-—]\s*([^0-9]+?)(?=\d{1,2}(?::\d{2})?\s*(?:am|pm)|$)/gi;
    
    let match;
    while ((match = regex.exec(text)) !== null) {
        const time = match[1].toLowerCase().replace(/\s+/g, ' ').trim();
        let artist = strip(match[2]);
        
        // Clean up the artist name
        // Stop at common boundary words
        artist = artist.split(/\s*(?:\b(?:doors|show|where|cost|rsvp|subscribe|when|plus)\b)/i)[0];
        artist = strip(artist);
        
        if (artist && artist.length > 1 && artist.length < 100 && !isNonArtist(artist)) {
            matches.push({ time, artist });
        }
    }
    return matches;
}

function isNonArtist(name) {
    const lower = (name || '').toLowerCase();
    // Filter out non-artist entries like DJ sets, event metadata, etc.
    const banned = [
        'doors', 'show', 'rsvp', 'facebook', 'instagram', 'ticket', 'inside', 'outside',
        'patio', 'volstead', 'hotel vegas', 'benefiting', 'plus', 'dj set by', 'pop-up',
        'where:', 'cost:', 'subscribe', 'email address', 'post navigation', '6th street',
        'site by', 'map'
    ];
    if (banned.some(b => lower.includes(b))) return true;
    if (lower.startsWith('dj ') && lower.includes(' by ')) return true;
    if (/^\d+\+/.test(lower)) return true; // "21+"
    if (/^[\d:\s@]+(?:am|pm)/i.test(lower)) return true; // Just time strings
    if (lower.includes('http')) return true;
    if (lower.length < 2 || lower.length > 80) return true;
    return false;
}

function cleanArtistName(name) {
    if (!name) return '';
    let cleaned = strip(name);
    // Remove all parenthetical information (tour names, show types, etc.)
    cleaned = cleaned.replace(/\s*\([^)]*\)/gi, '');
    // Also handle cases where opening paren exists but no closing paren
    cleaned = cleaned.replace(/\s*\([^)]*$/gi, '');
    // Remove Instagram/social handles at the end
    cleaned = cleaned.replace(/\s*[@#]\w+\s*$/gi, '');
    return strip(cleaned);
}

function extractHeadlinerFromTitle(title) {
    if (!title) return '';
    // Title format examples:
    // "Amelia's Best Friend Tour Kickoff @ Hotel Vegas"
    // "MATINEE: Horsetail, Jack (of FONT)"
    // "Grocery Bag, Matador Sphere, Midrange Jumper, Blue Ribbon"
    
    let cleaned = title.replace(/@\s*Hotel\s+Vegas/i, '');
    cleaned = cleaned.replace(/^(?:matinee|free show):\s*/i, '');
    cleaned = strip(cleaned);
    
    // If title contains "ft." or "featuring", extract the main act
    const ftMatch = cleaned.match(/^([^,]+?)\s+(?:ft\.|featuring|w\/|with)\s+/i);
    if (ftMatch) {
        return cleanArtistName(ftMatch[1]);
    }
    
    // Otherwise, take first artist from comma-separated list
    const parts = cleaned.split(',').map(p => strip(p));
    return cleanArtistName(parts[0]);
}

console.log('Starting Hotel Vegas scraper (Playwright)...');
await Actor.init();

const input = await Actor.getInput() || {};
const startUrl = input.startUrl || 'https://texashotelvegas.com/calendar/';
const maxEvents = Number(input.maxEvents) || 500;
const maxConcurrency = Number(input.maxConcurrency) || 3;
const requestHandlerTimeoutSecs = Number(input.requestHandlerTimeoutSecs) || 120;

const items = [];

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxEvents > 0 ? maxEvents + 10 : undefined,
    maxConcurrency,
    requestHandlerTimeoutSecs,
    navigationTimeoutSecs: 30,
    launchContext: {
        launchOptions: {
            headless: true,
        }
    },
    requestHandler: async ({ page, request, log }) => {
        if (request.userData.label === 'DETAIL') {
            const url = page.url();
            
            // Wait for content to load
            await page.waitForSelector('.type-tribe_events, article, main', { timeout: 10000 }).catch(() => {});
            
            // Extract event title
            const title = strip((await page.textContent('h1, .tribe-events-single-event-title, .entry-title').catch(() => '')) || '');
            
            // Get the main event content area (more specific to avoid footer/nav noise)
            const eventContent = strip((await page.textContent('.type-tribe_events .tribe-events-content, article, main .entry-content').catch(() => '')) || '');
            const bodyText = strip(await page.evaluate(() => document.body.innerText || ''));
            
            // Skip non-concert events
            const keywords = ['bingo', 'trivia', 'karaoke', 'market', 'yoga', 'comedy', 'movie', 'screening', 'drag brunch', 'vendor', 'workshop'];
            if (keywords.some(k => title.toLowerCase().includes(k) || bodyText.toLowerCase().includes(k))) {
                log.info(`Skipping non-concert event: ${title}`);
                return;
            }
            
            // Extract event date
            const eventDate = parseDateFromText(title + ' ' + bodyText);
            
            // Extract doors time
            const doorsTime = parseDoorsTime(eventContent || bodyText);
            
            // Extract headliner from title
            const headliner = extractHeadlinerFromTitle(title);
            
            // Parse set times from event description (use more focused content area)
            const setTimes = parseSetTimes(eventContent || bodyText);
            
            // Determine venue (Hotel Vegas has Inside, Patio, and Volstead)
            let venue = 'Hotel Vegas';
            if (/\bINSIDE\b/i.test(bodyText)) {
                venue = 'Hotel Vegas - Inside';
            } else if (/\bPATIO\b/i.test(bodyText)) {
                venue = 'Hotel Vegas - Patio';
            } else if (/\bVOLSTEAD\b/i.test(bodyText)) {
                venue = 'Hotel Vegas - Volstead';
            }
            
            // Extract price/cost info
            let price = '';
            const priceMatch = bodyText.match(/\$\d+(?:\.\d{2})?/);
            if (priceMatch) {
                price = priceMatch[0];
            } else if (/\bFREE\b/i.test(bodyText)) {
                price = 'Free';
            } else if (/\bNO COVER\b/i.test(bodyText)) {
                price = 'No Cover';
            }
            
            // If we found set times, use those to build the lineup
            if (setTimes.length > 0) {
                // First entry is typically the headliner (last to perform)
                for (let i = 0; i < setTimes.length; i++) {
                    const { time, artist } = setTimes[i];
                    const cleanedArtist = cleanArtistName(artist);
                    
                    if (!cleanedArtist) continue;
                    
                    // Determine role: last in the list is usually the headliner
                    const role = (i === setTimes.length - 1) ? 'headliner' : 'support';
                    
                    items.push({
                        artist: cleanedArtist,
                        eventDate,
                        venue,
                        eventURL: url,

                        role,
                        scrapedAt: new Date().toISOString(),
                    });
                }
            } else if (headliner) {
                // Fallback: just add the headliner if no set times found
                items.push({
                    artist: headliner,
                    eventDate,
                    eventTime: '',
                    doorsTime,
                    venue,
                    eventURL: url,
                    price,
                    role: 'headliner',
                    scrapedAt: new Date().toISOString(),
                });
            }
            
            log.info(`Scraped: ${title} - found ${setTimes.length} artists`);
            return;
        }

        // Listing page: gather event links and paginate
        await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(500);
        
        const eventLinks = new Set();
        
        // Extract event links from calendar
        const links = await page.$$eval('a[href*="/event/"]', (anchors) => {
            return anchors
                .map(a => a.href)
                .filter(href => href && /\/event\/[^/]+\//.test(href));
        });
        
        for (const link of links) {
            if (!eventLinks.has(link)) {
                eventLinks.add(link);
            }
        }
        
        log.info(`Found ${eventLinks.size} event links on listing page`);
        
        // Enqueue all event detail pages
        const requests = Array.from(eventLinks).map(url => ({
            url,
            userData: { label: 'DETAIL' }
        }));
        
        await crawler.addRequests(requests);
        
        // Try to navigate to next month if we want more events
        if (maxEvents === 0 || eventLinks.size < maxEvents) {
            const nextButton = await page.$('a[href*="page_offset~1"]').catch(() => null);
            if (nextButton) {
                const nextUrl = await nextButton.getAttribute('href').catch(() => null);
                if (nextUrl) {
                    log.info('Found next month link, enqueueing...');
                    await crawler.addRequests([{ url: nextUrl }]);
                }
            }
        }
    },
});

// Start crawling
await crawler.run([{ url: startUrl }]);

// Push all scraped items to dataset
for (const item of items) {
    await Actor.pushData(item);
}

console.log(`Hotel Vegas scraper finished. Pushed ${items.length} items.`);
await Actor.exit();
