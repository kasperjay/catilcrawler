import { Actor } from 'apify';

// Ensure uniform artistName + eventDate formatting across outputs
const originalPushData = Actor.pushData.bind(Actor);

function formatEventDateValue(value) {
    if (value === undefined || value === null) return '';
    let date;
    if (value instanceof Date) {
        date = value;
    } else if (typeof value === 'number') {
        date = new Date(value);
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return '';
        const parsed = Date.parse(trimmed.replace(' ', 'T'));
        if (!Number.isNaN(parsed)) {
            date = new Date(parsed);
        }
    }
    if (!date || Number.isNaN(date.getTime())) {
        return typeof value === 'string' ? value.trim() : '';
    }
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: '2-digit',
        year: 'numeric',
    });
}

Actor.pushData = async (record) => {
    const artistName = (record?.artistName ?? record?.artist ?? '').trim();
    const eventDateRaw = record?.eventDate ?? record?.eventDateText ?? record?.date ?? record?.startDate ?? record?.start_time ?? record?.dateAttr ?? record?.eventDateStr ?? record?.event_date;
    const eventDate = formatEventDateValue(eventDateRaw);
    const venueNameRaw = record?.venueName ?? record?.venue ?? "";
    const venueName = typeof venueNameRaw === "string" ? venueNameRaw.trim() : venueNameRaw;
    const output = { ...record, artistName, eventDate, venueName };
    return originalPushData(output);
};
// Timely API settings (shared with Continental Club; venue ID targets The Gallery)
const API_URL = 'https://timelyapp.time.ly/api/calendars/54714987/events';
const API_KEY = 'c6e5e0363b5925b28552de8805464c66f25ba0ce';
const VENUE_ID = '678194627'; // The Continental Gallery
const TIMEZONE = 'America/Chicago';

function decodeHtmlEntities(text = '') {
    const map = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#039;': "'",
        '&hellip;': '…',
        '&nbsp;': ' '
    };
    return text.replace(/(&amp;|&lt;|&gt;|&quot;|&#039;|&hellip;|&nbsp;)/g, (m) => map[m] || m);
}

function stripHtml(text = '') {
    return decodeHtmlEntities(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
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
    const raw = event.cost || event.cost_display || '';
    if (!raw || raw === '0') return '';
    let text = stripHtml(raw).replace(/&#036;/g, '$');
    text = text.replace(/@\d{1,2}(?:[:\d]{0,3})?(?:am|pm)/gi, '').trim();
    text = text.replace(/\s+([.,])/g, '$1');
    return text;
}

function createEventRecord(event, overrides = {}) {
    const venueName = 'The Continental Gallery';
    const base = {
        artist: event.title || '',
        eventDate: formatDate(event.start_datetime),
        eventTime: formatTime(event.start_datetime),
        venue: venueName,
        eventUrl: event.url || event.canonical_url || '',
        description: stripHtml(event.description_short || ''),
        price: normalizePrice(event),
        scrapedAt: new Date().toISOString(),
    };
    return { ...base, ...overrides, artist: (overrides.artist || base.artist).trim() };
}

function normalizeInlineTime(fragment) {
    if (!fragment) return '';
    const m = fragment.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
    if (!m) return '';
    const hour = m[1];
    const minutes = m[2] || '00';
    const suffix = m[3].toLowerCase();
    return `${hour}:${minutes} ${suffix}`;
}

function formatTimeGuess(raw) {
    if (!raw) return '';
    const cleaned = raw.toLowerCase().replace(/\s+/g, '');
    return normalizeInlineTime(cleaned);
}

function splitMultiArtistTitle(title) {
    if (!title) return [];
    const hasMultipleAt = (title.match(/@\d{1,2}/g) || []).length > 1;
    if (!hasMultipleAt) return [];
    const segments = title.split(',').map(s => s.trim()).filter(Boolean);
    const results = [];
    for (const seg of segments) {
        const match = seg.match(/^(.*?)(?:\s*@\s*(\d{1,2}(?::\d{2})?(?:am|pm)))/i);
        if (match) {
            const artistName = match[1].trim();
            const timeFragment = normalizeInlineTime(match[2].replace(/\s+/g, '')) || formatTimeGuess(match[2]);
            results.push({ artist: artistName, eventTime: timeFragment });
        }
    }
    return results;
}

function formatDateParam(date) {
    return date.toISOString().split('T')[0];
}

function dedupeByArtist(records) {
    const byArtist = new Map();
    for (const r of records) {
        const key = r.artist.toLowerCase();
        if (!byArtist.has(key)) {
            byArtist.set(key, r);
        }
    }
    return [...byArtist.values()];
}

async function fetchEvents({ daysAhead, maxEvents }) {
    const events = [];
    let page = 1;
    // Start from the first day of the current month so we include earlier dates when run mid-month
    const start = new Date();
    start.setDate(1);
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
                const record = createEventRecord(event);
                const splits = splitMultiArtistTitle(record.artist);
                if (splits.length) {
                    for (const s of splits) {
                        events.push(createEventRecord(event, { artist: s.artist, eventTime: s.eventTime || record.eventTime }));
                        if (maxEvents > 0 && events.length >= maxEvents) return events;
                    }
                } else {
                    events.push(record);
                }
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

console.log('Starting Continental Gallery calendar scraper via Timely API...');

await Actor.init();

const input = await Actor.getInput() || {};
const {
    daysAhead = 120,
    maxEvents = 400,
} = input;

try {
    const events = await fetchEvents({ daysAhead, maxEvents });
    const deduped = dedupeByArtist(events);

    if (deduped.length === 0) {
        console.warn('No events returned from Timely API');
    } else {
        console.log(`Fetched ${deduped.length} unique artists (from ${events.length} rows).`);
    }

    for (const event of deduped) {
        await Actor.pushData(event);
    }
} catch (error) {
    console.error('Failed to fetch Continental Gallery events:', error);
    throw error;
}

console.log('Continental Gallery calendar scraper finished!');

await Actor.exit();
