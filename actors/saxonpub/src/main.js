import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

// Helper functions
function createEventRecord(artist, date, time, venue, url, description, price) {
    return {
        artist: artist || '',
        eventDate: date || '',
        eventTime: time || '',
        venue: venue || 'Saxon Pub',
        eventUrl: url || '',
        description: description || '',
        price: price || '',
        scrapedAt: new Date().toISOString()
    };
}

function parseDate(dateString) {
    try {
        if (!dateString) return '';
        
        // Handle formats like "December 1 @ 6:00 pm - 7:30 pm" or "December 1, 2025"
        const dateMatch = dateString.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/);
        if (dateMatch) {
            const currentYear = new Date().getFullYear();
            return `${dateMatch[1]} ${dateMatch[2]}, ${currentYear}`;
        }
        
        // Handle "Dec 1" format
        const shortDateMatch = dateString.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/);
        if (shortDateMatch) {
            const currentYear = new Date().getFullYear();
            return `${shortDateMatch[1]} ${shortDateMatch[2]}, ${currentYear}`;
        }
        
        return '';
    } catch (error) {
        return '';
    }
}

function parseTime(timeString) {
    try {
        if (!timeString) return '';
        
        // Extract time from formats like "6:00 pm - 7:30 pm" or "@ 6:00 pm"
        const timeMatch = timeString.match(/(\d{1,2}:\d{2}\s*(?:am|pm|AM|PM))/);
        if (timeMatch) {
            return timeMatch[1].trim();
        }
        
        return timeString.trim();
    } catch (error) {
        return '';
    }
}

function isLikelyArtistName(text) {
    if (!text || typeof text !== 'string') return false;
    
    const cleaned = text.toLowerCase().trim();
    
    // Skip common non-artist phrases
    const skipPatterns = [
        /^(home|about|events|calendar|contact|shop|gallery|menu|news)$/,
        /^(welcome|subscribe|newsletter|social|facebook|twitter|instagram)$/,
        /^(get tickets|buy tickets|more info|click here|read more|private events|merch|info|faqs|booking)$/,
        /^(free show|tips appreciated|admission|cover|charge|find events)$/,
        /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/,
        /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/,
        /^\d+\s*(events|pm|am|:|@)/,
        /^(previous|next|current|month|year|this month|select date|search)$/,
        /^(skip to content|enter keyword|site by)/,
        /^(list|month)$/,
        /display\s*:\s*none/,
        /tec-events/,
        /elementor/
    ];
    
    for (const pattern of skipPatterns) {
        if (pattern.test(cleaned)) return false;
    }
    
    // Must be reasonable length
    if (cleaned.length < 5 || cleaned.length > 80) return false;
    
    // Likely artist indicators
    const artistIndicators = [
        /band$/,
        /trio$/,
        /quartet$/,
        /ensemble$/,
        /orchestra$/,
        /acoustic/,
        /lounge/,
        /show$/,
        /music/,
        /blues/,
        /^[A-Z][a-z]+ [A-Z]/  // Proper names like "John Smith"
    ];
    
    for (const indicator of artistIndicators) {
        if (indicator.test(cleaned)) return true;
    }
    
    // If it contains music-related words or proper capitalization, likely an artist
    // Allow proper names that look like artists (First Last or descriptive names)
    if (/^[A-Z][a-z]+ [A-Z]/.test(text)) return true; // "John Smith" format
    if (/^The [A-Z]/.test(text)) return true; // "The Something" format
    if (/^[A-Z][a-z]+$/.test(text) && text.length > 5) return true; // Single proper names
    
    return false;
}

function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
}

function extractPrice(text) {
    if (!text) return '';
    
    // Look for price patterns
    const priceMatch = text.match(/\$\d+\.?\d*/);
    if (priceMatch) return priceMatch[0];
    
    // Look for free indicators
    if (/free|no cover|no charge|tips appreciated/i.test(text)) {
        return 'FREE';
    }
    
    return '';
}

