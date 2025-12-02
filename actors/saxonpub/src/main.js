import { Actor } from 'apify';

const API_URL = 'https://thesaxonpub.com/wp-json/tribe/events/v1/events';

function formatDateForDisplay(dateString) {
    if (!dateString) return '';
    const [datePart] = dateString.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    if (!year || !month || !day) return '';
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTimeForDisplay(dateString) {
    if (!dateString) return '';
    const [, timePart] = dateString.split(' ');
    if (!timePart) return '';
    const [hourStr, minute] = timePart.split(':');
    const hour = Number(hourStr);
    if (Number.isNaN(hour) || Number.isNaN(Number(minute))) return '';
    const hour12 = (hour % 12) || 12;
    const ampm = hour >= 12 ? 'pm' : 'am';
    return `${hour12}:${minute} ${ampm}`;
}

function stripHtml(text = '') {
    return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizePrice(event) {
    if (event.cost) {
        return stripHtml(event.cost).replace('&#036;', '$').trim();
    }
    const values = event.cost_details?.values;
    if (Array.isArray(values) && values.length > 0) {
        return `$${values[0]}`;
    }
    return '';
}

function createEventRecord(event) {
    return {
        artist: event.title || '',
        eventDate: formatDateForDisplay(event.start_date),
        eventTime: formatTimeForDisplay(event.start_date),
        venue: event.venue?.venue || 'Saxon Pub',
        eventUrl: event.url || '',
        description: stripHtml(event.description || event.excerpt || ''),
        price: normalizePrice(event),
        scrapedAt: new Date().toISOString(),
    };
}

function buildDateParam(date, endOfDay = false) {
    const pad = (val) => String(val).padStart(2, '0');
    const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return `${base} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

async function fetchEvents(maxEvents) {
    const events = [];
    const seenIds = new Set();

    const now = new Date();
    const startDate = buildDateParam(now);
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);
    const endDate = buildDateParam(end, true);

    let page = 1;
    let nextUrl = `${API_URL}?${new URLSearchParams({
        per_page: '50',
        page: String(page),
        start_date: startDate,
        end_date: endDate,
        status: 'publish',
    }).toString()}`;

    while (nextUrl && (maxEvents <= 0 || events.length < maxEvents)) {
        const response = await fetch(nextUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch events: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const pageEvents = Array.isArray(data.events) ? data.events : [];

        for (const event of pageEvents) {
            if (seenIds.has(event.id)) continue;
            events.push(createEventRecord(event));
            seenIds.add(event.id);
            if (maxEvents > 0 && events.length >= maxEvents) break;
        }

        nextUrl = (data.next_rest_url && (!maxEvents || events.length < maxEvents))
            ? data.next_rest_url
            : null;
    }

    return events;
}

console.log('Starting Saxon Pub calendar scraper using Events API...');

await Actor.init();

const input = await Actor.getInput() || {};
const { maxEvents = 100 } = input;

try {
    const events = await fetchEvents(maxEvents);

    if (events.length === 0) {
        console.warn('No events returned from API');
    } else {
        console.log(`Fetched ${events.length} events from Saxon Pub API`);
    }

    for (const event of events) {
        await Actor.pushData(event);
    }
} catch (error) {
    console.error('Failed to fetch Saxon Pub events:', error);
    throw error;
}

console.log('Saxon Pub calendar scraper finished!');

await Actor.exit();
