import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

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
const VENUE = 'Broken Spoke';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const strip = (text = '') => text.replace(/\s+/g, ' ').trim();

function parseMonthIndex(fragment) {
    const m = fragment?.slice(0, 3).toLowerCase();
    return MONTHS.indexOf(m);
}

function toDateString(monthIdx, day, year) {
    if (monthIdx < 0 || day <= 0 || !year) return '';
    const d = new Date(year, monthIdx, day);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function parseTimeToken(token = '') {
    const m = token.match(/(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)?/i);
    if (!m) return '';
    const hour = m[1];
    const minutes = m[2] || '00';
    const meridiem = (m[3] || '').toLowerCase();
    if (meridiem === 'a' || meridiem === 'am') return `${hour}:${minutes.padStart(2, '0')} AM`;
    if (meridiem === 'p' || meridiem === 'pm') return `${hour}:${minutes.padStart(2, '0')} PM`;
    return `${hour}:${minutes.padStart(2, '0')}`;
}

function extractEventTime(line) {
    const m = line.match(/(\d{1,2}(?::\d{2})?\s*(?:a|p|am|pm))/i);
    return m ? parseTimeToken(m[1]) : '';
}

function cleanName(text = '') {
    let t = strip(text);
    t = t.replace(/(dancehall|restaurant).*$/i, '');
    t = t.replace(/\d.*$/g, '');
    t = t.replace(/\s+w\/$/i, '');
    t = t.replace(/\bband\b$/i, '').replace(/&$/g, '');
    t = t.replace(/[|]+$/g, '');
    return strip(t);
}

function isGenericName(name = '') {
    const n = name.toLowerCase();
    if (!n) return true;
    const banned = ['band', 'restaurant', 'dancehall', 'closed', 'tbd', 'tba'];
    if (banned.includes(n)) return true;
    if (n.length < 2) return true;
    return false;
}

function parseLine(line, currentYear) {
    const dateMatch = line.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z\.]*\s+(\d{1,2})(?:st|nd|rd|th)?/i);
    if (!dateMatch) return null;

    const monthIdx = parseMonthIndex(dateMatch[1]);
    const day = Number(dateMatch[2]);
    const eventDate = toDateString(monthIdx, day, currentYear || new Date().getFullYear());

    const afterDash = strip(line.split('-').slice(1).join('-'));
    const lower = afterDash.toLowerCase();
    if (!afterDash || lower.includes('closed')) return null;

    // Headliner: text before first connector or time
    const headlinerChunk = strip(afterDash.split(/(?:w\/|&)/i)[0] || afterDash);
    const headliner = cleanName(headlinerChunk);
    if (!headliner || isGenericName(headliner)) return null;

    // Support acts
    const support = [];
    const supportMatches = [...afterDash.matchAll(/(?:w\/|&)\s*([^&]+)/gi)];
    for (const m of supportMatches) {
        const name = cleanName(m[1]);
        if (name && !isGenericName(name) && name.toLowerCase() !== headliner.toLowerCase()) {
            support.push(name);
        }
    }

    const eventTime = extractEventTime(afterDash);
    const description = line;

    return {
        eventDate,
        eventTime,
        headliner,
        support: [...new Set(support)],
        description,
    };
}

function parseMonthHeader(line) {
    const m = line.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
    if (!m) return null;
    const monthIdx = parseMonthIndex(m[1]);
    const year = Number(m[2]);
    return { monthIdx, year };
}

Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const startUrl = input.startUrl || 'https://www.brokenspokeaustintx.net/events-calendar';
    const maxEvents = Number(input.maxEvents) || 300;
    const requestTimeoutSecs = Number(input.requestTimeoutSecs) || 120;

    const items = [];
    let currentYear = new Date().getFullYear();

    const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: requestTimeoutSecs,
        navigationTimeoutSecs: requestTimeoutSecs,
        launchContext: { launchOptions: { headless: true } },
        requestHandler: async ({ page }) => {
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: requestTimeoutSecs * 1000 });
            await page.waitForTimeout(6000);

            const bodyText = await page.evaluate(() => document.body.innerText || '');
            const lines = bodyText.split('\n').map(strip).filter(Boolean);

            for (const line of lines) {
                const header = parseMonthHeader(line);
                if (header) {
                    currentYear = header.year;
                    continue;
                }

                const event = parseLine(line, currentYear);
                if (!event) continue;
                if (maxEvents > 0 && items.filter(i => i.role === 'headliner').length >= maxEvents) break;

                items.push({
                    artist: event.headliner,
                    role: 'headliner',
                    eventDate: event.eventDate,
                    eventTime: event.eventTime,
                    venue: VENUE,
                    eventUrl: startUrl,
                    price: '',
                    description: event.description,
                    scrapedAt: new Date().toISOString(),
                });

                for (const act of event.support) {
                    items.push({
                        artist: act,
                        role: 'support',
                        eventDate: event.eventDate,
                        eventTime: event.eventTime,
                        venue: VENUE,
                        eventUrl: startUrl,
                        price: '',
                        description: event.description,
                        scrapedAt: new Date().toISOString(),
                    });
                }
            }
        },
    });

    await crawler.run([startUrl]);

    const deduped = [];
    const seen = new Set();
    for (const item of items) {
        const key = item.artist.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }

    if (deduped.length === 0) {
        log.warning('No events parsed.');
        return;
    }

    await Actor.pushData(deduped);
    log.info(`Saved ${deduped.length} unique artist rows from ${VENUE} (deduped from ${items.length}).`);
});
