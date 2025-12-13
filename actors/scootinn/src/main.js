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
        const eventURL = (item?.eventURL ?? item?.eventUrl ?? item?.url ?? '').trim();
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
const START_URL = 'https://www.scootinnaustin.com/shows';

const strip = (text = '') => text.replace(/\s+/g, ' ').trim();

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function cleanArtist(name = '') {
    return strip(name.replace(/\s+with.*$/i, '').replace(/\s+w\/.*$/i, ''));
}

function splitArtists(name = '') {
    const parts = name.split(/\bwith\b|\\bw\\/i).map(strip).filter(Boolean);
    if (parts.length <= 1) {
        const main = cleanArtist(name);
        return main ? [{ artist: main, role: 'headliner' }] : [];
    }
    const headliner = cleanArtist(parts[0]);
    const supports = parts.slice(1).map(cleanArtist).filter(Boolean);
    const records = [];
    if (headliner) records.push({ artist: headliner, role: 'headliner' });
    for (const s of supports) {
        if (s.toLowerCase() === headliner.toLowerCase()) continue;
        records.push({ artist: s, role: 'support' });
    }
    return records;
}

function dedupe(records) {
    const seen = new Set();
    const out = [];
    for (const r of records) {
        const key = r.artist.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
    }
    return out;
}

async function fetchEvents() {
    const res = await fetch(START_URL, {
        headers: { 'user-agent': 'Mozilla/5.0 (calendar crawler)' },
    });
    if (!res.ok) throw new Error(`Failed to fetch page ${res.status}`);
    const html = await res.text();
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const items = [];

    for (const raw of scripts) {
        try {
            const data = JSON.parse(raw);
            const maybeArray = Array.isArray(data) ? data : [data];
            for (const entry of maybeArray) {
                if (!entry || entry['@type'] !== 'MusicEvent') continue;
                const name = strip(entry.name || '');
                const artistEntries = splitArtists(name);
                if (!artistEntries.length) continue;
                const eventDate = formatDate(entry.startDate);
                const eventTime = formatTime(entry.startDate);
                const eventUrl = entry.url || START_URL;
                const description = strip(entry.description || name);
                for (const a of artistEntries) {
                    items.push({
                        artist: a.artist,
                        role: a.role,
                        eventDate,
                        eventTime,
                        venue: 'Scoot Inn',
                        eventUrl,
                        price: '',
                        description,
                        scrapedAt: new Date().toISOString(),
                    });
                }
            }
        } catch {
            // ignore parse errors
        }
    }

    return dedupe(items);
}

console.log('Starting Scoot Inn scraper (ld+json)...');
await Actor.init();

try {
    const records = await fetchEvents();
    if (!records.length) {
        console.warn('No events parsed.');
    } else {
        console.log(`Parsed ${records.length} unique artists.`);
        await Actor.pushData(records);
    }
} catch (err) {
    console.error('Scrape failed:', err.message);
    throw err;
}

await Actor.exit();
