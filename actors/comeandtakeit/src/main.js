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

function isLikelyArtistName(line) {
    if (!line || !line.trim()) return false;
    
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    
    // Length checks - artist names are typically 3-40 characters
    if (trimmed.length < 3 || trimmed.length > 40) return false;
    
    // Exclude obvious non-artist content
    if (lower.includes('all ages') || lower.includes('show:') || lower.includes('doors:') ||
        lower.includes('$') || lower.includes('ticket') || lower.includes('sold out') ||
        lower.includes('presale') || lower.includes('onsale') || lower.includes('age restriction')) return false;
    
    // Exclude social media/streaming
    if (lower.includes('tiktok') || lower.includes('spotify') || lower.includes('apple music') ||
        lower.includes('instagram') || lower.includes('facebook') || lower.includes('twitter') ||
        lower.includes('youtube') || lower.includes('soundcloud')) return false;
    
    // Exclude URLs and web content
    if (trimmed.includes('http') || trimmed.includes('www.') || lower.includes('.com') || 
        lower.includes('.net') || lower.includes('.org') || lower.includes('sign up') ||
        lower.includes('subscribe') || lower.includes('powered by')) return false;
    
    // Exclude VIP/merchandise content
    if (lower.includes('vip') || lower.includes('laminate') || lower.includes('lanyard') ||
        lower.includes('early entry') || lower.includes('early access') || lower.includes('merch') ||
        lower.includes('souvenir') || lower.includes('package') || lower.includes('upgrade') ||
        lower.includes('meet and greet') || lower.includes('signed poster') || lower.includes('cinch bag') ||
        lower.includes('exclusive') || lower.includes('sponsored by') || lower.includes('more artists tba')) return false;
    
    // Exclude addresses and location info (enhanced)
    if (/suite\s+[a-z]?-?\d+/i.test(lower) || /\d+\s*#\s*\d+/.test(trimmed) ||
        lower.includes('address') || lower.includes('location') || lower.includes('directions') ||
        /\b\d{5}\b/.test(trimmed) || // ZIP codes
        /(austin|dallas|houston|san antonio),?\s*(tx|texas)/i.test(lower) || // Texas cities
        /\d{3}\s*studios?/i.test(lower)) return false; // Studios with numbers
    
    // Exclude date/time patterns
    if (/\d{1,2}:\d{2}/.test(trimmed) || /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(lower)) return false;
    
    // Must contain at least one letter (not just numbers/symbols)
    if (!/[a-zA-Z]/.test(trimmed)) return false;
    
    // Exclude lines with too many numbers (likely addresses, phone numbers, etc.)
    const digitCount = (trimmed.match(/\d/g) || []).length;
    if (digitCount > 4) return false;
    
    // Exclude lines with too many special characters (likely not artist names)
    const specialCharCount = (trimmed.match(/[^\w\s]/g) || []).length;
    if (specialCharCount > 2) return false;
    
    // Exclude promotional phrases
    if (lower.includes('tba') || lower.includes('to be announced') || 
        lower.includes('more info') || lower.includes('coming soon')) return false;
    
    // Artist names should be mostly alphabetic with limited numbers
    const alphabeticChars = (trimmed.match(/[a-zA-Z]/g) || []).length;
    const totalChars = trimmed.replace(/\s/g, '').length;
    const alphabeticRatio = alphabeticChars / totalChars;
    
    if (alphabeticRatio < 0.7) return false; // At least 70% letters
    
    // Positive indicators for artist names:
    // - All caps (common for artist names on these pages)
    // - Title case with reasonable length
    const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && trimmed.length <= 35;
    const isTitleCase = /^[A-Z][a-z]*(\s+[A-Z][a-z]*)*$/.test(trimmed);
    
    return isAllCaps || isTitleCase;
}

