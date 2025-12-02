import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

// Utility function to determine if a string looks like an artist name
function isLikelyArtistName(text) {
    if (!text || typeof text !== 'string') return false;
    
    const cleaned = text.trim();
    if (cleaned.length < 3 || cleaned.length > 80) return false;
    
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
    if (cleaned.length < 4 || cleaned.length > 50) return false;
    
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
    if (/\b(all\s+night\s+long|annual\s+.*show)\b/i.test(cleaned)) return false;
    
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

async function parseContinentalClubEvents(page) {
    console.log('Parsing Continental Club events...');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    // Navigate to the Timely calendar directly if we detect iframes
    const iframes = await page.locator('iframe').all();
    console.log(`Found ${iframes.length} iframes on page`);
    
    if (iframes.length > 0) {
        for (const iframe of iframes) {
            const src = await iframe.getAttribute('src');
            if (src && src.includes('timely.fun') && !src.includes('popup')) {
                console.log(`Navigating to Timely calendar: ${src}`);
                await page.goto(src);
                await page.waitForLoadState('networkidle', { timeout: 30000 });
                await page.waitForTimeout(2000); // Brief wait for calendar to render
                break;
            }
        }
    }
    
        const events = [];
        const addedEvents = new Set();    try {
        // Extract all event data at once using a single page evaluation
        console.log('Extracting all event data from calendar...');
        
        const addedEvents = new Set(); // Track added events to prevent duplicates
        
        const eventData = await page.evaluate(() => {
            // Look for all possible event containers with expanded selectors
            const eventSelectors = [
                '.timely-event',
                '[data-event-id]',
                '.event-item', 
                '.calendar-day-event',
                '.event-listing',
                '.event-row',
                '.event-card',
                '.calendar-event',
                '.event',
                // Additional selectors for Timely calendar
                'div[class*="event"]',
                'div[class*="timely"]',
                'li[class*="event"]',
                'a[href*="event"]',
                // Look for any elements with time patterns
                '*:contains("pm")', 
                '*:contains("am")'
            ];
            
            let eventElements = new Set(); // Use Set to avoid duplicates
            
            // Try each selector and collect ALL matching elements
            for (const selector of eventSelectors) {
                try {
                    const elements = Array.from(document.querySelectorAll(selector));
                    elements.forEach(el => eventElements.add(el));
                } catch (e) {
                    // Skip selectors that don't work (like :contains)
                }
            }
            
            // Convert Set back to Array
            eventElements = Array.from(eventElements);
            
            console.log(`Found ${eventElements.length} total event elements to process`);
            
            const extractedEvents = [];
            
            // Process ALL elements, not just first 50
            for (let i = 0; i < eventElements.length; i++) {
                const el = eventElements[i];
                const fullText = el.textContent?.trim() || '';
                
                if (fullText.length < 5) continue;
                
                // Extract basic data
                let title = '';
                let time = '';
                let date = '';
                let eventUrl = '';
                
                // Try structured selectors first
                const titleEl = el.querySelector('.event-title, .title, h3, h4, .name');
                const timeEl = el.querySelector('.time, .event-time, .start-time');
                const dateEl = el.querySelector('.date, .event-date');
                const linkEl = el.querySelector('a');
                
                title = titleEl?.textContent?.trim() || '';
                time = timeEl?.textContent?.trim() || '';
                date = dateEl?.textContent?.trim() || '';
                eventUrl = linkEl?.href || '';
                
                // If no structured title, parse from full text with multiple strategies
                if (!title && fullText) {
                    const lines = fullText.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
                    
                    for (const line of lines) {
                        // Strategy 1: Look for time + artist patterns like "7:00pm The Bluebonnets"
                        const timeArtistMatch = line.match(/^(\\d{1,2}:\\d{2}(?:am|pm)?)\\s+(.+)$/i);
                        if (timeArtistMatch && timeArtistMatch[2].length > 2 && timeArtistMatch[2].length < 100) {
                            if (!time) time = timeArtistMatch[1];
                            title = timeArtistMatch[2].trim();
                            break;
                        }
                        
                        // Strategy 2: Look for artists with @ times like "James McMurtry @10pm"
                        const artistAtTimeMatch = line.match(/^(.+?)\\s+@\\d{1,2}(:\\d{2})?(am|pm)/i);
                        if (artistAtTimeMatch && artistAtTimeMatch[1].length > 3) {
                            title = artistAtTimeMatch[1].trim();
                            if (!time) {
                                const timeMatch = line.match(/@(\\d{1,2}(:\\d{2})?(am|pm))/i);
                                if (timeMatch) time = timeMatch[1];
                            }
                            break;
                        }
                        
                        // Strategy 3: If line looks like an artist name and we don't have a title
                        if (!title && line.length > 3 && line.length < 80 && 
                            !line.match(/^\\d{1,2}:\\d{2}/i) &&
                            !line.match(/^(mon|tue|wed|thu|fri|sat|sun)/i) &&
                            !line.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i) &&
                            !line.match(/^\\d+$/) && // Not just numbers
                            line.match(/[A-Za-z]/) && // Contains letters
                            !line.match(/^(view|more|info|details|tickets)$/i)) { // Not generic UI text
                            title = line;
                        }
                    }
                    
                    // Strategy 4: Look for artist names anywhere in the text using regex
                    if (!title) {
                        // Find text that looks like artist names (2+ words, proper case, reasonable length)
                        const artistMatches = fullText.match(/\\b[A-Z][a-z]+(?:\\s+[A-Z&][a-zA-Z]*)*(?:\\s+[A-Z][a-z]+)*\\b/g);
                        if (artistMatches) {
                            for (const match of artistMatches) {
                                if (match.length > 4 && match.length < 60 && 
                                    !match.match(/^(December|January|February|March|April|May|June|July|August|September|October|November)$/i) &&
                                    !match.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/i)) {
                                    title = match.trim();
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // Lower the threshold - capture more potential events
                if (title || (fullText && fullText.length > 5)) {
                    extractedEvents.push({
                        title: title || '',
                        time: time || '',
                        date: date || '',
                        fullText: fullText || '',
                        eventUrl: eventUrl || '',
                        elementIndex: i // For debugging
                    });
                    
                    // Debug log for first 10 elements
                    if (i < 10) {
                        console.log(`Element ${i}: title="${title}", time="${time}", fullText="${fullText.substring(0, 60)}..."`);
                    }
                }
            }
            
            return extractedEvents;
        });
        
        console.log(`Extracted ${eventData.length} event data objects`);
        
        // Process the extracted data (this happens outside the browser context)
        for (const eventItem of eventData) {
            try {
                let artistName = eventItem.title || eventItem.fullText;
                
                if (!artistName || artistName.length < 3) continue;
                
                // Extract multiple artists from complex event text
                const extractedArtists = extractMultipleArtists(artistName);
                
                for (const individualArtist of extractedArtists) {
                    const cleanedArtist = cleanText(individualArtist);
                    
                    if (!cleanedArtist || cleanedArtist.length < 3 || cleanedArtist.length > 80) {
                        continue;
                    }
                    
                    if (!isLikelyArtistName(cleanedArtist)) {
                        continue;
                    }
                    
                    // Check for duplicates using the Set
                    const artistKey = cleanedArtist.toLowerCase();
                    if (addedEvents.has(artistKey)) {
                        continue;
                    }
                    
                    addedEvents.add(artistKey);
                    
                    // Build full URL if needed
                    const fullUrl = eventItem.eventUrl && eventItem.eventUrl.startsWith('/') 
                        ? `https://continentalclub.com${eventItem.eventUrl}` 
                        : eventItem.eventUrl || '';
                    
                    const record = createEventRecord(
                        cleanedArtist,
                        eventItem.date || extractDate(eventItem.fullText) || '',
                        eventItem.time || extractTime(eventItem.fullText) || '',
                        'Continental Club',
                        fullUrl,
                        cleanText(eventItem.fullText.substring(0, 100)),
                        ''
                    );
                    
                    events.push(record);
                    console.log(`Added event: ${cleanedArtist}`);
                }
                
            } catch (elementError) {
                console.log(`Error processing event data: ${elementError.message}`);
            }
        }
        
        // Additional text-based extraction to catch any missed artists
        if (events.length < 20) { // Increased threshold since we expect 26+
            console.log('Doing comprehensive text-based extraction to find more artists...');
            
            const pageText = await page.evaluate(() => document.body.textContent || '');
            
            // Strategy 1: Time + artist patterns
            const timeArtistRegex = /\b(\d{1,2}:\d{2}(?:am|pm)?)\s+([A-Z][a-zA-Z\s&\-']{3,60})(?=\s|$|,|\.|@)/gi;
            let match;
            
            while ((match = timeArtistRegex.exec(pageText)) !== null && events.length < 50) {
                const time = match[1];
                let artistName = cleanText(match[2]);
                
                // Clean set times and extra markers
                artistName = artistName.replace(/@\d{1,2}(:\d{2})?(am|pm)/gi, '');
                artistName = artistName.replace(/\s+(Night|Day)\s+\d+$/i, ''); // Remove "Night 1", "Day 2" etc.
                
                if (artistName && artistName.length >= 3 && artistName.length <= 60 &&
                    isLikelyArtistName(artistName)) {
                    
                    // Check for duplicates
                    const isDuplicate = events.some(event => 
                        event.artist.toLowerCase() === artistName.toLowerCase()
                    );
                    
                    if (!isDuplicate) {
                        const record = createEventRecord(
                            artistName,
                            '',
                            time,
                            'Continental Club',
                            '',
                            cleanText(match[0].substring(0, 100)),
                            ''
                        );
                        
                        events.push(record);
                        console.log(`Added text-based event: ${artistName}`);
                    }
                }
            }
            
            // Strategy 2: Artist @ time patterns
            const artistAtTimeRegex = /\b([A-Z][a-zA-Z\s&\-']{3,50})\s+@\d{1,2}(:\d{2})?(am|pm)/gi;
            
            while ((match = artistAtTimeRegex.exec(pageText)) !== null && events.length < 50) {
                let artistName = cleanText(match[1]);
                const timeMatch = match[0].match(/@(\d{1,2}(:\d{2})?(am|pm))/i);
                const time = timeMatch ? timeMatch[1] : '';
                
                if (artistName && artistName.length >= 3 && artistName.length <= 50 &&
                    isLikelyArtistName(artistName)) {
                    
                    // Check for duplicates
                    const isDuplicate = events.some(event => 
                        event.artist.toLowerCase() === artistName.toLowerCase()
                    );
                    
                    if (!isDuplicate) {
                        const record = createEventRecord(
                            artistName,
                            '',
                            time,
                            'Continental Club',
                            '',
                            cleanText(match[0].substring(0, 100)),
                            ''
                        );
                        
                        events.push(record);
                        console.log(`Added @time-based event: ${artistName}`);
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('Error parsing Continental Club events:', error);
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