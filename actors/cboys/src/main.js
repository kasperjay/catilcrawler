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
    const output = { ...record, artistName, eventDate };
    return originalPushData(output);
};
const API_URL = 'https://timelyapp.time.ly/api/calendars/54714969/events';
const API_KEY = 'c6e5e0363b5925b28552de8805464c66f25ba0ce';
const VENUE_ID = '678194631';
const TIMEZONE = 'America/Chicago';
const NON_MUSIC_KEYWORDS = [
    'bingo',
    'trivia',
    'karaoke',
    'market',
    'brunch',
    'yoga',
    'happy hour',
    'watch party',
    'private party',
    'closed for a private party',
    'benefit',
    'fundraiser',
    'tribute'
];

function decodeHtmlEntities(text = '') {
    const map = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#039;': "'",
        '&hellip;': '…',
        '&nbsp;': ' ',
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

function formatDateParam(date) {
    return date.toISOString().split('T')[0];
}

function normalizePrice(event) {
    const raw = event.cost || event.cost_display || '';
    if (!raw || raw === '0') return '';
    let text = stripHtml(raw).replace(/&#036;/g, '$');
    text = text.replace(/@\d{1,2}(?::\d{2})?(?:am|pm)/gi, '').trim();
    text = text.replace(/\s+([.,])/g, '$1');
    return text;
}

function normalizeInlineTime(fragment = '') {
    const cleaned = fragment.toLowerCase().replace(/\s+/g, '').replace(/^@/, '');
    const m = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
    if (!m) return '';
    const hour = Number(m[1]);
    if (!hour || hour > 12) return '';
    const minutes = (m[2] || '00').padEnd(2, '0');
    return `${hour}:${minutes} ${m[3]}`;
}

function cleanArtistName(name = '') {
    let result = name.replace(/^in the jade room:\s*/i, '');
    result = result.replace(/^on the patio:\s*/i, '');
    result = result.replace(/^the jade room:\s*/i, '');
    result = result.replace(/\s*-\s*(buy tickets.*|tickets.*)$/i, '');
    result = result.replace(/\s*\b(buy tickets below!?)\b.*$/i, '');
    result = result.replace(/\s*\b(buy tickets)\b.*$/i, '');
    result = result.replace(/\s*\b(record release|album release|listening party)\b.*$/i, '');
    result = result.replace(/\bpresents\b[:\-\s]*/i, '');
    result = result.replace(/\bpresented by\b[:\-\s]*/i, '');
    result = result.replace(/\bhosted by\b[:\-\s]*/i, '');
    return result.trim();
}

function isValidArtist(name = '') {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 120) return false;
    const lower = trimmed.toLowerCase();
    const banned = ['tba', 'vip meet & greet', 'vip meet and greet', 'no cover', '21+ only', 'happy hour'];
    const bannedExactGenres = ['americana', 'blues', 'jazz', 'soul', 'funk', 'country', 'rock', 'reggae', 'latin', 'hip hop', 'r&b', 'rnb'];
    if (bannedExactGenres.includes(lower)) return false;
    return !banned.some((b) => lower.includes(b));
}

function isNonMusicEvent(event) {
    const combined = stripHtml(`${event.title || ''} ${event.description_short || ''} ${event.description || ''}`).toLowerCase();
    return NON_MUSIC_KEYWORDS.some((kw) => combined.includes(kw));
}

function parseArtistSegment(segment) {
    if (!segment) return null;
    let text = segment.replace(/\s+/g, ' ').trim();
    text = text.replace(/\s*-\s*(buy tickets.*|tickets.*)$/i, '').trim();

    const prefixMatch = text.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+/i);
    const suffixMatch = text.match(/@\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);

    let eventTime = '';
    if (prefixMatch) {
        eventTime = normalizeInlineTime(prefixMatch[1]);
        text = text.slice(prefixMatch[0].length).trim();
    }
    if (suffixMatch) {
        eventTime = normalizeInlineTime(suffixMatch[1]) || eventTime;
        text = text.replace(suffixMatch[0], '').trim();
    }

    text = text.replace(/^[\-–—:@\s]+/, '').trim();
    text = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
    text = cleanArtistName(text);

    if (!text) return null;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > 8) return null;

    const sentenceNoise = [
        /^we present/i,
        /^we\s+present/i,
        /^we\s+present\s+to\s+you/i,
        /^was formerly/i,
        /^an american/i,
        /^closed for/i,
        /^this (month|week)/i,
        /^born in/i,
        /premiere purveyors/i,
        /array of saxophones/i,
        /started out/i,
        /made it their/i,
        /as well as many/i,
        /harmonica/i,
        /superbad funk/i,
        /soul and funk/i,
        /colorado and texas/i,
        /\balaska\b/i,
        /\bthe bro/i
    ];
    if (text.includes('.')) return null;
    if (sentenceNoise.some((re) => re.test(text))) return null;
    return { artist: text, eventTime };
}

