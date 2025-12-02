import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

// Utility function to determine if a string looks like an artist name
function isLikelyArtistName(text) {
    if (!text || typeof text !== 'string') return false;
    
    const cleaned = text.trim();
    if (cleaned.length < 3 || cleaned.length > 100) return false;
    
    // Enhanced exclusion patterns for Continental Club
    const exclusionPatterns = [
        // Navigation menu items
        /^(welcome|about|shows|gallery|shop|home|contact|menu|navigation)$/i,
        
        // Location references
        /^(austin|houston|dallas|texas|tx)$/i,
        
        // Venue name
        /continental\s*club/i,
        
        // Common website elements
        /^(events?|calendar|upcoming|schedule|tickets?|info|more)$/i,
        
        // Navigation elements
        /^(next|previous|back|forward|close|open|click|button|link)$/i,
        
        // Generic UI elements  
        /^(focus|button|submit|cancel|search|filter|sort)$/i,
        
        // Single characters or numbers
        /^[a-z]$/i,
        /^\d+$/,
        
        // Common non-artist phrases
        /^(and more|see all|view all|show more|load more)$/i,
        
        // Date/time only
        /^\d{1,2}[\/\-:]\d{1,2}/,
        /^(am|pm|est|cst|pst)$/i,
        
        // Garbled text patterns (like "Is Dec ll Dec od Dec re Dec ng Dec")
        /^[A-Z][a-z]\s+[A-Z][a-z]{2}\s+[a-z]{2}(\s+[A-Z][a-z]{2}\s+[a-z]{2})+$/i,
        /^[a-z]{2}\s+[A-Z][a-z]{2}(\s+[a-z]{2}\s+[A-Z][a-z]{2})*$/i,
        
        // Truncated or partial text
        /^[A-Z][a-z\s]+\s+[A-Z]$/,  // Names ending with single capital letter
        /\s+[A-Z]$/,  // Any text ending with space + single capital
        
        // Common promotional content
        /buy\s*tickets?|purchase|order|book|reserve/i,
        /(doors?|show)\s*(open|start)/i,
        /age\s*limit|all\s*ages|\d+\+/i,
        
        // Website structure content
        /copyright|rights?\s*reserved|privacy|terms/i,
        /follow\s*us|social\s*media|facebook|twitter|instagram/i,
        
        // Time-related truncations
        /@\d{1,2}(am|pm)?,?\s*[A-Z]$/i  // Patterns like "@10pm, D" or "@12am A"
    ];
    
    // Check against exclusion patterns
    for (const pattern of exclusionPatterns) {
        if (pattern.test(cleaned)) return false;
    }
    
    // Check for sufficient alphabetic content
    const alphabeticCount = (cleaned.match(/[a-zA-Z]/g) || []).length;
    const totalLength = cleaned.length;
    if (alphabeticCount / totalLength < 0.6) return false;
    
    // Must have at least one capital letter (artist names are usually title case)
    if (!/[A-Z]/.test(cleaned)) return false;
    
    // Avoid very short or very long strings
    if (cleaned.length < 4 || cleaned.length > 100) return false;
    
    // Most legitimate artist names have at least 2 words (first + last name or band name with multiple words)
    // Allow some exceptions for single word band names that are reasonably long
    const words = cleaned.trim().split(/\s+/);
    if (words.length === 1 && cleaned.length < 8) return false;
    
    // Additional patterns to exclude
    if (/^\w+\s*-\s*$/.test(cleaned)) return false;  // Single word with dash
    if (/^[^\w\s]+$/.test(cleaned)) return false;    // Only punctuation
    
    // Specific non-artist phrases that are getting through
    if (/^(night\s+[12]|search\s+add|get\s+a\s+timely)$/i.test(cleaned)) return false;
    if (/^(merry\s+christmas|happy\s+hanukkah|closed.*happy)$/i.test(cleaned)) return false;
    if (/^december\s+2025$/i.test(cleaned)) return false;
    if (/search\s+add\s+to\s+calendar/i.test(cleaned)) return false;
    if (/^get\s+a\s+timely\s+calendar$/i.test(cleaned)) return false;
    if (/december.*search.*add.*calendar/i.test(cleaned)) return false;
    
    // Exclude benefit events and generic event text
    if (/\b(benefit|fundraiser|charity|memorial)\b/i.test(cleaned)) return false;
    if (/\ball\s+night\s+long\b/i.test(cleaned)) return false;
    
    // Exclude text with excessive punctuation (likely descriptions)
    const punctuationCount = (cleaned.match(/[!@#$%^&*(),.?":{}|<>\[\]\\;'`~_+=]/g) || []).length;
    if (punctuationCount > 3) return false;
    
    return true;
}

function extractMultipleArtists(eventText) {
    const artists = [];
    
    // Clean the text first
    let cleaned = eventText.replace(/@\d{1,2}(:\d{2})?(am|pm)/gi, '').trim();
    
    // Pattern 1: Multiple artists with times "Artist1 6:30pm Artist2 9:30pm Artist3"
    const timePattern = /\b\d{1,2}:\d{2}\s*[ap]m\b/gi;
    const timeMatches = [...cleaned.matchAll(timePattern)];
    
    if (timeMatches.length > 0) {
        // Split by time markers
        const segments = cleaned.split(timePattern);
        
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i].trim();
            if (segment && segment.length > 2 && segment.length < 80) {
                // Clean up any remaining artifacts
                const cleanSegment = segment.replace(/^(and\s+|&\s+)/i, '').trim();
                
                // Check if this segment contains comma-separated artists
                if (cleanSegment.includes(',')) {
                    const commaParts = cleanSegment.split(',');
                    commaParts.forEach(part => {
                        const trimmedPart = part.trim();
                        if (trimmedPart && isLikelyArtistName(trimmedPart)) {
                            artists.push(trimmedPart);
                        }
                    });
                } else if (cleanSegment && isLikelyArtistName(cleanSegment)) {
                    artists.push(cleanSegment);
                }
            }
        }
    }
    
    // Pattern 2: Artists separated by common delimiters (prioritize comma)
    if (artists.length === 0) {
        // First try comma separation
        if (cleaned.includes(',')) {
            const parts = cleaned.split(',');
            parts.forEach(part => {
                const trimmed = part.trim().replace(/^(and\s+|&\s+)/i, '').trim();
                if (trimmed && trimmed.length > 2 && isLikelyArtistName(trimmed)) {
                    artists.push(trimmed);
                }
            });
        } else {
            // Try other delimiters
            const delimiters = [' & ', ' and ', ' with ', ' + ', ' / '];
            
            for (const delimiter of delimiters) {
                if (cleaned.includes(delimiter)) {
                    const parts = cleaned.split(delimiter);
                    parts.forEach(part => {
                        const trimmed = part.trim().replace(/^(and\s+|&\s+)/i, '').trim();
                        if (trimmed && trimmed.length > 2 && isLikelyArtistName(trimmed)) {
                            artists.push(trimmed);
                        }
                    });
                    break; // Only use the first delimiter that matches
                }
            }
        }
    }
    
    // Pattern 3: If still no results but looks like a single artist
    if (artists.length === 0 && isLikelyArtistName(cleaned)) {
        artists.push(cleaned);
    }
    
    // Filter out any empty results
    return artists.filter(artist => artist && artist.trim().length > 0);
}

function createEventRecord(artist, eventDate, eventTime, venue, eventUrl, description, price) {
    return {
        artist: artist || '',
        eventDate: eventDate || '',
        eventTime: eventTime || '',
        venue: venue || '',
        eventUrl: eventUrl || '',
        description: description || '',
        price: price || '',
        scrapedAt: new Date().toISOString()
    };
}

function parseDate(dateText) {
    if (!dateText) return '';
    
    try {
        const date = new Date(dateText);
        if (isNaN(date.getTime())) return '';
        return date.toISOString().split('T')[0];
    } catch (error) {
        return '';
    }
}

function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
}

