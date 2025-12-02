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

function parseDateFromText(text) {
    if (!text) return '';
    // Match patterns like "DEC 5, 2025" or "JAN 10, 2026"
    const re = /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?/i;
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

function parseTimeFromText(text) {
    if (!text) return '';
    // Look for time patterns like "8:00 PM" or "8 PM"
    const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (match) {
        const hour = match[1];
        const minutes = match[2] || '00';
        return `${hour}:${minutes} ${match[3].toLowerCase()}`;
    }
    return '';
}

function splitArtists(raw) {
    if (!raw) return [];
    let t = raw;
    // Remove common boilerplate
    t = t.replace(/^\s*(?:ACL Live(?:\s+at\s+3TEN)?\s+)?presents\b[:\-]?\s*/i, '');
    t = t.replace(/\bat\s+ACL Live.*$/i, '');
    t = t.replace(/\bat\s+3TEN.*$/i, '');
    t = t.replace(/\bexpired\b/ig, '');
    t = t.replace(/\bsold\s*out\b/ig, '');
    t = t.replace(/\bget\s+tickets\b/ig, '');
    // Remove tour/subtitle descriptions after colons
    t = t.replace(/:\s*[^-–—]+(tour|festival|night|show).*$/i, '');
    // Remove descriptive text in parentheses (often Tribute info, etc)
    t = t.replace(/\([^\)]*(?:tribute|band|tour)[^\)]*\)/gi, '');
    // Remove "Tribute to..." text that's not part of the artist name
    t = t.replace(/^Tribute to\s+.*/i, '');
    // split by common separators but be conservative with commas
    const parts = t
        .split(/\bw\/\.?\s*|\bwith\b\s*|\+\s*/i)
        .map(s => strip(s))
        .filter(Boolean);
    return [...new Set(parts)];
}

function isLikelyArtist(name) {
    if (!name) return false;
    const s = name.trim();
    if (s.length < 2 || s.length > 100) return false;
    const lower = s.toLowerCase();
    // Banned phrases
    const banned = ['acl live', '3ten', 'tickets', 'sold out', 'expired', 'get tickets', 'more info'];
    if (banned.some(w => lower === w || lower.includes(w))) return false;
    // Filter out descriptive text that's clearly not an artist name
    if (/^(the|and|or|a|an)$/i.test(s)) return false;
    if (/^(tribute|tour|show|night|presents?)$/i.test(s)) return false;
    // Filter out overly descriptive phrases
    if (lower.includes('tribute to') || lower.includes('passion of') || lower.includes('legends of')) return false;
    if (lower.includes('fire and ') || lower.includes('most iconic')) return false;
    // Filter out text with dates or weekdays (likely event descriptions)
    if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(s)) return false;
    // Filter out COVID/cancellation text
    if (lower.includes('covid') || lower.includes('cancel')) return false;
    // Avoid standalone stage/venue names
    if (/^(stage|venue|theater)$/i.test(s)) return false;
    return true;
}

function isNonConcert(text) {
    // Only filter out obvious non-music events
    // Be more conservative - most events at 3TEN are concerts
    const keywords = [
        'bingo night', 'trivia night', 'karaoke', 'yoga class', 'comedy show', 'movie screening', 'vendor market'
    ];
    const t = (text || '').toLowerCase();
    return keywords.some(k => t.includes(k));
}

console.log('Starting ACL Live at 3TEN scraper (Playwright)...');
await Actor.init();

const input = await Actor.getInput() || {};
const startUrl = input.startUrl || 'https://www.acllive.com/events/venue/acl-live-at-3ten';
const maxEvents = Number(input.maxEvents) || 500;
const maxConcurrency = Number(input.maxConcurrency) || 3;
const requestHandlerTimeoutSecs = Number(input.requestHandlerTimeoutSecs) || 120;

