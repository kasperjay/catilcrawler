import { Actor } from 'apify';

const API_URL = 'https://partners-endpoint.dice.fm/api/v2/events';
const DEFAULT_VENUE = 'The Cut ATX';
const DEFAULT_API_KEY = 'C2JLpHUcdm629vcY5hZHN1dToisUF13BozvsXK57';
const TIME_ZONE = 'America/Chicago';
const VENUE_NAME = 'The Cut ATX';

const strip = (text = '') => text.replace(/\s+/g, ' ').trim();

function formatDate(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleDateString('en-US', {
        timeZone: TIME_ZONE,
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    });
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

function centsToPrice(ticketTypes = []) {
    const totals = ticketTypes
        .map(t => {
            if (t?.price) return Number(t.price.total);
            return Number(t?.total);
        })
        .filter(Number.isFinite);
    if (!totals.length) return '';
    const min = Math.min(...totals);
    return `$${(min / 100).toFixed(2)}`;
}

function normalizeAct(text = '') {
    return strip(text.replace(/^doors?.*/i, ''));
}

function extractLineup(ev, headliner) {
    const lineup = Array.isArray(ev.lineup) ? ev.lineup : [];
    const support = [];
    let doorsTime = '';

    for (const item of lineup) {
        if (/door/i.test(item?.details || '')) {
            doorsTime = item?.time || doorsTime;
        }
        const name = normalizeAct(item?.details || '');
        if (!name) continue;
        if (name.toLowerCase() === headliner.toLowerCase()) continue;
        support.push(name);
    }

    return { support: [...new Set(support)], doorsTime };
}

async function fetchEvents({ venueName, apiKey, pageSize, maxEvents }) {
    const records = [];
    let url = new URL(API_URL);
    url.searchParams.set('filter[venue]', venueName);
    url.searchParams.set('page[size]', String(pageSize));
    url.searchParams.set('types', 'linkout,event');

    const headers = { 'x-api-key': apiKey };

    while (url && (maxEvents === 0 || records.length < maxEvents)) {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`Request failed ${res.status} for ${url}`);
        const data = await res.json();

        for (const ev of data.data || []) {
            if (maxEvents > 0 && records.length >= maxEvents) break;

            const headliner = strip(ev.name || '');
            if (!headliner) continue;

            const eventDate = formatDate(ev.date);
            const eventTime = formatTime(ev.date);
            const description = strip(ev.description || ev.raw_description || '');
            const price = centsToPrice(ev.ticket_types);
            const eventUrl = ev.url || ev.links?.web || '';

            const { support, doorsTime } = extractLineup(ev, headliner);

            records.push({
                artist: headliner,
                role: 'headliner',
                eventDate,
                eventTime,
                doorsTime,
                venue: VENUE_NAME,
                eventUrl,
                price,
                description,
                scrapedAt: new Date().toISOString(),
            });

            for (const act of support) {
                records.push({
                    artist: act,
                    role: 'support',
                    eventDate,
                    eventTime,
                    doorsTime,
                    venue: VENUE_NAME,
                    eventUrl,
                    price,
                    description,
                    scrapedAt: new Date().toISOString(),
                });
            }
        }

        const next = data.links?.next;
        url = next ? new URL(next) : null;
    }

    return records;
}

Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const venueName = input.venueName || DEFAULT_VENUE;
    const apiKey = input.apiKey || DEFAULT_API_KEY;
    const pageSize = Number(input.pageSize) || 50;
    const maxEvents = Number(input.maxEvents) || 200;

    const records = await fetchEvents({ venueName, apiKey, pageSize, maxEvents });

    if (records.length === 0) {
        console.log('No records scraped.');
        return;
    }

    await Actor.pushData(records);
    console.log(`Finished. Saved ${records.length} artist rows from ${venueName}.`);
});
