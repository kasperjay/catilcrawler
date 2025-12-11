import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

// Ensure uniform artistName field across outputs
const originalPushData = Actor.pushData.bind(Actor);
Actor.pushData = async (record) => {
    const artistName = (record?.artistName ?? record?.artist ?? '').trim();
    const output = { ...record, artistName };
    return originalPushData(output);
};
function strip(text = '') {
    return text.replace(/\s+/g, ' ').trim();
}

function parseDateFromElement(dateText) {
    if (!dateText) return '';
    // Format: "December 03, 2025" or similar
    const cleaned = strip(dateText);
    const match = cleaned.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i);
    if (match) {
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const month = monthNames.indexOf(match[1].toLowerCase());
        const day = parseInt(match[2], 10);
        const year = parseInt(match[3], 10);
        const date = new Date(year, month, day);
        return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }
    return cleaned;
}

function parseTimeFromText(text) {
    if (!text) return '';
    // Look for time patterns like "8:00pm" or "8:00 pm"
    const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (match) {
        return `${match[1]}:${match[2]} ${match[3].toLowerCase()}`;
    }
    return strip(text);
}

function parseDoorsShowTimes(text) {
    if (!text) return { doorsTime: '', showTime: '' };
    const doorsMatch = text.match(/doors:\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i);
    const showMatch = text.match(/show:\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i);
    return {
        doorsTime: doorsMatch ? parseTimeFromText(doorsMatch[1]) : '',
        showTime: showMatch ? parseTimeFromText(showMatch[1]) : ''
    };
}

/**
 * Split artist names from event titles following these patterns:
 * - "Headliner w/ Support1 & Support2"
 * - "Headliner with Support1 & Support2"
 * - "Headliner: Tour Name w/ Support"
 * - "Headliner & Co-Headliner w/ Support"
 * - "Presenter Presents: Artist w/ Support" or "Presenter Presents: Artist ft. Others"
 * 
 * Returns: { headliners: string[], support: string[] }
 */
