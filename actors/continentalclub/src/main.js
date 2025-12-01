import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

/**
 * Shared utility functions - embedded from common utilities
 */

// Filter function to identify likely artist names
function isLikelyArtistName(text) {
    if (!text || typeof text !== 'string') return false;
    
    // Clean and normalize the text
    const cleanText = text.trim();
    if (cleanText.length === 0 || cleanText.length > 100) return false;
    
    // Check for ZIP codes (5 digits)
    if (/\b\d{5}\b/.test(cleanText)) return false;
    
    // Check for Texas cities with state abbreviations
    if (/\b(Austin|Dallas|Houston|San Antonio|Fort Worth|Arlington|Plano|Corpus Christi|Lubbock|Irving|Garland|Amarillo|Grand Prairie|McKinney|Frisco|Brownsville|Killeen|Pasadena|Mesquite|McAllen|Carrollton|Waco|Beaumont|Abilene|Richardson|Midland|Lewisville|Round Rock|Tyler|College Station|Pearland|Laredo|Denton|Sugar Land|Baytown|Conroe|Longview|Bryan|Pharr|Temple|Missouri City|Flower Mound|Allen|League City|Odessa|Mission|Edinburg|San Marcos|Georgetown|Cedar Park|New Braunfels|Harlingen|North Richland Hills|Victoria|Mansfield|Euless|DeSoto|Grapevine|Galveston|Pflugerville|Watauga|Nacogdoches|Port Arthur|Huntsville|Texas City|Texarkana|Hurst|Keller|Southlake|Weatherford|Wylie|Coppell|Rockwall|University Park|Burleson|Lancaster|The Colony|Friendswood|Cedar Hill|Duncanville|La Porte|Del Rio|Eagle Pass|Paris|Marshall|Sherman|Greenville|Corsicana|Jacksonville|Palestine|Stephenville|Mineral Wells|Vernon|Athens|Gainesville|Sulphur Springs|Commerce|Canyon|Levelland|Plainview|Big Spring|Sweetwater|Snyder|Brownwood|Huntsville|Lufkin|Orange|Vidor|Port Neches|Nederland|Groves|Silsbee|Jasper|Center|Carthage|Henderson|Kilgore|Gladewater|White Oak|Tatum|Beckville|Marshall|Karnack|Jefferson|Uncertain|Lone Star|Daingerfield|Hughes Springs|Pittsburg|Mount Pleasant|Winnsboro|Sulphur Bluff|Quitman|Mineola|Alba|Grand Saline|Emory|Point|Lone Oak|Quinlan|West Tawakoni|East Tawakoni|Wills Point|Edgewood|Van|Canton|Edom|Ben Wheeler|Brownsboro|Chandler|Flint|Gresham|New London|Overton|Troup|Arp|Reklaw|Rusk|New Summerfield|Laird Hill|Mount Enterprise|Carthage|Timpson|Tenaha|Logansport|DeBerry|Panola|Beckville|Elysian Fields|Waskom|Karnack|Uncertain|Harleton|Scottsville|Marshall|Hallsville|Longview|White Oak|Gladewater|Kilgore|Overton|Tatum|Easton|Diana|Ore City|Hughes Springs|Daingerfield|Lone Star|Big Sandy|Gilmer|Union Grove|Gladewater|Liberty City|Price|Tatum|Easton|Diana)\s*(,\s*TX|,\s*Texas|\s+TX\s|\s+Texas\s)/i.test(cleanText)) return false;
    
    // Check for studio references with numbers  
    if (/studio\s*\w*\s*\d+/i.test(cleanText)) return false;
    
    // Check for common promotional phrases
    const promotionalPhrases = [
        'TBA', 'to be announced', 'more artists tba', 'artists tba',
        'sponsored by', 'presented by', 'in partnership with',
        'meet and greet', 'meet & greet', 'vip', 'exclusive',
        'signed poster', 'cinch bag', 'tote bag', 'merchandise',
        'tickets', 'admission', 'cover charge', 'door charge',
        'lineup', 'festival', 'more info', 'details',
        'facebook', 'instagram', 'twitter', 'tiktok', 'youtube',
        'spotify', 'apple music', 'soundcloud', 'bandcamp'
    ];
    
    if (promotionalPhrases.some(phrase => cleanText.toLowerCase().includes(phrase))) {
        return false;
    }
    
    // Check for URLs or email addresses
    if (/https?:\/\/|www\.|@.*\.com/.test(cleanText)) return false;
    
    // Check for form elements and addresses
    if (/suite\s*[a-z]?-?\d+|#\d+|sign up|signup|street|road|avenue|blvd|boulevard|lane|drive|way|circle|court|place/i.test(cleanText)) return false;
    
    // Check alphabetic ratio (must be at least 70% letters)
    const letterCount = (cleanText.match(/[a-zA-Z]/g) || []).length;
    const totalChars = cleanText.length;
    if (letterCount / totalChars < 0.7) return false;
    
    // Check for excessive special characters or numbers
    const specialCharsCount = (cleanText.match(/[^a-zA-Z0-9\s\-&']/g) || []).length;
    const numberCount = (cleanText.match(/\d/g) || []).length;
    
    // Allow some special chars and numbers, but not too many
    if (specialCharsCount > 3 || numberCount > 4) return false;
    
    // Positive identification: Look for patterns that suggest artist names
    // All caps (but not too long) often indicates artist names
    if (/^[A-Z\s&'-]{2,35}$/.test(cleanText)) return true;
    
    // Title case with reasonable length
    if (/^[A-Z][a-z]*(?:\s+[A-Z][a-z]*)*$/.test(cleanText) && cleanText.length <= 50) return true;
    
    // Mixed case with common artist name patterns
    if (/^[A-Za-z][A-Za-z\s&'-]{1,48}[A-Za-z]$/.test(cleanText)) {
        // Additional check: shouldn't be all lowercase or have too many uppercase letters
        const uppercaseCount = (cleanText.match(/[A-Z]/g) || []).length;
        const lowercaseCount = (cleanText.match(/[a-z]/g) || []).length;
        
        // Good ratio of upper to lower case
        if (uppercaseCount > 0 && lowercaseCount > uppercaseCount * 0.5) {
            return true;
        }
    }
    
    return false;
}

// Clean and format event data
function createEventRecord(eventData) {
    const record = {
        venue: 'Continental Club Austin',
        venueUrl: 'https://continentalclub.com/austin',
        title: eventData.title || '',
        artist: eventData.artist || '',
        date: eventData.date || '',
        time: eventData.time || '',
        description: eventData.description || '',
        ticketUrl: eventData.ticketUrl || '',
        imageUrl: eventData.imageUrl || '',
        genres: eventData.genres || [],
        priceRange: eventData.priceRange || '',
        ageRestriction: eventData.ageRestriction || '',
        scrapedAt: new Date().toISOString()
    };
    
    // Clean empty strings
    Object.keys(record).forEach(key => {
        if (record[key] === '') {
            delete record[key];
        }
    });
    
    return record;
}

// Parse Continental Club specific artist information
function parseContinentalArtists(text) {
    if (!text) return [];
    
    // Split by common delimiters and clean each part
    const parts = text
        .split(/[,\n\r\t]+/)
        .map(part => part.trim())
        .filter(part => part.length > 0)
        .filter(isLikelyArtistName);
    
    return parts.length > 0 ? parts : [];
}

// Filter out non-concert events
function isConcertEvent(title, description = '') {
    const fullText = `${title} ${description}`.toLowerCase();
    
    // Exclude non-concert events
    const excludePatterns = [
        'bingo', 'trivia', 'karaoke', 'open mic', 'comedy',
        'private event', 'wedding', 'birthday', 'meeting',
        'conference', 'workshop', 'class', 'lesson',
        'food', 'dinner', 'lunch', 'brunch'
    ];
    
    return !excludePatterns.some(pattern => fullText.includes(pattern));
}

/**
 * Main crawler logic
 */
await Actor.init();

console.log('Starting Continental Club Austin calendar scraper on: https://continentalclub.com/austin');

const crawler = new PlaywrightCrawler({
    launchContext: {
        launchOptions: {
            headless: true,
        },
    },
    requestHandler: async ({ page, request }) => {
        console.log(`Processing: ${request.url}`);

        try {
            // Wait for the page to load
            await page.waitForLoadState('networkidle');
            
            // Look for event containers - we'll need to inspect the actual site structure
            const events = await page.evaluate(() => {
                // This will need to be customized based on Continental Club's actual HTML structure
                // Placeholder selectors - will need to be updated after inspecting the site
                const eventElements = document.querySelectorAll('.event, .show, .calendar-event, [class*="event"], [class*="show"]');
                
                return Array.from(eventElements).map(element => {
                    // Extract basic event information
                    const titleElement = element.querySelector('h1, h2, h3, h4, .title, .event-title, .show-title, [class*="title"]');
                    const dateElement = element.querySelector('.date, .event-date, .show-date, [class*="date"], time');
                    const timeElement = element.querySelector('.time, .event-time, .show-time, [class*="time"]');
                    const descElement = element.querySelector('.description, .event-description, .show-description, [class*="description"], p');
                    const linkElement = element.querySelector('a[href*="ticket"], a[href*="event"], .ticket-link, .event-link');
                    const imageElement = element.querySelector('img');
                    
                    return {
                        title: titleElement?.textContent?.trim() || '',
                        date: dateElement?.textContent?.trim() || dateElement?.getAttribute('datetime') || '',
                        time: timeElement?.textContent?.trim() || '',
                        description: descElement?.textContent?.trim() || '',
                        ticketUrl: linkElement?.href || '',
                        imageUrl: imageElement?.src || '',
                        rawHtml: element.innerHTML
                    };
                }).filter(event => event.title); // Only include events with titles
            });

            console.log(`Found ${events.length} potential events`);

            // Process each event
            for (const eventData of events) {
                // Filter out non-concert events
                if (!isConcertEvent(eventData.title, eventData.description)) {
                    console.log(`Skipping non-concert event: ${eventData.title}`);
                    continue;
                }

                // Parse artist information from title and description
                const artistCandidates = [
                    ...parseContinentalArtists(eventData.title),
                    ...parseContinentalArtists(eventData.description)
                ];

                // Remove duplicates and get primary artist
                const uniqueArtists = [...new Set(artistCandidates)];
                const primaryArtist = uniqueArtists[0] || '';

                // Create event record
                const record = createEventRecord({
                    ...eventData,
                    artist: primaryArtist,
                    genres: [], // Continental Club specific genre detection can be added
                });

                // Only save events with artist information
                if (record.artist) {
                    await Actor.pushData(record);
                    console.log(`Saved event: ${record.title} by ${record.artist}`);
                } else {
                    console.log(`Skipping event without clear artist: ${eventData.title}`);
                }
            }

        } catch (error) {
            console.error(`Error processing ${request.url}:`, error);
        }
    },
});

// Start crawling from Continental Club Austin calendar
await crawler.run(['https://continentalclub.com/austin']);

await Actor.exit();