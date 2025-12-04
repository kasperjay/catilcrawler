import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

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
    // Match patterns like "FRI 23 JAN" or "SAT 14 FEB"
    const re = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i;
    const m = dateText.match(re);
    if (!m) return '';
    const now = new Date();
    const year = now.getFullYear();
    const month = monthIndex(m[3]);
    const day = Number(m[2]);
    if (month == null || !day) return '';
    
    // If the parsed month is before current month, assume next year
    let finalYear = year;
    if (month < now.getMonth()) {
        finalYear = year + 1;
    }
    
    const d = new Date(finalYear, month, day);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function parseTimeFromText(text) {
    if (!text) return '';
    // Look for time patterns like "6:00PM" or "6:00 PM"
    const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (match) {
        return `${match[1]}:${match[2]} ${match[3].toLowerCase()}`;
    }
    return '';
}

function cleanArtistName(name) {
    if (!name) return '';
    let cleaned = strip(name);
    
    // Remove tour names and metadata
    cleaned = cleaned.replace(/:\s*[^-–—]+(?:tour|world tour).*$/i, '');
    cleaned = cleaned.replace(/\s*-\s*[^-–—]+(?:tour|world tour).*$/i, '');
    
    // Remove "with" and everything after
    cleaned = cleaned.replace(/\s+with\s+.*/i, '');
    
    return strip(cleaned);
}

function extractArtists(title) {
    // Extract main artist and support from title
    // Format examples:
    // "GOLDFORD: SPACE OF THE HEART TOUR"
    // "MAGIC CITY HIPPIES WITH SUPERTASTE"
    // "THE BROOK & THE BLUFF: WEREWOLF TOUR"
    
    const artists = [];
    
    if (!title) return artists;
    
    let mainArtist = cleanArtistName(title);
    
    // Check for "WITH" or "with" which indicates support acts
    const withMatch = title.match(/^(.+?)\s+with\s+(.+)$/i);
    if (withMatch) {
        mainArtist = cleanArtistName(withMatch[1]);
        const support = cleanArtistName(withMatch[2]);
        if (mainArtist) artists.push({ name: mainArtist, role: 'headliner' });
        if (support) artists.push({ name: support, role: 'support' });
        return artists;
    }
    
    if (mainArtist) {
        artists.push({ name: mainArtist, role: 'headliner' });
    }
    
    return artists;
}

function isValidEvent(title) {
    if (!title) return false;
    const t = title.toLowerCase();
    
    // Filter out UI elements and non-event text
    if (t.includes('skip to content')) return false;
    if (t.includes('buy tickets') && t.length < 20) return false;
    
    // Filter out non-music events
    const nonMusicKeywords = ['comedy show', 'movie screening', 'trivia', 'bingo', 'yoga'];
    if (nonMusicKeywords.some(k => t.includes(k))) return false;
    
    return true;
}

console.log('Starting Scoot Inn scraper (Playwright)...');
await Actor.init();

const input = await Actor.getInput() || {};
const startUrl = input.startUrl || 'https://www.scootinnaustin.com/shows';
const maxEvents = Number(input.maxEvents) || 500;
const maxConcurrency = Number(input.maxConcurrency) || 2;
const requestHandlerTimeoutSecs = Number(input.requestHandlerTimeoutSecs) || 120;

