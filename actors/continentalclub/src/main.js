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
    
    return true;
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
    
    try {
        // Extract all event data at once using a single page evaluation
        console.log('Extracting all event data from calendar...');
        
        const allEventData = await page.evaluate(() => {
            // Look for all possible event containers
            const eventSelectors = [
                '.timely-event',
                '[data-event-id]',
                '.event-item', 
                '.calendar-day-event',
                '.event-listing',
                '.event-row',
                '.event-card',
                '.calendar-event',
                '.event'
            ];
            
            let eventElements = [];
            
            // Try each selector until we find elements
            for (const selector of eventSelectors) {
                const elements = Array.from(document.querySelectorAll(selector));
                if (elements.length > 0 && elements.length < 200) { // Reasonable number
                    eventElements = elements;
                    break;
                }
            }
            
            console.log(`Found ${eventElements.length} event elements to process`);
            
            const extractedEvents = [];
            
            // Process up to 50 elements to avoid timeouts
            for (let i = 0; i < Math.min(eventElements.length, 50); i++) {
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
                
                // If no structured title, parse from full text
                if (!title && fullText) {
                    const lines = fullText.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
                    
                    for (const line of lines) {
                        // Look for time + artist patterns like "7:00pm The Bluebonnets"
                        const timeArtistMatch = line.match(/^(\\d{1,2}:\\d{2}(?:am|pm)?)\\s+(.+)$/i);
                        if (timeArtistMatch && timeArtistMatch[2].length > 2 && timeArtistMatch[2].length < 100) {
                            if (!time) time = timeArtistMatch[1];
                            title = timeArtistMatch[2].trim();
                            break;
                        }
                        
                        // If line looks like an artist name and we don't have a title
                        if (!title && line.length > 5 && line.length < 80 && 
                            !line.match(/^\\d{1,2}:\\d{2}/i) &&
                            !line.match(/^(mon|tue|wed|thu|fri|sat|sun)/i) &&
                            !line.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i)) {
                            title = line;
                        }
                    }
                }
                
                if (title || (fullText && fullText.length > 10)) {
                    extractedEvents.push({
                        title: title || '',
                        time: time || '',
                        date: date || '',
                        fullText: fullText || '',
                        eventUrl: eventUrl || ''
                    });
                }
            }
            
            return extractedEvents;
        });
        
        console.log(`Extracted ${allEventData.length} event data objects`);
        
        // Process the extracted data (this happens outside the browser context)
        for (const eventData of allEventData) {
            try {
                let artistName = eventData.title || eventData.fullText;
                
                if (!artistName || artistName.length < 3) continue;
                
                // Clean up artist names - remove set times and handle multiple artists
                // Remove set times like "@10pm", "@12am", etc.
                artistName = artistName.replace(/@\d{1,2}(:\d{2})?(am|pm)/gi, '');
                
                // Split on commas for multiple artists, but avoid splitting on times
                const artistParts = artistName.split(/,\s*(?![^@]*@)/).map(a => a.trim());
                
                for (const individualArtist of artistParts) {
                    const cleanedArtist = cleanText(individualArtist);
                    
                    if (!cleanedArtist || cleanedArtist.length < 3 || cleanedArtist.length > 80) {
                        continue;
                    }
                    
                    if (!isLikelyArtistName(cleanedArtist)) {
                        continue;
                    }
                    
                    // Check for duplicates
                    const isDuplicate = events.some(event => 
                        event.artist.toLowerCase() === cleanedArtist.toLowerCase()
                    );
                    
                    if (isDuplicate) {
                        continue;
                    }
                    
                    // Build full URL if needed
                    const fullUrl = eventData.eventUrl && eventData.eventUrl.startsWith('/') 
                        ? `https://continentalclub.com${eventData.eventUrl}` 
                        : eventData.eventUrl || '';
                    
                    const record = createEventRecord(
                        cleanedArtist,
                        eventData.date || extractDate(eventData.fullText) || '',
                        eventData.time || extractTime(eventData.fullText) || '',
                        'Continental Club',
                        fullUrl,
                        cleanText(eventData.fullText.substring(0, 100)),
                        ''
                    );
                    
                    events.push(record);
                    console.log(`Added event: ${cleanedArtist}`);
                }
                
            } catch (elementError) {
                console.log(`Error processing event data: ${elementError.message}`);
            }
        }
        
        // Additional text-based extraction if we have few events
        if (events.length < 5) {
            console.log('Limited events found, trying text-based extraction...');
            
            const pageText = await page.evaluate(() => document.body.textContent || '');
            const timeArtistRegex = /\b(\d{1,2}:\d{2}(?:am|pm)?)\s+([A-Z][a-zA-Z\s&\-']{4,60})(?=\s|$|,)/gi;
            let match;
            
            while ((match = timeArtistRegex.exec(pageText)) !== null && events.length < 30) {
                const time = match[1];
                let artistName = cleanText(match[2]);
                
                // Clean set times
                artistName = artistName.replace(/@\d{1,2}(:\d{2})?(am|pm)/gi, '');
                
                if (artistName && artistName.length >= 4 && artistName.length <= 60 &&
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
        }
        
    } catch (error) {
        console.error('Error parsing Continental Club events:', error);
    }
    
    console.log(`Total Continental Club events parsed: ${events.length}`);
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