function dedupeArtistPairs(pairs) {
    const seen = new Set();
    const result = [];
    for (const pair of pairs) {
        const key = `${pair.artist.toLowerCase()}|${(pair.eventTime || '').toLowerCase()}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(pair);
        }
    }
    return result;
}

function extractArtistPairs(event) {
    // Rely primarily on the title; description was too noisy for this calendar
    const sources = event.title ? [event.title] : [];

    const pairs = [];
    for (const source of sources) {
        const segments = source
            .split(/[\n,;/]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        for (const seg of segments) {
            const parsed = parseArtistSegment(seg);
            if (parsed && isValidArtist(parsed.artist)) {
                pairs.push(parsed);
            }
        }
    }

    if (pairs.length === 0 && event.title) { 
        const fallback = cleanArtistName(event.title.trim());
        if (isValidArtist(fallback)) {
            pairs.push({ artist: fallback, eventTime: '' });
        }
    }

    return dedupeArtistPairs(pairs);
}

function createEventRecord(event, overrides = {}) {
    const venueName = event.taxonomies?.taxonomy_venue?.[0]?.title || "C-Boy's Heart & Soul";
    const base = {
        artist: event.title || '',
        eventDate: formatDate(event.start_datetime),
        eventTime: formatTime(event.start_datetime),
        venue: venueName,
        eventUrl: event.url || event.canonical_url || '',
        description: stripHtml(event.description_short || event.description || ''),
        price: normalizePrice(event),
        scrapedAt: new Date().toISOString(),
    };
    const record = { ...base, ...overrides };
    record.artist = (record.artist || '').trim();
    record.eventTime = (record.eventTime || base.eventTime || '').trim();
    return record;
}

// Dedupe by artist name only, keeping first occurrence (earliest in crawl order)
function dedupeRecords(records) {
    const seen = new Set();
    const result = [];
    for (const rec of records) {
        const key = rec.artist.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(rec);
        }
    }
    return result;
}

async function fetchEvents({ daysAhead, maxEvents }) {
    const records = [];
    let page = 1;
    // Start from the first day of the current month so mid-month runs include earlier dates
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
                if (isNonMusicEvent(event)) continue;

                const splits = extractArtistPairs(event);
                if (splits.length) {
                    for (const pair of splits) {
                        records.push(createEventRecord(event, {
                            artist: pair.artist,
                            eventTime: pair.eventTime || formatTime(event.start_datetime),
                        }));
                        if (maxEvents > 0 && records.length >= maxEvents) return records;
                    }
                } else {
                    records.push(createEventRecord(event));
                    if (maxEvents > 0 && records.length >= maxEvents) return records;
                }
            }
        }

        if (!payload.data?.has_next || (maxEvents > 0 && records.length >= maxEvents)) {
            break;
        }
        page += 1;
    }

    return records;
}

Actor.main(async () => {
    console.log("Starting C-Boy's Heart & Soul calendar scraper (Timely API)...");

    const input = await Actor.getInput() || {};
    const daysAhead = Number(input.daysAhead) || 120;
    const maxEvents = Number(input.maxEvents) || 500;

    const events = await fetchEvents({ daysAhead, maxEvents });
    const deduped = dedupeRecords(events);

    if (deduped.length === 0) {
        console.warn('No events returned from Timely API');
    } else {
        console.log(`Fetched ${events.length} raw event entries; ${deduped.length} after dedupe.`);
    }

    for (const event of deduped) {
        await Actor.pushData(event);
    }

    console.log("C-Boy's calendar scraper finished!");
});
