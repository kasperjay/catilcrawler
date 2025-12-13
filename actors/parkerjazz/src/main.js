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
        const eventURL = (item?.eventURL ?? item?.eventUrl ?? item?.url ?? '').trim();
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

function parseDateFromText(dateText) {
    if (!dateText) return '';
    // Match patterns like "TUE, DEC 02" or "FRI, DEC 05"
    const re = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i;
    const m = dateText.match(re);
    if (!m) return '';
    const now = new Date();
    const year = m[4] ? Number(m[4]) : now.getFullYear();
    const month = monthIndex(m[2]);
    const day = Number(m[3]);
    if (month == null || !day) return '';
    const d = new Date(year, month, day);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function parseTimeFromText(text) {
    if (!text) return '';
    // Look for time patterns like "07:30 PM SHOW" or "09:30 PM SHOW"
    const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (match) {
        return `${match[1]}:${match[2]} ${match[3].toLowerCase()}`;
    }
    return '';
}

function cleanArtistName(name) {
    if (!name) return '';
    let cleaned = strip(name);
    
    // Remove common venue/metadata phrases
    cleaned = cleaned.replace(/\s*@\s*Parker Jazz Club/gi, '');
    cleaned = cleaned.replace(/\s*at\s*Parker Jazz Club/gi, '');
    cleaned = cleaned.replace(/\s*\bat\s+Parker\b/gi, '');
    
    // Remove tour/subtitle information in parentheses or after colons
    cleaned = cleaned.replace(/\s*\([^)]*(?:tour|show|special|christmas|tribute)[^)]*\)/gi, '');
    cleaned = cleaned.replace(/:\s*[^-–—]+(?:tour|festival|celebration|show|special).*$/i, '');
    
    // Remove "presents", "with", "featuring" prefixes
    cleaned = cleaned.replace(/^(?:Parker Jazz Club\s+)?presents\s+/i, '');
    cleaned = cleaned.replace(/^(?:featuring|with)\s+/i, '');
    
    // Remove descriptive text about the show
    cleaned = cleaned.replace(/\s*-\s*Special.*$/i, '');
    cleaned = cleaned.replace(/\s*&\s*her\s+Slightly\s+Bigger.*$/i, '');
    
    return strip(cleaned);
}

function extractPerformers(title, description) {
    // For Parker Jazz Club, the title is usually the show name/artist
    const performers = [];
    
    if (!title) return performers;
    
    // Clean the title
    let mainArtist = cleanArtistName(title);
    
    // Handle special recurring shows
    const recurringShows = [
        'A Charlie Brown Christmas',
        'A Very Merry Christmas Show',
        'The Nutcracker Suite by Duke Ellington',
        'The Nutcracker Suite',
        'New Year\'s Eve',
        'PRIVATE EVENT'
    ];
    
    // Check if this is a recurring/house show
    const isRecurringShow = recurringShows.some(show => 
        mainArtist.toLowerCase().includes(show.toLowerCase())
    );
    
    if (isRecurringShow) {
        performers.push(mainArtist);
        return performers;
    }
    
    // Split by "with", "featuring", "&", or "and" for multiple artists
    const artistSplit = mainArtist.split(/\s+(?:with|featuring|&|and)\s+/i);
    
    artistSplit.forEach(artist => {
        const cleaned = strip(artist);
        if (cleaned && cleaned.length > 1 && cleaned.length < 100) {
            performers.push(cleaned);
        }
    });
    
    return performers.length > 0 ? performers : [mainArtist];
}

function isValidEvent(title) {
    if (!title) return false;
    const t = title.toLowerCase();
    
    // Skip closed/private events unless they're named shows
    if (t === 'private event' || t === 'closed') return false;
    
    // Filter out obviously non-music events
    const nonMusicKeywords = ['comedy show', 'movie screening', 'trivia night', 'bingo', 'yoga'];
    if (nonMusicKeywords.some(k => t.includes(k))) return false;
    
    return true;
}

console.log('Starting Parker Jazz Club scraper (Playwright)...');
await Actor.init();

