import { Actor } from 'apify';

const API_URL = 'https://timelyapp.time.ly/api/calendars/54714987/events';
const API_KEY = 'c6e5e0363b5925b28552de8805464c66f25ba0ce';
const VENUE_ID = '678194628'; // Austin location
const TIMEZONE = 'America/Chicago';

function stripHtml(text = '') {
    return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString.replace(' ', 'T') + 'Z');
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString.replace(' ', 'T') + 'Z');
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).toLowerCase();
}

function normalizePrice(event) {
    if (event.cost) {
        return stripHtml(event.cost).replace('&#036;', '$').trim();
    }
    const costDisplay = event.cost_display;
    if (costDisplay && costDisplay !== '0') {
        return costDisplay.startsWith('$') ? costDisplay : `$${costDisplay}`;
    }
    return '';
}

function createEventRecord(event) {
    const venueName = event.taxonomies?.taxonomy_venue?.[0]?.title || 'Continental Club';
    return {
        artist: event.title || '',
        eventDate: formatDate(event.start_datetime),
        eventTime: formatTime(event.start_datetime),
        venue: venueName,
        eventUrl: event.url || event.canonical_url || '',
        description: stripHtml(event.description_short || ''),
        price: normalizePrice(event),
        scrapedAt: new Date().toISOString(),
    };
}

function formatDateParam(date) {
    return date.toISOString().split('T')[0];
}

async function fetchEvents({ daysAhead, maxEvents }) {
    const events = [];
    let page = 1;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + daysAhead);

    while (true) {
        const params = new URLSearchParams({
            group_by_date: '1',
            venues: VENUE_ID,
            timezone: TIMEZONE,
            view: 'month',
            start_datetime: formatDateParam(start),
            end_datetime: formatDateParam(end),
            per_page: '500',
            page: String(page),
        });

        const response = await fetch(`${API_URL}?${params.toString()}`, {
            headers: {
                'x-api-key': API_KEY,
                accept: 'application/json, text/plain, */*',
                referer: 'https://events.timely.fun/',
            },
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const payload = await response.json();
        const grouped = payload.data?.items || {};

        for (const day of Object.keys(grouped)) {
            for (const event of grouped[day]) {
                events.push(createEventRecord(event));
                if (maxEvents > 0 && events.length >= maxEvents) {
                    return events;
                }
            }
        }

        if (!payload.data?.has_next || (maxEvents > 0 && events.length >= maxEvents)) {
            break;
        }
        page += 1;
    }

    return events;
}

console.log('Starting Continental Club calendar scraper via Timely API...');

await Actor.init();

const input = await Actor.getInput() || {};
const {
    daysAhead = 90,
    maxEvents = 300,
} = input;

try {
    const events = await fetchEvents({ daysAhead, maxEvents });

    if (events.length === 0) {
        console.warn('No events returned from Timely API');
    } else {
        console.log(`Fetched ${events.length} events from Continental Club`);
    }

    for (const event of events) {
        await Actor.pushData(event);
    }
} catch (error) {
    console.error('Failed to fetch Continental Club events:', error);
    throw error;
}

console.log('Continental Club calendar scraper finished!');

await Actor.exit();