const items = [];
const listArtistsByUrl = new Map();

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
            
            // Extract event details
            const title = strip((await page.textContent('h1, .event-title').catch(() => '')) || (await page.title().catch(() => '')));
            const subtitle = strip((await page.textContent('.event-subtitle, .subtitle').catch(() => '')) || '');
            const bodyText = strip(await page.evaluate(() => document.body.innerText || ''));

            if (isNonConcert(`${title} ${bodyText}`)) {
                log.info(`Skipping non-concert event: ${title}`);
                return;
            }

            // Extract event date from the page
            const eventDate = parseDateFromText(bodyText);
            
            // Extract event time
            const eventTime = parseTimeFromText(bodyText);
            
            // Parse artists from title and subtitle
            const fromList = listArtistsByUrl.get(url) || [];
            const fromTitle = splitArtists(title);
            const fromSubtitle = splitArtists(subtitle);
            
            // Look for support acts in the page content
            const withMatch = (bodyText.match(/\b(?:with|w\/)\s+([A-Za-z0-9][\w\s&'./+\-]+(?:\s*,\s*[A-Za-z0-9][\w\s&'./+\-]+)*)/i) || [])[1] || '';
            const fromWith = splitArtists(withMatch);
            
            // Combine and deduplicate artists
            const allArtists = [...fromList, ...fromTitle, ...fromSubtitle, ...fromWith]
                .filter(isLikelyArtist)
                .filter((name, idx, arr) => {
                    const lower = name.toLowerCase();
                    return arr.findIndex(n => n.toLowerCase() === lower) === idx;
                });
            
            // Determine headliner (first from title) and support acts
            const headliner = fromTitle.filter(isLikelyArtist)[0] || allArtists[0];
            const support = allArtists.filter(a => a.toLowerCase() !== headliner?.toLowerCase());
            const artists = headliner ? [headliner, ...support] : allArtists;

            if (artists.length === 0) {
                log.warning(`No valid artists found for: ${title}`);
                return;
            }

            // Extract price info
            const priceMatch = bodyText.match(/\$\d+(?:\.\d{2})?/);
            const price = priceMatch ? priceMatch[0] : '';

            // Create records for each artist
            for (let i = 0; i < artists.length; i++) {
                const role = i === 0 ? 'headliner' : 'support';
                items.push({
                    artist: artists[i],
                    description: subtitle,
                    eventDate,
                    eventTime,
                    venue: 'ACL Live at 3TEN',
                    eventUrl: url,
                    price: price || '',
                    role,
                    scrapedAt: new Date().toISOString(),
                });
            }
            
            log.info(`Scraped ${artists.length} artist(s) from: ${title}`);
            return;
        }

        // Listing page: scroll to load all events and enqueue detail pages
        await page.goto(startUrl, { waitUntil: 'networkidle' });
        log.info('Loaded listing page, starting to scroll...');
        
        // Wait for initial events to load
        await page.waitForTimeout(1500);

        const seen = new Set();
        
        async function harvestEventLinks() {
            const links = await page.$$eval('a[href*="/event/"]', (anchors) => {
                // Helper function available in browser context
                function stripText(text = '') {
                    return text.replace(/\s+/g, ' ').trim();
                }
                
                const out = [];
                for (const a of anchors) {
                    const href = a.href;
                    if (!href || !href.includes('/event/')) continue;
                    
                    // Get event info from the card
                    const container = a.closest('article, section, .event-card, [class*="event"]') || a.parentElement;
                    const titleEl = container?.querySelector('h3, h2, .event-title, [class*="title"]');
                    const subtitleEl = container?.querySelector('.event-subtitle, .subtitle, [class*="subtitle"]');
                    
                    const title = titleEl ? stripText(titleEl.textContent || '') : stripText(a.textContent || '');
                    const subtitle = subtitleEl ? stripText(subtitleEl.textContent || '') : '';
                    
                    out.push({ url: href, title, subtitle });
                }
                return out;
            });
            
            // Store artist info from listing
            for (const link of links) {
                const fromTitle = link.title.split(/\bw\/|\bwith\b/).map(s => strip(s)).filter(Boolean);
                const fromSubtitle = link.subtitle.split(/\bw\/|\bwith\b/).map(s => strip(s)).filter(Boolean);
                const unique = [...new Set([...fromTitle, ...fromSubtitle])].filter(isLikelyArtist);
                if (unique.length) {
                    listArtistsByUrl.set(link.url, unique);
                }
            }
            
            return links;
        }

        async function enqueueNewLinks() {
            const links = await harvestEventLinks();
            const newLinks = links.filter(l => !seen.has(l.url));
            
            if (newLinks.length > 0) {
                newLinks.forEach(l => seen.add(l.url));
                await crawler.requestQueue.addRequests(
                    newLinks.map(l => ({ url: l.url, userData: { label: 'DETAIL' } }))
                );
                log.info(`Queued ${newLinks.length} new event links (total: ${seen.size})`);
            }
            
            return newLinks.length;
        }

        // Initial harvest
        await enqueueNewLinks();

        // Scroll to load more events
        for (let i = 0; i < 20; i++) {
            if (maxEvents > 0 && seen.size >= maxEvents) {
                log.info(`Reached maxEvents limit: ${maxEvents}`);
                break;
            }

            const beforeCount = seen.size;
            
            // Scroll to bottom of page
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            
            // Wait for potential new content
            await page.waitForTimeout(2000);
            
            const added = await enqueueNewLinks();
            
            log.info(`Scroll iteration ${i + 1}: added ${added} events (total: ${seen.size})`);
            
            // If no new events after scrolling, we've reached the end
            if (seen.size === beforeCount) {
                log.info('No new events found, stopping scroll');
                break;
            }
        }
        
        log.info(`Finished scrolling. Total events queued: ${seen.size}`);
    },
});

// Start crawling
await crawler.run([{ url: startUrl }]);

// Push all collected items to dataset
for (const item of items) {
    await Actor.pushData(item);
}

console.log(`3TEN scraper finished. Pushed ${items.length} items.`);
await Actor.exit();