function parseArtistsFromTitle(title) {
    if (!title) return { headliners: [], support: [] };
    
    let cleaned = title;
    
    // Remove doors/show time info from the end
    cleaned = cleaned.replace(/Doors:\s*\d{1,2}:\d{2}\s*(?:am|pm).*$/i, '');
    cleaned = cleaned.replace(/Show:\s*\d{1,2}:\d{2}\s*(?:am|pm).*$/i, '');
    
    // Remove "SOLD OUT:" prefix
    cleaned = cleaned.replace(/^SOLD\s+OUT:\s*/i, '');
    
    // Handle "Presenter Presents: Artist..." pattern
    // Remove presenter prefix like "KUTX Presents:", "Sun Radio Presents:", etc.
    cleaned = cleaned.replace(/^[^:]+\s+Presents:\s*/i, '');
    
    // Handle "THE SHOW NAME: Artist1, Artist2 & Artist3" pattern
    // Remove show name prefix like "THE JUNGLE SHOW:", "UPSTAIRS:", etc.
    cleaned = cleaned.replace(/^(THE\s+JUNGLE\s+SHOW|UPSTAIRS|DOWNSTAIRS):\s*/i, '');
    
    // Remove "Album Release Show" from artist names
    cleaned = cleaned.replace(/\s+Album\s+Release\s+Show/gi, '');
    
    // Remove "very special guest" prefix
    cleaned = cleaned.replace(/\bvery\s+special\s+guest\s+/gi, '');
    
    // Remove night indicators like "(Night One)", "(Night Two)"
    cleaned = cleaned.replace(/\s*\(Night\s+(One|Two|\d+)\)/gi, '');
    
    // Handle "Antone's B3 Summit: Artist" pattern
    cleaned = cleaned.replace(/^Antone'?s\s+B3\s+Summit\s+\d+:\s*/i, '');
    
    cleaned = strip(cleaned);
    
    // Handle edge case: "Headliner: Tour Name w/ Support"
    // Extract everything before the tour name if present
    const tourMatch = cleaned.match(/^([^:]+):\s*([^w\/]+?(?:tour|festival|night|show)[^w\/]*)\s+w\//i);
    if (tourMatch) {
        // Headliner is before the colon
        const headliner = strip(tourMatch[1]);
        const supportText = cleaned.substring(cleaned.indexOf('w/') + 2);
        const support = supportText.split(/\s*&\s*/).map(s => strip(s)).filter(Boolean).filter(isValidArtistName);
        return { 
            headliners: [headliner].filter(isValidArtistName), 
            support 
        };
    }
    
    // Handle "ft." (featuring) pattern - split similar to "w/"
    // Example: "Artist ft. Featured1 & Featured2" or "Artist w/ Support ft. Others"
    const hasFt = /\bft\.\s+/i.test(cleaned);
    const hasW = /\s+(?:w\/|with)\s+/i.test(cleaned);
    
    // Standard case: split on "w/" or "with"
    const parts = cleaned.split(/\s+(?:w\/|with)\s+/i);
    
    if (parts.length === 1) {
        // Check for "ft." pattern without "w/"
        if (hasFt) {
            const ftParts = cleaned.split(/\s+ft\.\s+/i);
            if (ftParts.length > 1) {
                let headlinerText = ftParts[0];
                // Clean headliner: remove tour/show names after colon
                const colonMatch = headlinerText.match(/^([^:]+):/);
                if (colonMatch) {
                    headlinerText = colonMatch[1];
                }
                const headliners = headlinerText.split(/\s*&\s*/).map(s => strip(s)).filter(Boolean).filter(isValidArtistName);
                // Artists after "ft." are support
                const support = ftParts.slice(1).join(' & ').split(/\s*&\s*/).map(s => strip(s)).filter(Boolean).filter(isValidArtistName);
                return { headliners, support };
            }
        }
        
        // No "w/" or "with" or "ft." - might have a colon with tour name but no support
        const colonMatch = parts[0].match(/^([^:]+):\s+/);
        if (colonMatch) {
            // Just extract the artist name before the colon
            const artists = colonMatch[1].split(/\s*&\s*/).map(s => strip(s)).filter(Boolean).filter(isValidArtistName);
            return { headliners: artists, support: [] };
        }
        // Check for & between co-headliners
        const artists = parts[0].split(/\s*&\s*/).map(s => strip(s)).filter(Boolean).filter(isValidArtistName);
        return { headliners: artists, support: [] };
    }
    
    // parts[0] is headliner(s), parts[1+] is support act(s)
    // Clean headliner: remove tour names after colon
    let headlinerText = parts[0];
    const headlinerColonMatch = headlinerText.match(/^([^:]+):/);
    if (headlinerColonMatch) {
        headlinerText = headlinerColonMatch[1];
    }
    
    // Check if headliner section contains "ft." - if so, split it
    let headliners = [];
    let ftSupportArtists = [];
    if (/\bft\.\s+/i.test(headlinerText)) {
        const ftParts = headlinerText.split(/\s+ft\.\s+/i);
        const mainHeadliner = strip(ftParts[0]);
        if (isValidArtistName(mainHeadliner)) {
            headliners.push(mainHeadliner);
        }
        // Artists after "ft." in the headliner section are support
        if (ftParts.length > 1) {
            const ftText = ftParts.slice(1).join(' & ').replace(/,\s*(?=\w)/g, ' & ');
            ftSupportArtists = ftText.split(/\s*&\s*/).map(s => strip(s)).filter(Boolean).filter(isValidArtistName);
        }
    } else {
        // All artists before "w/" are headliners (could be co-headliners with & or ,)
        // Replace commas with & for uniform splitting
        const normalizedHeadliners = headlinerText.replace(/,\s*(?=\w)/g, ' & ');
        headliners = normalizedHeadliners.split(/\s*&\s*/).map(s => strip(s)).filter(Boolean).filter(isValidArtistName);
    }
    // All artists after "w/" are support acts (may also include "ft." groups)
    let supportText = parts.slice(1).join(' & ');
    // Also split on "ft." within support section
    supportText = supportText.replace(/\s+ft\.\s+/gi, ' & ');
    // Replace commas with & for uniform splitting
    supportText = supportText.replace(/,\s*(?=\w)/g, ' & ');
    const support = [...ftSupportArtists, ...supportText.split(/\s*&\s*/).map(s => strip(s)).filter(Boolean).filter(isValidArtistName)];
    
    return { headliners, support };
}

function isValidArtistName(name) {
    if (!name || name.length < 2 || name.length > 100) return false;
    const lower = name.toLowerCase();
    
    // Filter out time patterns with doors/show
    if (/^doors:/i.test(name) || /^show:/i.test(name)) return false;
    if (/\d{1,2}:\d{2}\s*(?:am|pm)/i.test(name)) return false;
    
    // Filter out single characters or standalone numbers
    if (/^\d+$/.test(name) || name.length === 1) return false;
    
    // Filter out generic event descriptors and presenter names (exact match)
    const exactBanned = [
        'upstairs',
        'downstairs',
        'presents',
        'austin live!',
        'next of kin',
        'the jazz room',
        'album release show',
        'kutx presents',
        'sun radio presents',
        'oxford american presents',
        'tc superstar',
        'gatsby',
        'glam',
        'bollywood dance party',
        'soul message band (ft. chris foreman)'
    ];
    
    if (exactBanned.includes(lower)) return false;
    
    // Filter "the U.N." when it appears with tour name
    if (lower === 'the u.n. – growing pains tour' || lower === 'the u.n.') return false;
    
    // Filter out phrases that start with event-type descriptors
    if (/^(upstairs:|downstairs:|austin live!?:|next of kin|the jazz room:|album release show|glam \||new year's|bollywood)/i.test(name)) return false;
    
    // Filter out Antone's event names
    if (/antone'?s\s+b3\s+summit/i.test(name)) return false;
    
    // Filter out "Antone's" references
    if (/antone'?s/i.test(name) && name.length < 20) return false;
    
    // Filter out generic tickets/sold out text
    if (/(get tickets|buy tickets)/i.test(name)) return false;
    
    return true;
}

function isNonConcert(text) {
    const keywords = [
        'bingo',
        'trivia',
        'karaoke',
        'market',
        'yoga',
        'comedy show',
        'movie',
        'screening',
        'brunch',
        'vendor',
        'workshop',
        'private event'
    ];
    const t = (text || '').toLowerCase();
    // Also filter out Antone's B3 Summit as it's an event series where all artists get filtered
    // Use includes() to handle any type of apostrophe
    if (t.includes('antone') && t.includes('b3') && t.includes('summit')) return true;
    return keywords.some(k => t.includes(k));
}

function dedupeByArtist(records) {
    const map = new Map();
    for (const record of records) {
        const key = (record.artist || '').toLowerCase();
        if (!key) continue;
        if (!map.has(key)) map.set(key, record);
    }
    return [...map.values()];
}

console.log('Starting Antone\'s Nightclub scraper (Playwright)...');
await Actor.init();

const input = await Actor.getInput() || {};
const startUrl = input.startUrl || 'https://antonesnightclub.com/calendar/';
const maxEvents = Number(input.maxEvents) || 100;
const maxConcurrency = Number(input.maxConcurrency) || 1; // Keep low for JS-heavy calendar
const requestHandlerTimeoutSecs = Number(input.requestHandlerTimeoutSecs) || 120;

const items = [];
const seenUrls = new Set();

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
    requestHandler: async ({ page, request, log, crawler }) => {
        const url = page.url();
        
        if (request.userData.label === 'CALENDAR') {
            log.info(`Scraping calendar page: ${url}`);
            
            // Wait for calendar to load
            await page.waitForSelector('.fc-event, [class*="event"]', { timeout: 10000 }).catch(() => {
                log.warning('Calendar events not found');
            });
            
            await page.waitForTimeout(2000); // Let JS render
            
            // Extract all event data from calendar
            const events = await page.evaluate(() => {
                const items = [];
                document.querySelectorAll('.fc-event').forEach(el => {
                    const link = el.querySelector('a') || el;
                    const title = link.textContent?.trim();
                    const href = link.href;
                    
                    // Extract date from parent cell if available
                    const cell = el.closest('[data-date]');
                    const dateAttr = cell ? cell.getAttribute('data-date') : '';
                    
                    if (title && href) {
                        items.push({ 
                            title, 
                            href,
                            dateAttr,
                            rawText: title
                        });
                    }
                });
                return items;
            });
            
            log.info(`Found ${events.length} events on calendar`);
            
            // Process each event
            for (const event of events) {
                if (seenUrls.has(event.href)) continue;
                seenUrls.add(event.href);
                
                if (isNonConcert(event.title)) {
                    log.info(`Skipping non-concert: ${event.title.substring(0, 70)}`);
                    continue;
                }
                
                // Parse data from calendar view (we have everything we need in the title)
                const { doorsTime, showTime } = parseDoorsShowTimes(event.rawText);
                const { headliners, support } = parseArtistsFromTitle(event.title);
                
                // Parse date from date attribute
                let eventDate = '';
                if (event.dateAttr) {
                    const d = new Date(event.dateAttr);
                    if (!Number.isNaN(d.getTime())) {
                        eventDate = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                    }
                }
                
                const eventTime = showTime;
                
                // Determine if event is sold out
                const isSoldOut = /sold\s*out/i.test(event.title);
                
                // Build event URL from dialog hash if it follows pattern
                const eventIdMatch = event.href.match(/#tw-event-dialog-(\d+)/);
                let eventUrl = event.href;
                // We'll use the calendar URL since we can't reliably get the detail URL without clicking
                
                if (headliners.length === 0 && support.length === 0) {
                    // Skip events where no valid artists were found
                    log.info(`Skipping event with no valid artists: ${event.title.substring(0, 60)}`);
                    continue;
                }
                
                if (headliners.length > 0 || support.length > 0) {
                    // Create records for headliners
                    for (const artist of headliners) {
                        items.push({
                            artist,
                            role: 'headliner',
                            eventDate,
                            eventTime,
                            doorsTime,
                            venue: 'Antone\'s Nightclub',
                            eventUrl,
                            description: '',
                            price: isSoldOut ? 'Sold Out' : '',
                            scrapedAt: new Date().toISOString()
                        });
                    }
                    // Create records for support acts
                    for (const artist of support) {
                        items.push({
                            artist,
                            role: 'support',
                            eventDate,
                            eventTime,
                            doorsTime,
                            venue: 'Antone\'s Nightclub',
                            eventUrl,
                            description: '',
                            price: isSoldOut ? 'Sold Out' : '',
                            scrapedAt: new Date().toISOString()
                        });
                    }
                }
                
                const totalArtists = headliners.length + support.length;
                log.info(`Processed: ${event.title.substring(0, 60)} -> ${totalArtists || 1} artist(s)`);
                
                if (items.length >= maxEvents) {
                    log.info(`Reached max events limit: ${maxEvents}`);
                    break;
                }
            }
        }
    },
});

// Start crawl
await crawler.run([{
    url: startUrl,
    userData: { label: 'CALENDAR' }
}]);

// Save results
const deduped = dedupeByArtist(items);
console.log(`Scraped ${items.length} artist records from Antone's Nightclub, ${deduped.length} unique artists after dedupe`);
for (const item of deduped) {
    await Actor.pushData(item);
}

await Actor.exit();
 
