/**
 * Shared utilities for calendar crawler actors
 */

/**
 * Non-concert event keywords for filtering
 */
export const NON_CONCERT_KEYWORDS = [
    'bingo',
    'rock and roll bingo',
    'trivia',
    'karaoke',
    'open mic',
    'open-mic',
    'market',
    'farmers market',
    'brunch',
    'yoga',
    'workshop',
    'class',
    'book signing',
    'pop up',
    'pop-up',
    'paint night',
    'dance party',
    'dance',
    'dinner',
    'mixer',
    'meetup',
    'meet-up',
    'fundraiser',
    'fund raiser',
    'silent auction',
    'auction',
    'craft fair',
    'bazaar',
    'expo',
    'conference',
    'festival',
    'movie night',
    'film screening',
    'screening',
    'lecture',
    'reading',
    'panel',
    'networking',
    'open house',
    'sound bath',
    'fitness',
    'wellness',
    'charity',
    'vendor',
    'vendors',
    'crafts',
    'bake sale'
];

/**
 * Check if an event should be filtered out as non-concert
 * @param {string} eventTitle - Event title
 * @param {string} pageText - Full page text
 * @param {string[]} artistLines - Parsed artist lines
 * @param {string[]} customKeywords - Additional keywords to check
 * @returns {boolean} - True if event should be skipped
 */
export function isNonConcertEvent(eventTitle, pageText, artistLines = [], customKeywords = []) {
    const allKeywords = [...NON_CONCERT_KEYWORDS, ...customKeywords];
    const combinedText = `${eventTitle} ${pageText} ${artistLines.join(' ')}`.toLowerCase();
    
    return allKeywords.some((keyword) => combinedText.includes(keyword));
}

/**
 * Create a standardized event record
 * @param {Object} params - Record parameters
 * @returns {Object} - Standardized event record
 */
export function createEventRecord({
    source,
    eventUrl,
    eventTitle,
    eventDateText,
    showTime,
    doorsTime,
    priceText,
    venueName,
    market,
    artistName,
    role
}) {
    return {
        source,
        eventUrl,
        eventTitle,
        eventDateText,
        showTime: showTime || '',
        doorsTime: doorsTime || '',
        priceText: priceText || '',
        venueName: venueName || '',
        market,
        artistName,
        role,
        scrapedAt: new Date().toISOString()
    };
}

/**
 * Clean artist lines by removing common non-artist text
 * @param {string[]} artistLines - Raw artist lines
 * @returns {string[]} - Cleaned artist lines
 */
export function cleanArtistLines(artistLines) {
    return artistLines.filter((line) => {
        const lower = line.toLowerCase();
        if (lower.includes('all ages')) return false;
        if (lower.includes('show:')) return false;
        if (lower.includes('doors:')) return false;
        if (lower.includes('day of')) return false;
        if (lower.includes('comandtakeitproductions.com')) return false;
        if (lower.startsWith('tickets')) return false;
        return line.length > 0;
    });
}

/**
 * Extract time from a line that starts with a label (e.g., "Show: 7 pm")
 * @param {string} line - The line to extract time from
 * @param {string} label - The label to remove (e.g., "show")
 * @returns {string} - Extracted time
 */
export function extractTime(line, label) {
    if (!line) return '';
    return line.replace(new RegExp(`^${label}:\\s*`, 'i'), '').trim();
}

/**
 * Market configurations for different cities
 */
export const MARKETS = {
    AUSTIN: 'Austin, TX',
    DALLAS: 'Dallas, TX',
    HOUSTON: 'Houston, TX',
    SAN_ANTONIO: 'San Antonio, TX'
};