function cleanArtistLines(artistLines) {
    return artistLines.filter(line => isLikelyArtistName(line));
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
                        
                        // Stop at footer content
                        if (lower.startsWith('www.')) break;
                        if (lower.includes('venue info')) break;
                        if (lower.includes('policies and rules')) break;
                        if (lower.includes('powered by')) break;
                        if (lower.includes('sign up')) break;
                        if (lower.includes('subscribe')) break;
                        
                        // Only consider lines that look like artist names
                        if (isLikelyArtistName(line)) {
                            artistLines.push(line);
                        }
                    }
                } else {
                    // Fallback: try to extract artist names from common patterns when "presents" isn't found
                    log.info(`No "presents" found, trying fallback patterns on ${request.url}`);
                    
                    // Look for patterns like venue name followed by artist names
                    const venueIndex = lines.findIndex((l) => 
                        l.toLowerCase().includes('come and take it live') ||
                        l.toLowerCase().includes('house of rock')
                    );
                    
                    if (venueIndex >= 0 && venueIndex < lines.length - 1) {
                        // Take lines after venue name until footer content
                        for (let i = venueIndex + 1; i < lines.length; i++) {
                            const line = lines[i];
                            const lower = line.toLowerCase();
                            
                            // Stop at footer content
                            if (lower.startsWith('www.')) break;
                            if (lower.includes('venue info')) break;
                            if (lower.includes('policies and rules')) break;
                            if (lower.includes('powered by')) break;
                            if (lower.includes('sign up')) break;
                            if (lower.includes('subscribe')) break;

                            if (isLikelyArtistName(line)) {
                                artistLines.push(line);
                            }
                        }
                    } else {
                        // Last resort: look for artist names in the middle section
                        const dateIndex = lines.findIndex((l) => 
                            /^[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2}/.test(l)
                        );
                        
                        if (dateIndex >= 0) {
                            // Look for artist names between date and footer
                            for (let i = dateIndex + 1; i < lines.length; i++) {
                                const line = lines[i];
                                const lower = line.toLowerCase();
                                
                                if (lower.startsWith('www.')) break;
                                if (lower.includes('venue info')) break;
                                if (lower.includes('policies and rules')) break;
                                if (lower.includes('powered by')) break;
                                if (lower.includes('sign up')) break;
                                if (lower.includes('subscribe')) break;
                                
                                if (isLikelyArtistName(line)) {
                                    artistLines.push(line);
                                }
                            }
                        }
                    }
                }

                // Handle "Featuring…" line: strip anything like that out
                const featuringIdx = artistLines.findIndex((l) =>
                    l.toLowerCase().startsWith('featuring')
                );
                if (featuringIdx !== -1) {
                    artistLines = artistLines.slice(featuringIdx + 1);
                }

                // Only remove the first line if it's clearly a duplicate event title that's not an artist name
                // We need to be careful not to remove actual artist names that happen to match the event title
                if (
                    artistLines.length > 1 &&
                    eventTitle &&
                    artistLines[0].toLowerCase() === eventTitle.toLowerCase() &&
                    // Only remove if the event title looks like a descriptive title, not an artist name
                    (eventTitle.toLowerCase().includes('presents') ||
                     eventTitle.toLowerCase().includes('featuring') ||
                     eventTitle.toLowerCase().includes('tour') ||
                     eventTitle.toLowerCase().includes('show') ||
                     eventTitle.toLowerCase().includes('concert') ||
                     eventTitle.toLowerCase().includes('festival') ||
                     eventTitle.length > 50) // Very long titles are likely descriptive, not artist names
                ) {
                    artistLines = artistLines.slice(1);
                }

                // Clean artist lines using shared utility
                artistLines = cleanArtistLines(artistLines);

                // If we have artist lines, check if any of them match part of the event title
                // This helps identify cases where the headliner name is in the event title
                if (artistLines.length > 0 && eventTitle) {
                    const eventTitleLower = eventTitle.toLowerCase();
                    
                    // Look for artist lines that are contained in the event title
                    // This suggests they might be the actual headliner mentioned in the title
                    const artistInTitle = artistLines.find(artist => {
                        const artistLower = artist.toLowerCase();
                        return artistLower.length > 3 && // Avoid short matches
                               eventTitleLower.includes(artistLower) && 
                               artistLower !== eventTitleLower; // Not an exact match (handled above)
                    });
                    
                    // If we found an artist mentioned in the title, move them to the front as headliner
                    if (artistInTitle) {
                        artistLines = artistLines.filter(a => a !== artistInTitle);
                        artistLines.unshift(artistInTitle);
                        log.info(`Moved artist "${artistInTitle}" to headliner position (found in event title: "${eventTitle}")`);
                    }
                }

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