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
        
        // Common promotional content
        /buy\s*tickets?|purchase|order|book|reserve/i,
        /(doors?|show)\s*(open|start)/i,
        /age\s*limit|all\s*ages|\d+\+/i,
        
        // Website structure content
        /copyright|rights?\s*reserved|privacy|terms/i,
        /follow\s*us|social\s*media|facebook|twitter|instagram/i
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
    
    // Debug: Check if page redirects to iframe
    const currentUrl = page.url();
    console.log(`Current URL after load: ${currentUrl}`);
    
    // Check for iframes
    const iframes = await page.locator('iframe').all();
    console.log(`Found ${iframes.length} iframes on page`);
    
    for (let i = 0; i < iframes.length; i++) {
        const src = await iframes[i].getAttribute('src');
        console.log(`Iframe ${i + 1} src: ${src}`);
    }
    
    // Navigate to the Timely calendar directly if we detected iframes
    if (iframes.length > 0) {
        for (const iframe of iframes) {
            const src = await iframe.getAttribute('src');
            if (src && src.includes('timely.fun') && !src.includes('popup')) {
                console.log(`Navigating to Timely calendar: ${src}`);
                await page.goto(src);
                await page.waitForLoadState('networkidle', { timeout: 30000 });
                await page.waitForTimeout(3000); // Additional wait for calendar to render
                break;
            }
        }
    }
    
    const events = [];
    
    try {
        // The Continental Club calendar might be loaded dynamically or in a specific format
        // Let's try multiple approaches to find events
        
        // First, look for structured calendar or event listings
        let eventElements = [];
        
        // For Timely calendar, try to find events with more specific parsing
        eventElements = await page.locator('.timely-event').all();
        
        if (eventElements.length === 0) {
            // Try other selectors
            const eventSelectors = [
                '[data-event-id]',
                '.event-item', 
                '.calendar-day-event',
                '.event-listing',
                '.event-row',
                '.event-card',
                '.calendar-event',
                '.event'
            ];
            
            for (const selector of eventSelectors) {
                const elements = await page.locator(selector).all();
                if (elements.length > 0) {
                    console.log(`Found ${elements.length} elements with selector: ${selector}`);
                    eventElements = elements;
                    break;
                }
            }
        }
        
        console.log(`Found ${eventElements.length} potential event elements`);
        
        // Debug: Let's see what we're actually finding
        for (let i = 0; i < Math.min(5, eventElements.length); i++) {
            const debugText = await eventElements[i].textContent().catch(() => '');
            console.log(`Debug - Element ${i + 1}: ${debugText.substring(0, 50)}...`);
        }
        
        // Process events with improved parsing for Timely calendar (limit to avoid timeout)
        for (let i = 0; i < Math.min(eventElements.length, 20); i++) {
            const element = eventElements[i];
            try {
                // Get full event data using more comprehensive extraction
                const eventData = await element.evaluate(el => {
                    const getText = (selector) => {
                        const elem = el.querySelector(selector);
                        return elem ? elem.textContent.trim() : '';
                    };
                    
                    // Try to extract structured data from Timely event
                    let title = getText('.event-title') || getText('.title') || getText('h3') || getText('h4') || getText('.name');
                    let time = getText('.time') || getText('.event-time') || getText('.start-time');
                    let date = getText('.date') || getText('.event-date');
                    
                    // If no structured title, parse from full text
                    const fullText = el.textContent.trim();
                    
                    if (!title && fullText) {
                        // For Timely calendar format, often the text is like "7:00pm The Bluebonnets"
                        const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);
                        for (const line of lines) {
                            // Look for lines that don't start with time and contain artist names
                            if (line.length > 5 && line.length < 200 && 
                                !line.match(/^\d{1,2}:\d{2}(am|pm)?$/i) &&
                                !line.match(/^(mon|tue|wed|thu|fri|sat|sun)/i) &&
                                !line.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i)) {
                                
                                // Extract artist name from time+artist format
                                const timeArtistMatch = line.match(/^\d{1,2}:\d{2}(am|pm)?\s+(.+)$/i);
                                if (timeArtistMatch) {
                                    title = timeArtistMatch[2].trim();
                                    if (!time) time = line.match(/^\d{1,2}:\d{2}(am|pm)?/i)?.[0] || '';
                                    break;
                                } else if (line.length > 5) {
                                    title = line;
                                    break;
                                }
                            }
                        }
                    }
                    
                    return {
                        title: title || '',
                        time: time || '',
                        date: date || '',
                        fullText: fullText || ''
                    };
                });

                console.log(`Processing event ${i + 1}:`, {
                    title: eventData.title.substring(0, 30),
                    time: eventData.time,
                    fullText: eventData.fullText.substring(0, 50)
                });
                
                // Skip if no meaningful content
                if (!eventData.title && (!eventData.fullText || eventData.fullText.length < 5)) {
                    continue;
                }
                
                let artistName = eventData.title || eventData.fullText;
                
                // Clean up artist names - remove set times and extract multiple artists
                if (artistName) {
                    // Remove set times like "@10pm", "@12am", etc.
                    artistName = artistName.replace(/@\d{1,2}(:\d{2})?(am|pm)/gi, '');
                    
                    // Handle multiple artists separated by commas
                    // Example: "James McMurtry, Dustin Welch" -> extract both
                    const multipleArtists = artistName.split(/,\s*(?![^@]*@)/);
                    
                    if (multipleArtists.length > 1) {
                        // Process each artist separately
                        for (const individualArtist of multipleArtists) {
                            const cleanIndividualArtist = cleanText(individualArtist.trim());
                            
                            if (cleanIndividualArtist && cleanIndividualArtist.length >= 3 && 
                                cleanIndividualArtist.length <= 200 &&
                                isLikelyArtistName(cleanIndividualArtist)) {
                                
                                // Try to find an associated link
                                let eventUrl = '';
                                try {
                                    const linkElement = await element.locator('a').first();
                                    eventUrl = await linkElement.getAttribute('href') || '';
                                } catch (e) {
                                    eventUrl = '';
                                }
                                
                                const fullUrl = eventUrl && eventUrl.startsWith('/') 
                                    ? `https://continentalclub.com${eventUrl}` 
                                    : eventUrl || '';
                                
                                const record = createEventRecord(
                                    cleanIndividualArtist,
                                    eventData.date || extractDate(eventData.fullText) || '',
                                    eventData.time || extractTime(eventData.fullText) || '',
                                    'Continental Club',
                                    fullUrl,
                                    cleanText(eventData.fullText.substring(0, 100)),
                                    ''
                                );
                                
                                events.push(record);
                                console.log(`Added individual artist: ${cleanIndividualArtist}`);
                            }
                        }
                        continue; // Skip the single artist processing below
                    }
                    
                    // Clean single artist name
                    artistName = cleanText(artistName.trim());
                }
                
                // Skip navigation or non-event content  
                if (!artistName || artistName.length < 3 || artistName.length > 200 ||
                    !isLikelyArtistName(artistName)) {
                    continue;
                }
                
                // Create event object for single artist
                const cleanedArtist = cleanText(artistName);
                if (cleanedArtist.length > 2) {
                    // Try to find an associated link
                    let eventUrl = '';
                    try {
                        const linkElement = await element.locator('a').first();
                        eventUrl = await linkElement.getAttribute('href') || '';
                    } catch (e) {
                        // No link found, use empty string
                        eventUrl = '';
                    }
                    
                    const fullUrl = eventUrl && eventUrl.startsWith('/') 
                        ? `https://continentalclub.com${eventUrl}` 
                        : eventUrl || '';
                    
                    const record = createEventRecord(
                        cleanedArtist,
                        eventData.date || extractDate(eventData.fullText) || '',
                        eventData.time || extractTime(eventData.fullText) || '',
                        'Continental Club',
                        fullUrl,
                        cleanText(eventData.fullText.substring(0, 100)),
                        page.url()
                    );
                    
                    events.push(record);
                    console.log(`Added event: ${cleanedArtist}`);
                }
            } catch (elementError) {
                // Continue with next element
                console.log(`Error processing element: ${elementError.message}`);
            }
        }
        
        // If we still have very few events, try a text-based search as fallback
        if (events.length < 5) {
            console.log('Limited events found, trying fallback text search...');
            const bodyText = await page.locator('body').textContent().catch(() => '');
            
            if (bodyText) {
                // Look for time + artist patterns in the text
                const timeArtistRegex = /\d{1,2}:\d{2}(am|pm)?\s+([A-Z][a-zA-Z\s&\-']{4,50})/gi;
                let match;
                
                while ((match = timeArtistRegex.exec(bodyText)) !== null && events.length < 25) {
                    let potentialArtist = cleanText(match[2]);
                    
                    // Clean up artist name - remove set times
                    potentialArtist = potentialArtist.replace(/@\d{1,2}(:\d{2})?(am|pm)/gi, '');
                    
                    // Handle multiple artists in one match
                    const multipleArtists = potentialArtist.split(/,\s*(?![^@]*@)/);
                    
                    for (const individualArtist of multipleArtists) {
                        const cleanIndividualArtist = cleanText(individualArtist.trim());
                        
                        if (cleanIndividualArtist && cleanIndividualArtist.length >= 4 && 
                            cleanIndividualArtist.length <= 60 &&
                            isLikelyArtistName(cleanIndividualArtist)) {
                            
                            // Check if we already have this artist to avoid duplicates
                            const isDuplicate = events.some(event => 
                                event.artist.toLowerCase() === cleanIndividualArtist.toLowerCase()
                            );
                            
                            if (!isDuplicate) {
                                const record = createEventRecord(
                                    cleanIndividualArtist,
                                    '', // Date extraction from context would be complex
                                    match[0].match(/\d{1,2}:\d{2}(am|pm)?/i)?.[0] || '',
                                    'Continental Club',
                                    '',
                                    cleanText(match[0].substring(0, 100)),
                                    ''
                                );
                                
                                events.push(record);
                                console.log(`Added fallback event: ${cleanIndividualArtist}`);
                            }
                        }
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
    requestHandlerTimeoutSecs: 60, // Set to 1 minute to prevent hanging
    
    async requestHandler({ page, request, log }) {
        log.info(`Processing: ${request.url}`);
        
        try {
            const events = await parseContinentalClubEvents(page);
            
            if (events.length > 0) {
                await Actor.pushData(events);
                log.info(`Saved ${events.length} events from Continental Club`);
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