function extractDate(text) {
    if (!text) return '';
    const dateMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i);
    return dateMatch ? dateMatch[0] : '';
}

function extractTime(text) {
    if (!text) return '';
    const timeMatch = text.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)|\d{1,2}\s*(?:am|pm|AM|PM))\b/);
    return timeMatch ? timeMatch[0] : '';
}

function parseDateFromLabel(label) {
    if (!label) return '';
    
    const dateMatch = label.match(/\b\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/);
    if (dateMatch) {
        return parseDate(dateMatch[0]);
    }
    
    return '';
}

function normalizeTitleText(text) {
    if (!text) return '';
    
    let cleaned = cleanText(text);
    cleaned = cleaned.replace(/^\d{1,2}:\d{2}\s*(?:am|pm)\s+/i, '');
    cleaned = cleaned.replace(/^\d{1,2}\s*(?:am|pm)\s+/i, '');
    cleaned = cleaned.replace(/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*/i, '');
    cleaned = cleaned.replace(/^\d{1,2}\s*-\s*\d{1,2}\s*/i, '');
    cleaned = cleaned.replace(/^\d{1,2}:\d{2}\s*/i, '');
    
    return cleanText(cleaned);
}

async function parseContinentalClubEvents(page) {
    console.log('Parsing Continental Club events...');
    
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    const iframes = await page.locator('iframe').all();
    console.log(`Found ${iframes.length} iframes on page`);
    
    for (const iframe of iframes) {
        const src = await iframe.getAttribute('src');
        if (src && src.includes('timely.fun') && !src.includes('popup')) {
            console.log(`Navigating to Timely calendar: ${src}`);
            await page.goto(src);
            await page.waitForLoadState('networkidle', { timeout: 30000 });
            break;
        }
    }
    
    await page.waitForSelector('.timely-event', { timeout: 30000 });
    
    const rawEvents = await page.$$eval('.timely-event', elements => elements.map(el => ({
        title: el.querySelector('.timely-event-title-text')?.textContent?.trim() || el.textContent?.trim() || '',
        time: el.querySelector('.timely-event-time')?.textContent?.trim() || '',
        ariaLabel: el.getAttribute('aria-label') || '',
    })));
    
    console.log(`Extracted ${rawEvents.length} raw events from calendar`);
    
    const events = [];
    const addedEvents = new Set();
    
    for (const rawEvent of rawEvents) {
        const normalizedTitle = normalizeTitleText(rawEvent.title || rawEvent.ariaLabel);
        const eventDate = parseDateFromLabel(rawEvent.ariaLabel) || extractDate(rawEvent.title) || '';
        const eventTime = extractTime(rawEvent.time) || extractTime(rawEvent.ariaLabel) || extractTime(rawEvent.title);
        
        const potentialArtists = extractMultipleArtists(normalizedTitle);
        const artists = potentialArtists.length > 0 ? potentialArtists : (normalizedTitle ? [normalizedTitle] : []);
        
        for (const individualArtist of artists) {
            const cleanedArtist = cleanText(individualArtist);
            
            if (!cleanedArtist || cleanedArtist.length < 3 || cleanedArtist.length > 100) continue;
            if (!isLikelyArtistName(cleanedArtist)) continue;
            
            const artistKey = `${cleanedArtist.toLowerCase()}|${eventDate}|${eventTime}`;
            if (addedEvents.has(artistKey)) continue;
            
            addedEvents.add(artistKey);
            
            const record = createEventRecord(
                cleanedArtist,
                eventDate,
                eventTime,
                'Continental Club',
                '',
                cleanText(normalizedTitle.substring(0, 180)),
                ''
            );
            
            events.push(record);
            console.log(`Added event: ${cleanedArtist}${eventDate ? ` on ${eventDate}` : ''}`);
        }
    }
    
    console.log(`Total Continental Club events parsed: ${events.length}`);
    if (events.length > 0) {
        console.log(`Events found: ${events.map(e => e.artist).join(', ')}`);
    }
    return events;
}

