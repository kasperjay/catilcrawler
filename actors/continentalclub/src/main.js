import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

// Embedded utility functions (same as other actors for consistency)
function isLikelyArtistName(text) {
    if (!text || typeof text !== 'string') return false;
    
    const cleanText = text.trim();
    if (cleanText.length === 0) return false;
    
    // Exclude common promotional/junk patterns
    const excludePatterns = [
        // Social media links and platforms
        /facebook\.com|instagram\.com|twitter\.com|tiktok|spotify|apple\s*music|youtube\.com/i,
        /www\.|http|\.com|\.net|\.org/i,
        
        // VIP packages and merchandise
        /vip|meet\s*and\s*greet|signed\s*poster|exclusive|laminate|lanyard|cinch\s*bag/i,
        
        // Contact info and addresses
        /\b\d{5}\b/, // ZIP codes
        /texas|tx\s*\d+|austin,?\s*tx/i,
        /\d+\s*(studios?|suite|#\d+|sign\s*up)/i,
        
        // Promotional content
        /sponsored\s*by|more\s*artists?\s*tba|meet\s*&\s*greet/i,
        /tickets?|rsvp|info|details|buy\s*now/i,
        
        // Generic venue/event terms
        /^(venue|location|address|time|date|price|cost)$/i,
        /^(doors?|show|event|concert|performance)$/i,
        
        // Special characters that indicate non-artist content
        /^[^a-zA-Z]*$/, // Only numbers/symbols
        /@|#hashtag|\$\d+/,
        
        // Long URLs or technical strings
        /^https?:\/\/[^\s]+$/,
        /\.html?$|\.php$|\.asp$/i
    ];
    
    // Check exclusion patterns
    for (const pattern of excludePatterns) {
        if (pattern.test(cleanText)) return false;
    }
    
    // Require minimum alphabetic content (70% letters)
    const alphabeticChars = (cleanText.match(/[a-zA-Z]/g) || []).length;
    const alphabeticRatio = alphabeticChars / cleanText.length;
    if (alphabeticRatio < 0.7) return false;
    
    // Limit numbers and special characters
    const numberCount = (cleanText.match(/\d/g) || []).length;
    const specialCharCount = (cleanText.match(/[^a-zA-Z0-9\s&'-]/g) || []).length;
    
    if (numberCount > cleanText.length * 0.3 || specialCharCount > cleanText.length * 0.2) {
        return false;
    }
    
    // Positive identification patterns
    // Accept all-caps artist names (common for bands) but not too long
    if (/^[A-Z\s&'-]{2,35}$/.test(cleanText)) return true;
    
    // Accept proper title case (First Letter Capitalized)
    if (/^[A-Z][a-z]+(\s+[A-Z][a-z]*)*(\s+&\s+[A-Z][a-z]+)*$/.test(cleanText)) return true;
    
    // Accept mixed case with reasonable patterns
    if (/^[A-Za-z][\w\s&'-]{1,50}$/.test(cleanText) && !/\d{2,}/.test(cleanText)) return true;
    
    return false;
}

function createEventRecord(artist, eventDate, eventTime, venue, eventUrl, description, price) {
    return {
        artist: artist || 'Unknown Artist',
        eventDate: eventDate || '',
        eventTime: eventTime || '',
        venue: venue || 'Continental Club',
        eventUrl: eventUrl || '',
        description: description || '',
        price: price || '',
        scrapedAt: new Date().toISOString()
    };
}

function parseDate(dateStr) {
    if (!dateStr) return '';
    
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        return date.toISOString().split('T')[0]; // YYYY-MM-DD format
    } catch (error) {
        return '';
    }
}

function cleanText(text) {
    if (!text) return '';
    return text.replace(/\\s+/g, ' ').trim();
}

async function parseContinentalClubEvents(page) {
    console.log('Parsing Continental Club events...');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    
    const events = [];
    
    try {
        // Look for event containers - we'll need to inspect the actual site structure
        const eventElements = await page.locator('[class*="event"], [class*="show"], .calendar-event, .event-item, .show-item').all();
        
        console.log(`Found ${eventElements.length} potential event elements`);
        
        for (const element of eventElements) {
            try {
                // Extract event information - these selectors will need to be adjusted based on actual site structure
                const titleElement = element.locator('h1, h2, h3, h4, .title, .artist, .event-title, .show-title').first();
                const dateElement = element.locator('.date, .event-date, .show-date, [class*="date"]').first();
                const timeElement = element.locator('.time, .event-time, .show-time, [class*="time"]').first();
                const descElement = element.locator('.description, .event-description, p').first();
                const priceElement = element.locator('.price, .cost, .ticket, [class*="price"]').first();
                const linkElement = element.locator('a').first();
                
                const title = await titleElement.textContent().catch(() => '');
                const dateText = await dateElement.textContent().catch(() => '');
                const timeText = await timeElement.textContent().catch(() => '');
                const description = await descElement.textContent().catch(() => '');
                const price = await priceElement.textContent().catch(() => '');
                const eventUrl = await linkElement.getAttribute('href').catch(() => '');
                
                // Clean and validate the title as artist name
                const cleanTitle = cleanText(title);
                
                if (isLikelyArtistName(cleanTitle)) {
                    const eventDate = parseDate(dateText);
                    const eventTime = cleanText(timeText);
                    const eventDescription = cleanText(description);
                    const eventPrice = cleanText(price);
                    
                    const fullUrl = eventUrl && eventUrl.startsWith('/') 
                        ? `https://continentalclub.com${eventUrl}` 
                        : eventUrl;
                    
                    const record = createEventRecord(
                        cleanTitle,
                        eventDate,
                        eventTime,
                        'Continental Club',
                        fullUrl,
                        eventDescription,
                        eventPrice
                    );
                    
                    events.push(record);
                    console.log(`Added event: ${cleanTitle} on ${eventDate}`);
                } else {
                    console.log(`Filtered out non-artist content: "${cleanTitle}"`);
                }
                
            } catch (elementError) {
                console.log(`Error processing event element: ${elementError.message}`);
            }
        }
        
        // If no events found with the above selectors, try alternative approaches
        if (events.length === 0) {
            console.log('No events found with primary selectors, trying alternative approaches...');
            
            // Try looking for text that might be artist names
            const textElements = await page.locator('h1, h2, h3, h4, h5, h6, .artist, .performer, strong, b').all();
            
            for (const element of textElements) {
                try {
                    const text = await element.textContent();
                    const cleanedText = cleanText(text);
                    
                    if (isLikelyArtistName(cleanedText)) {
                        // Try to find associated date/time information
                        const parent = element.locator('..'); // Parent element
                        const dateText = await parent.locator('[class*="date"], .date').textContent().catch(() => '');
                        const timeText = await parent.locator('[class*="time"], .time').textContent().catch(() => '');
                        
                        const record = createEventRecord(
                            cleanedText,
                            parseDate(dateText),
                            cleanText(timeText),
                            'Continental Club',
                            '',
                            '',
                            ''
                        );
                        
                        events.push(record);
                        console.log(`Added event from text search: ${cleanedText}`);
                    }
                } catch (error) {
                    // Continue processing other elements
                }
            }
        }
        
    } catch (error) {
        console.log(`Error parsing events: ${error.message}`);
    }
    
    console.log(`Total events parsed: ${events.length}`);
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
    requestHandlerTimeoutSecs: 60,
    
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