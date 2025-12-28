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
    const pushOne = async (item) => {
        const artistName = (item?.artistName ?? item?.artist ?? '').trim();
        const venueName = (item?.venueName ?? item?.venue ?? '').trim();
        const eventTitle = (item?.eventTitle ?? item?.title ?? item?.name ?? item?.event ?? item?.artist ?? '').trim();
        const eventURL = (item?.eventURL ?? item?.url ?? '').trim();
        const description = (item?.description ?? '').toString().trim();
        const role = (item?.role ?? 'headliner') || 'headliner';
        const eventDateRaw = item?.eventDate ?? item?.eventDateText ?? item?.date ?? item?.startDate ?? item?.start_time ?? item?.dateAttr ?? item?.eventDateStr ?? item?.event_date;
        const eventDate = formatEventDateValue(eventDateRaw);
        const normalized = {
            venueName,
            artistName,
            role,
            eventTitle,
            eventURL,
            eventDate,
            description,
            scrapedAt: item?.scrapedAt || new Date().toISOString(),
        };
        return originalPushData(normalized);
    };

    if (Array.isArray(record)) {
        for (const item of record) await pushOne(item);
        return;
    }

    return pushOne(record);
};
function strip(text = '') {
    return text.replace(/\s+/g, ' ').trim();
}

function monthIndex(name) {
    const m = name?.slice(0, 3).toLowerCase();
    return {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    }[m] ?? null;
}

function parseDateFromText(text) {
    if (!text) return '';
    const re = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)?\s*,?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?/i;
    const m = text.match(re);
    if (!m) return '';
    const now = new Date();
    const year = m[4] ? Number(m[4]) : now.getFullYear();
    const month = monthIndex(m[2]);
    const day = Number(m[3]);
    if (month == null || !day) return '';
    const d = new Date(year, month, day);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function parseTimesFromText(text) {
    if (!text) return { showTime: '', doorsTime: '' };
    const doors = (text.match(/doors\s*[:\-]?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i) || [])[1] || '';
    const show = (text.match(/show\s*[:\-]?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i) || [])[1] || '';
    // fallback: first time-like occurrence
    const any = (text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i) || []).slice(1);
    const first = any.length ? `${any[0]}:${any[1] || '00'} ${any[2]}`.replace(/::/, ':') : '';
    return { showTime: (show || first).toLowerCase(), doorsTime: doors.toLowerCase() };
}

function splitArtists(raw) {
    if (!raw) return [];
    let t = raw;
    // Remove common boilerplate prefixes and suffixes
    t = t.replace(/^\s*(?:mohawk(?:\s+austin)?\s+)?presents\b[:\-]?\s*/i, '');
    t = t.replace(/^\s*(?:resound\s+presents)\b[:\-]?\s*/i, '');
    t = t.replace(/\bat\s+mohawk(?:\s+austin)?.*$/i, '');
    t = t.replace(/\bexpired\b/ig, '');
    t = t.replace(/\bsold\s*out\b/ig, '');
    t = t.replace(/\bget\s+tickets\b/ig, '');
    t = t.replace(/:\s*[^-–—]+(tour|festival|night)[:\s].*/i, '');
    t = t.replace(/\[[^\]]+\]/g, '');
    t = t.replace(/\([^\)]+\)/g, '');
    // split by common separators
    const parts = t
        .split(/\bw\/\.\?\s*|\bwith\b\s*|\+\s*|,\s*/i)
        .map(s => strip(s))
        .filter(Boolean);
    return [...new Set(parts)];
}

