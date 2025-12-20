import { Actor } from 'apify';
import { log } from 'crawlee';

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
const DEFAULT_URL = 'https://hautespot.live/calendar';
const BASE_HOST = 'https://hautespot.live';
const VENUE_NAME = 'Haute Spot';
const TIME_ZONE = 'America/Chicago';
const PAST_THRESHOLD_MS = 24 * 60 * 60 * 1000; // deprecated; monthStart filter supersedes

const strip = (text = '') => text.replace(/\s+/g, ' ').trim();

function htmlToText(html = '') {
    if (!html) return '';
    const normalized = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<li>/gi, '\n')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/<[^>]*>/g, ' ');
    return strip(normalized.replace(/\n\s*\n+/g, '\n'));
}

function formatDate(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleString('en-US', {
        timeZone: TIME_ZONE,
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    });
}

function normalizeTime(text) {
    if (!text) return '';
    const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (!match) return strip(text);
    const [, hour, minutes = '00', meridiem] = match;
    return `${Number(hour)}:${minutes.padStart(2, '0')} ${meridiem.toUpperCase()}`;
}

function formatTime(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleTimeString('en-US', {
        timeZone: TIME_ZONE,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function extractDoorsTime(text) {
    const match = text.match(/doors?\s*(?:open\s*)?(?:at\s*)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    return match ? normalizeTime(match[1]) : '';
}

function extractPrice(text) {
    const priceMatch = text.match(/\$\d+(?:\.\d{2})?/);
    if (priceMatch) return priceMatch[0];
    const freeMatch = text.match(/\bfree\b/i);
    return freeMatch ? 'Free' : '';
}

function extractSupportActs(text) {
    const supports = new Set();
    const lines = text.split(/\n+/).map(strip).filter(Boolean);
    const patterns = [
        /with support(?:\s+from)?[:\-]?\s*(.+)/i,
        /support[:\-]?\s*(.+)/i,
    ];

    const pushActs = (fragment = '') => {
        let cleaned = strip(fragment.replace(/\*.*$/, ''));
        cleaned = cleaned.split(/(?:EVENT DETAILS|SHOW DATE:|DATE:|TIME:|DOORS?:|LOCATION:|HEADLINER:|TICKETS?:)/i)[0];
        cleaned = strip(cleaned);
        cleaned = cleaned.replace(/^from\s+/i, '');
        if (!cleaned || /^(tba|tbd|none|n\/a)$/i.test(cleaned)) return;
        cleaned
            .split(/\s+\+\s+|\s+\|\s+|\s*[,;]\s*/)
            .map(strip)
            .filter(Boolean)
            .forEach((name) => {
                supports.add(name.replace(/^and\s+/i, '').trim());
            });
    };

    for (const line of lines) {
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match && match[1]) pushActs(match[1]);
        }
    }

    return [...supports];
}

function buildJsonUrl(baseUrl, offset) {
    const url = new URL(baseUrl || DEFAULT_URL);
    url.searchParams.set('format', 'json');
    if (offset) url.searchParams.set('offset', offset);
    return url.toString();
}

function buildRecords(item) {
    const eventURL = new URL(item.fullUrl || '', BASE_HOST).toString();
    const bodyText = htmlToText(item.body || '');
    const description = htmlToText(item.excerpt || '');
    const eventDate = formatDate(item.startDate || item.structuredContent?.startDate);
    const eventTime = formatTime(item.startDate || item.structuredContent?.startDate);
    const doorsTime = extractDoorsTime(bodyText);
    const price = extractPrice(bodyText);
    const supportActs = extractSupportActs(bodyText);
    const headliner = strip((item.title || '').replace(/\sat\s+haute\s+spot.*$/i, '')) || VENUE_NAME;
    const scrapedAt = new Date().toISOString();

    const records = [{
        artist: headliner,
        role: 'headliner',
        eventDate,
        eventTime,
        doorsTime,
        venue: VENUE_NAME,
        eventURL,
        price,
        description,
        scrapedAt,
    }];

    for (const support of supportActs) {
        if (support.toLowerCase() === headliner.toLowerCase()) continue;
        records.push({
            artist: support,
            role: 'support',
            eventDate,
            eventTime,
            doorsTime,
            venue: VENUE_NAME,
            eventURL,
            price,
            description,
            scrapedAt,
        });
    }

    return records;
}

async function fetchJson(url) {
    const headers = { 'user-agent': 'Mozilla/5.0 (compatible; calendar-crawler/1.0)' };
    const maxAttempts = 4;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error(`Request failed ${res.status}`);
            return await res.json();
        } catch (err) {
            lastError = err;
            const isFinal = attempt === maxAttempts;
            const backoff = 500 * attempt;
            log.warning(`Fetch attempt ${attempt}/${maxAttempts} failed for ${url}: ${err.message}${isFinal ? '' : ` (retrying in ${backoff}ms)`}`);
            if (isFinal) break;
            await Actor.sleep(backoff);
        }
    }
    throw new Error(`Failed to fetch ${url}: ${lastError?.message || 'unknown error'}`);
}

Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const {
        startUrl = DEFAULT_URL,
        maxEvents = 200,
        maxPages = 5,
    } = input;

    const records = [];
    let offset;
    let page = 0;
    let eventCount = 0;
    const now = Date.now();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();

    log.info('Starting Haute Spot scraper...');

    pageLoop: while (true) {
        if (maxPages > 0 && page >= maxPages) {
            log.info(`Reached maxPages (${maxPages}), stopping pagination.`);
            break;
        }

        const jsonUrl = buildJsonUrl(startUrl, offset);
        log.info(`Fetching ${jsonUrl}`);
        const data = await fetchJson(jsonUrl);
        page += 1;

        const pageItems = [
            ...(data.upcoming || []),
            ...(data.past || []),
        ];

        const windowItems = pageItems.filter((item) => (item.startDate || 0) >= monthStartMs);
        const isAllPastOlder = windowItems.length === 0 && (data.upcoming || []).length === 0;
        if (isAllPastOlder) {
            log.info('No events in current-month window on this page, ending crawl.');
            break;
        }

        for (const item of windowItems) {
            if (maxEvents > 0 && eventCount >= maxEvents) {
                log.info(`Reached maxEvents (${maxEvents}), stopping.`);
                break pageLoop;
            }

            const eventRecords = buildRecords(item);
            records.push(...eventRecords);
            eventCount += 1;
        }

        if (!data.pagination?.nextPage) break;
        offset = data.pagination.nextPageOffset;
    }

    const deduped = [];
    const seen = new Set();
    for (const r of records) {
        const key = r.artist.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(r);
    }

    if (deduped.length) {
        await Actor.pushData(deduped);
        log.info(`Finished. Events processed: ${eventCount}. Artist rows saved: ${deduped.length} (deduped from ${records.length}).`);
    } else {
        log.warning('No records scraped.');
    }
});