// Initialize the Actor
await Actor.init();

const input = await Actor.getInput();
const startUrl = input?.startUrl || 'https://continentalclub.com/austin';
const maxRequestsPerCrawl = input?.maxRequestsPerCrawl || 100;

console.log(`Starting Continental Club calendar scraper on: ${startUrl}`);

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl,
    requestHandlerTimeoutSecs: 45, // Reduced timeout to prevent hanging
    
    async requestHandler({ page, request, log }) {
        log.info(`Processing: ${request.url}`);
        
        try {
            const events = await parseContinentalClubEvents(page);
            
            if (events.length > 0) {
                await Actor.pushData(events);
                log.info(`Saved ${events.length} events from Continental Club`);
                
                // Log a sample of the events for verification
                events.slice(0, 5).forEach((event, index) => {
                    log.info(`Event ${index + 1}: ${event.artist} - ${event.eventTime} - ${event.eventDate}`);
                });
            } else {
                log.warning('No events found on the page');
            }
            
        } catch (error) {
            log.error(`Error processing page: ${error.message}`);
            throw error;
        }
    },
});

// Add the start URL to the queue
await crawler.addRequests([startUrl]);

// Run the crawler
await crawler.run();

console.log('Continental Club calendar scraper finished!');
await Actor.exit();