async function parseSaxonPubEvents(page) {
    console.log('Parsing Saxon Pub events...');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    
    const events = [];
    
    try {
        // Try to find specific calendar event elements first
        let eventElements = [];
        
        // Look for tribe events (Saxon Pub likely uses The Events Calendar plugin)
        eventElements = await page.locator('.tribe-events-calendar-month__calendar-event, .tribe-events-list-event, .tribe-common-g-row').all();
        if (eventElements.length > 0) {
            console.log(`Found ${eventElements.length} tribe calendar events`);
        } else {
            // Try other event-specific selectors
            const eventSelectors = [
                '.tribe-event',
                '.event',
                'article[class*="event"]',
                '.calendar-event',
                '[class*="tribe-events"]'
            ];
            
            for (const selector of eventSelectors) {
                const elements = await page.locator(selector).all();
                if (elements.length > 0 && elements.length < 100) { // Avoid overly broad matches
                    console.log(`Found ${elements.length} elements with selector: ${selector}`);
                    eventElements = elements;
                    break;
                }
            }
        }
        
        // If still no structured events found, try calendar cells but be more selective
        if (eventElements.length === 0) {
            console.log('Looking for calendar table cells...');
            eventElements = await page.locator('td[class*="day"], .calendar-day[class*="event"]').all();
        }
        
        console.log(`Processing ${eventElements.length} potential event elements`);
        
        // Process each potential event element
        for (let i = 0; i < Math.min(eventElements.length, 50); i++) {
            const element = eventElements[i];
            
            try {
                const elementText = await element.textContent() || '';
                
                if (!elementText || elementText.length < 10) continue;
                
                console.log(`Processing element ${i + 1}: ${elementText.substring(0, 100)}...`);
                
                // Look for links within the element
                const links = await element.locator('a').all();
                
                for (const link of links) {
                    const linkText = await link.textContent() || '';
                    const linkUrl = await link.getAttribute('href') || '';
                    
                    if (!isLikelyArtistName(linkText)) continue;
                    
                    // Extract event details from the surrounding text
                    const fullText = elementText;
                    const artistName = cleanText(linkText);
                    
                    // Parse date and time from the element text
                    const eventDate = parseDate(fullText);
                    const eventTime = parseTime(fullText);
                    const eventPrice = extractPrice(fullText);
                    
                    // Build full URL if relative
                    const fullUrl = linkUrl.startsWith('/') 
                        ? `https://thesaxonpub.com${linkUrl}` 
                        : linkUrl;
                    
                    // Extract description (text around the artist name)
                    const description = cleanText(fullText.replace(linkText, '').substring(0, 200));
                    
                    const record = createEventRecord(
                        artistName,
                        eventDate,
                        eventTime,
                        'Saxon Pub',
                        fullUrl,
                        description,
                        eventPrice
                    );
                    
                    events.push(record);
                    console.log(`Added event: ${artistName} on ${eventDate}`);
                }
                
                // Also try to extract events from plain text if no links found
                if (links.length === 0) {
                    const lines = elementText.split(/[\n\r]+/).map(line => line.trim()).filter(line => line.length > 5);
                    
                    for (const line of lines) {
                        if (isLikelyArtistName(line) && line.length > 5 && line.length < 100) {
                            const eventDate = parseDate(elementText);
                            const eventTime = parseTime(elementText);
                            const eventPrice = extractPrice(elementText);
                            
                            const record = createEventRecord(
                                cleanText(line),
                                eventDate,
                                eventTime,
                                'Saxon Pub',
                                '',
                                cleanText(elementText.substring(0, 150)),
                                eventPrice
                            );
                            
                            events.push(record);
                            console.log(`Added text-based event: ${line}`);
                            break; // Only one event per element
                        }
                    }
                }
                
            } catch (elementError) {
                console.log(`Error processing element: ${elementError.message}`);
            }
        }
        
        // Fallback: try to find event info in the page text
        if (events.length < 3) {
            console.log('Limited events found, trying fallback text extraction...');
            
            const bodyText = await page.locator('body').textContent() || '';
            const eventPatterns = [
                /([A-Z][a-zA-Z\s&]+(?:Band|Trio|Quartet|Lounge|Show))\s*December \d+/gi,
                /December \d+[^0-9]*([A-Z][a-zA-Z\s&]{5,40})/gi
            ];
            
            for (const pattern of eventPatterns) {
                let match;
                while ((match = pattern.exec(bodyText)) !== null && events.length < 20) {
                    const potentialArtist = cleanText(match[1]);
                    
                    if (isLikelyArtistName(potentialArtist)) {
                        const context = bodyText.substring(Math.max(0, match.index - 50), match.index + 100);
                        const eventDate = parseDate(context);
                        const eventTime = parseTime(context);
                        const eventPrice = extractPrice(context);
                        
                        const record = createEventRecord(
                            potentialArtist,
                            eventDate,
                            eventTime,
                            'Saxon Pub',
                            '',
                            cleanText(context.substring(0, 100)),
                            eventPrice
                        );
                        
                        events.push(record);
                        console.log(`Added fallback event: ${potentialArtist}`);
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('Error parsing Saxon Pub events:', error);
    }
    
    console.log(`Total Saxon Pub events parsed: ${events.length}`);
    return events;
}

console.log('Starting Saxon Pub calendar scraper...');

await Actor.init();

// Get input
const input = await Actor.getInput() || {};
const {
    startUrl = 'https://thesaxonpub.com/events/',
    maxEvents = 50
} = input;

console.log('Starting Saxon Pub calendar scraper on:', startUrl);

// Configure crawler
const crawler = new PlaywrightCrawler({
    headless: true,
    requestHandler: async ({ page, request }) => {
        console.log(`Processing: ${request.url}`);
        
        const events = await parseSaxonPubEvents(page);
        
        // Limit events if specified
        const limitedEvents = maxEvents > 0 ? events.slice(0, maxEvents) : events;
        
        if (limitedEvents.length === 0) {
            console.warn('No events found on the page');
        } else {
            console.log(`Saved ${limitedEvents.length} events from Saxon Pub`);
        }
        
        // Push each event to the dataset
        for (const event of limitedEvents) {
            await Actor.pushData(event);
        }
    },
    maxRequestsPerCrawl: 1,
});

// Add initial request
await crawler.addRequests([{ url: startUrl }]);

// Run the crawler
await crawler.run();

console.log('Saxon Pub calendar scraper finished!');

await Actor.exit();