const input = await Actor.getInput() || {};
const startUrl = input.startUrl || 'https://parker-jazz.turntabletickets.com/';
const maxEvents = Number(input.maxEvents) || 500;
const maxConcurrency = Number(input.maxConcurrency) || 3;
const requestHandlerTimeoutSecs = Number(input.requestHandlerTimeoutSecs) || 120;

const items = [];

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxEvents > 0 ? maxEvents + 5 : undefined,
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
            
            // Wait for main content to load
            await page.waitForSelector('body', { timeout: 8000 }).catch(() => {});
            
            // Extract event details from the detail page
            const title = strip(await page.textContent('h1, .show-title').catch(() => '') || await page.title().catch(() => ''));
            const bodyText = strip(await page.evaluate(() => document.body.innerText || ''));
            
            if (!isValidEvent(title)) {
                log.info(`Skipping non-music event: ${title}`);
                return;
            }
            
            // Extract date from page (could be in URL or in body)
            let eventDate = '';
            const urlDateMatch = url.match(/date=(\d{4}-\d{2}-\d{2})/);
            if (urlDateMatch) {
                const [year, month, day] = urlDateMatch[1].split('-').map(Number);
                const d = new Date(year, month - 1, day);
                eventDate = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            } else {
                eventDate = parseDateFromText(bodyText);
            }
            
            // Extract time
            const eventTime = parseTimeFromText(bodyText);
            
            // Extract description (usually a paragraph about the show)
            const description = strip(await page.textContent('.show-description, .event-description, p').catch(() => ''));
            
            // Extract performers
            const performers = extractPerformers(title, description);
            
            // Extract price if available
            const priceMatch = bodyText.match(/\$\d+(?:\.\d{2})?/);
            const price = priceMatch ? priceMatch[0] : '';
            
            // Check for sold out status
            const soldOut = /sold\s*out/i.test(bodyText);
            
            // Create records for each performer
            for (let i = 0; i < performers.length; i++) {
                const role = i === 0 ? 'headliner' : 'support';
                items.push({
                    artist: performers[i],
                    description: description.slice(0, 500), // Truncate long descriptions
                    eventDate,
                    eventTime,
                    venue: 'Parker Jazz Club',
                    eventUrl: url,
                    price: price || '',
                    soldOut,
                    role,
                    scrapedAt: new Date().toISOString(),
                });
            }
            
            log.info(`Scraped ${performers.length} performer(s) from: ${title}`);
            return;
        }

        // Main listing page
        log.info('Loading main events page...');
        await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Wait for events to load
        await page.waitForSelector('a[href*="/shows/"]', { timeout: 10000 }).catch(() => {
            log.warning('Event links not found, continuing anyway...');
        });
        
        // Scroll to load all events (some might be lazy-loaded)
        await page.evaluate(() => {
            return new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 500;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        setTimeout(resolve, 1000);
                    }
                }, 200);
            });
        });
        
        log.info('Finished scrolling, extracting event links...');
        
        // Extract all event detail page links
        const eventLinks = await page.evaluate(() => {
            const links = [];
            const anchors = document.querySelectorAll('a[href*="/shows/"]');
            anchors.forEach(a => {
                const href = a.getAttribute('href');
                if (href && !links.includes(href)) {
                    // Build full URL if relative
                    const fullUrl = href.startsWith('http') ? href : new URL(href, window.location.href).href;
                    links.push(fullUrl);
                }
            });
            return links;
        });
        
        log.info(`Found ${eventLinks.length} event links`);
        
        // Enqueue each event detail page
        for (const link of eventLinks) {
            await crawler.addRequests([{
                url: link,
                userData: { label: 'DETAIL' }
            }]);
        }
        
        log.info(`Enqueued ${eventLinks.length} event detail pages`);
    },
});

// Start crawling
await crawler.addRequests([{
    url: startUrl,
    userData: { label: 'LIST' }
}]);

await crawler.run();

// Push all collected items to dataset
if (items.length > 0) {
    await Actor.pushData(items);
    console.log(`✓ Scraped ${items.length} total records from Parker Jazz Club`);
} else {
    console.log('⚠ No events found');
}

await Actor.exit();