function parseArtists({ title, subtitle, pageText }) {
    const fromTitle = splitArtists(title || '');
    const fromSubtitle = splitArtists(subtitle || '');
    const supportMatch = (pageText.match(/support(?:\s*by|:)?\s*([\w\s,&+\-/'!.]+)/i) || [])[1] || '';
    const fromSupport = splitArtists(supportMatch);
    const all = [...fromTitle, ...fromSubtitle, ...fromSupport].filter(Boolean);
    if (all.length === 0 && title) return [strip(title)];
    return [...new Set(all)];
}

function isNonConcert(text) {
    const keywords = [
        'bingo', 'trivia', 'karaoke', 'market', 'yoga', 'comedy', 'movie', 'screening', 'brunch', 'vendor', 'workshop'
    ];
    const t = (text || '').toLowerCase();
    return keywords.some(k => t.includes(k));
}

function isLikelyArtist(name) {
    if (!name) return false;
    const s = name.trim();
    if (s.length < 2 || s.length > 80) return false;
    const lower = s.toLowerCase();
    // Strict banned phrases (full match or contains)
    const strictBanned = ['mohawk', 'mohawk austin', 'tickets', 'sold out', 'expired', 'all ages', 'doors:', 'show:', 'get tickets', 'buy tickets'];
    if (strictBanned.some(w => lower === w || lower.includes(w))) return false;
    // Keyword fragments that indicate non-artist text
    if (/^(and|or|the|a|an)\s+(hope|individuals|ages|benefit|to|for|from|with|at)\b/i.test(s)) return false;
    if (/\b(support|presents|presented by|sponsored by)\s+by\b/i.test(s)) return false;
    if (/[\w]+\.(com|net|org|io)/i.test(s)) return false;
    if (/@/.test(s) && !/[A-Za-z]/.test(s.split('@')[0])) return false; // allow band names with @
    // Avoid standalone venue/stage names
    if (/^(outdoor|indoor|stage|main stage|patio|rooftop)$/i.test(s)) return false;
    return true;
}

function parsePrekindleJsonp(body = '') {
    const trimmed = body.trim();
    const prefix = 'callback(';
    if (!trimmed.startsWith(prefix) || !trimmed.endsWith(')')) {
        throw new Error('Unexpected response format from Prekindle');
    }
    const jsonText = trimmed.slice(prefix.length, -1);
    return JSON.parse(jsonText);
}

function normalizeVenueName(venueRaw = '') {
    const lower = venueRaw.toLowerCase();
    if (lower.includes('indoor')) return 'Mohawk - Inside';
    if (lower.includes('outdoor')) return 'Mohawk - Outside';
    return 'Mohawk Austin';
}

function sanitizeDescription(html = '') {
    const withoutTags = html.replace(/<[^>]*>/g, ' ');
    return strip(
        withoutTags
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/g, '\'')
            .replace(/&ndash;/gi, '-')
            .replace(/&mdash;/gi, '-')
    );
}

function buildEventDateValue({ date, time, doorsTime }) {
    const datePart = strip(date);
    const timePart = strip(time || doorsTime);
    if (datePart && timePart) {
        const combined = new Date(`${datePart} ${timePart}`);
        if (!Number.isNaN(combined.getTime())) return combined;
    }
    if (datePart) {
        const justDate = new Date(datePart);
        if (!Number.isNaN(justDate.getTime())) return justDate;
    }
    return `${datePart} ${timePart}`.trim();
}

function buildEventUrl(base, id) {
    if (!id) return base;
    try {
        return new URL(`/event/?id=${id}`, base).href;
    } catch {
        return base;
    }
}

function extractArtistsFromEvent(event) {
    const lineup = Array.isArray(event?.lineup) ? event.lineup : [];
    const candidates = [
        ...lineup,
        ...splitArtists(event?.headliner || ''),
        ...splitArtists(event?.support || ''),
        ...splitArtists(event?.title || ''),
    ];
    const unique = [...new Set(candidates.map(strip))].filter(Boolean).filter(isLikelyArtist);
    if (unique.length) return unique;
    const fallback = strip(event?.title || '');
    return fallback ? [fallback] : [];
}

console.log('Starting Mohawk Austin scraper (Prekindle API)...');
await Actor.init();

const input = await Actor.getInput() || {};
const startUrl = input.startUrl || 'https://mohawkaustin.com/';
const maxEvents = Number(input.maxEvents) || 500;

let pushedCount = 0;
const pushedKeys = new Set();
const prekindleUrl = 'https://www.prekindle.com/api/events/organizer/531433527670566235';

const response = await fetch(prekindleUrl);
if (!response.ok) {
    throw new Error(`Failed to load Prekindle data: ${response.status} ${response.statusText}`);
}

const payload = parsePrekindleJsonp(await response.text());
const events = payload?.events || [];

for (const event of events) {
    if (maxEvents > 0 && pushedCount >= maxEvents) break;
    const venueName = normalizeVenueName(event?.venue);
    const eventURL = buildEventUrl(startUrl, event?.id);
    const eventTitle = strip(event?.headliner || event?.title || '');
    const eventDateValue = buildEventDateValue({ date: event?.date, time: event?.time, doorsTime: event?.doorsTime });
    const eventDate = formatEventDateValue(eventDateValue) || strip(`${event?.date || ''} ${event?.time || ''}`);
    const descriptionParts = [sanitizeDescription(event?.description || ''), strip(event?.support || '')].filter(Boolean);
    const description = [...new Set(descriptionParts)].join(' | ');

    const artists = extractArtistsFromEvent(event);
    if (!artists.length) continue;

    for (let i = 0; i < artists.length; i++) {
        if (maxEvents > 0 && pushedCount >= maxEvents) break;
        const artistName = artists[i];
        const role = i === 0 ? 'headliner' : 'support';
        const dedupeKey = `${(event?.id || eventTitle || '').toLowerCase()}__${artistName.toLowerCase()}`;
        if (pushedKeys.has(dedupeKey)) continue;
        pushedKeys.add(dedupeKey);
        pushedCount += 1;

        await Actor.pushData({
            venueName,
            artistName,
            role,
            eventTitle,
            eventURL,
            eventDate,
            description,
            scrapedAt: new Date().toISOString(),
        });
    }
}

console.log(`Mohawk scraper finished. Pushed ${pushedCount} items.`);
await Actor.exit();