const items = [];

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1, // Only process the listing page
    maxConcurrency: 1,
    requestHandlerTimeoutSecs,
    navigationTimeoutSecs: 60,
    launchContext: {
        launchOptions: {
            headless: true,
        }
    },
    requestHandler: async ({ page, request, log }) => {
        // Main listing page - extract all events directly from this page
        log.info('Loading shows page...');
        await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 60000 });
        
        // Wait for event cards to load (they load dynamically)
        await page.waitForSelector('a[href*="/event/"]', { timeout: 30000 }).catch(() => {
            log.warning('Event links not found, page may not have loaded properly');
        });
        
        // Scroll to load all events (lazy loading)
        log.info('Scrolling to load all events...');
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 500;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        setTimeout(resolve, 2000);
                    }
                }, 300);
            });
        });
        
        log.info('Finished scrolling, extracting basic event data...');
        
        // First pass: get all event cards with basic info
        const eventCards = await page.evaluate(() => {
            const eventData = [];
            const processedUrls = new Set();
            
            // Find all event links
            const eventLinks = document.querySelectorAll('a[href*="/event/"]');
            
            eventLinks.forEach(link => {
                const url = link.href;
                if (processedUrls.has(url)) return;
                processedUrls.add(url);
                
                // Find the parent container
                let container = link;
                for (let i = 0; i < 10; i++) {
                    container = container.parentElement;
                    if (!container) break;
                    const text = container.innerText || '';
                    if (text.includes('JAN') || text.includes('FEB') || text.includes('MAR') || 
                        text.includes('APR') || text.includes('MAY') || text.includes('JUN') ||
                        text.includes('JUL') || text.includes('AUG') || text.includes('SEP') ||
                        text.includes('OCT') || text.includes('NOV') || text.includes('DEC')) {
                        break;
                    }
                }
                
                const fullText = container.innerText || '';
                const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                
                // Extract title
                let title = '';
                for (const line of lines) {
                    if (/^(MON|TUE|WED|THU|FRI|SAT|SUN)/.test(line)) continue;
                    if (/^\d{1,2}$/.test(line)) continue;
                    if (/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/.test(line)) continue;
                    if (/^BUY TICKETS$/i.test(line)) continue;
                    if (/^\d+:\d+\s*(AM|PM)$/i.test(line)) continue;
                    if (line.length > 3 && line.length < 200) {
                        title = line;
                        break;
                    }
                }
                
                eventData.push({
                    url,
                    title: title || link.getAttribute('aria-label') || link.title || '',
                    fullText
                });
            });
            
            return eventData;
        });
        
        log.info(`Found ${eventCards.length} event cards`);
        
        // Second pass: hover over each card to reveal "More Info" button and extract lineup
        for (let i = 0; i < eventCards.length; i++) {
            const event = eventCards[i];
            const { title, fullText, url } = event;
            
            if (!isValidEvent(title)) {
                log.info(`Skipping non-music event: ${title}`);
                continue;
            }
            
            // Extract date and time
            const eventDate = parseDateFromText(fullText);
            const eventTime = parseTimeFromText(fullText);
            
            // Extract artists from title
            const titleArtists = extractArtists(title);
            
            // Try to get lineup from Ticketmaster event page JSON data
            let lineupArtists = [];
            try {
                // Open Ticketmaster page in a new tab to avoid navigation conflicts
                const context = page.context();
                const tmPage = await context.newPage();
                
                try {
                    await tmPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    const tmPageHtml = await tmPage.content();
                    
                    if (tmPageHtml) {
                        // Extract __NEXT_DATA__ JSON from the page
                        const jsonMatch = tmPageHtml.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>(.*?)<\/script>/);
                        if (jsonMatch && jsonMatch[1]) {
                            const data = JSON.parse(jsonMatch[1]);
                            const discoveryEvent = data?.props?.pageProps?.edpData?.context?.discoveryEvent;
                            
                            if (discoveryEvent?.artists && Array.isArray(discoveryEvent.artists)) {
                                // Artists with rank > 1 are typically support acts
                                const supportActs = discoveryEvent.artists
                                    .filter(artist => artist.rank > 1)
                                    .map(artist => artist.name);
                                
                                for (const supportAct of supportActs) {
                                    // Clean up names like "Magic City Hippies with SUPERTASTE" -> "SUPERTASTE"
                                    let cleanedName = supportAct;
                                    const withMatch = supportAct.match(/\bwith\s+(.+)$/i);
                                    if (withMatch) {
                                        cleanedName = withMatch[1];
                                    }
                                    
                                    cleanedName = cleanArtistName(cleanedName);
                                    
                                    // Skip if name matches any title artist (case-insensitive)
                                    const isDuplicate = titleArtists.some(a => 
                                        a.name.toLowerCase() === cleanedName.toLowerCase()
                                    );
                                    
                                    if (cleanedName && !isDuplicate) {
                                        lineupArtists.push({ name: cleanedName, role: 'support' });
                                    }
                                }
                            }
                        }
                    }
                } finally {
                    // Always close the temporary page
                    await tmPage.close();
                }
            } catch (err) {
                log.warning(`Failed to extract lineup from Ticketmaster for ${title}: ${err.message}`);
            }
            
            // Combine title artists with lineup artists
            let allArtists = [...titleArtists, ...lineupArtists];
            
            if (allArtists.length === 0) {
                log.warning(`No artists found for: ${title}`);
                continue;
            }
            
            // Extract price if available
            const priceMatch = fullText.match(/\$\d+(?:\.\d{2})?/);
            const price = priceMatch ? priceMatch[0] : '';
            
            // Check for sold out status
            const soldOut = /sold\s*out/i.test(fullText);
            
            // Create records for each artist
            for (const artist of allArtists) {
                items.push({
                    artist: artist.name,
                    description: '',
                    eventDate,
                    eventTime,
                    venue: 'Scoot Inn',
                    eventUrl: url,
                    price: price || '',
                    soldOut,
                    role: artist.role,
                    scrapedAt: new Date().toISOString(),
                });
            }
            
            log.info(`Scraped ${allArtists.length} artist(s) from: ${title} (${lineupArtists.length} from Ticketmaster data)`);
            
            // Push data for each artist
            for (const item of items.slice(-allArtists.length)) {
                await Actor.pushData(item);
            }
        }
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
    console.log(`✓ Scraped ${items.length} total records from Scoot Inn`);
} else {
    console.log('⚠ No events found');
}

await Actor.exit();
