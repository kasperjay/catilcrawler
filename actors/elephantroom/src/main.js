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
    const output = { ...record, artistName, eventDate };
    return originalPushData(output);
};
const VENUE = 'Elephant Room';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const strip = (text = '') => text.replace(/\s+/g, ' ').trim();

function monthIndex(name = '') {
    const m = name.slice(0, 3).toLowerCase();
    return MONTHS.indexOf(m);
}

function formatDate(year, monthIdx, day) {
    if (year == null || monthIdx < 0 || day == null) return '';
    const d = new Date(year, monthIdx, day);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function parseTime(text = '') {
    const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(a|p|am|pm)/i);
    if (!m) return '';
    const hour = m[1];
    const minutes = m[2] || '00';
    const meridiem = (m[3] || '').toLowerCase();
    return `${hour}:${minutes.padStart(2, '0')} ${meridiem.startsWith('p') ? 'PM' : 'AM'}`;
}

function resolveMonthForCell(dayNumber, cellIsOtherMonth, currentMonthIdx, currentYear) {
    if (!cellIsOtherMonth) return { monthIdx: currentMonthIdx, year: currentYear };
    // Heuristic: numbers near start belong to next month, large numbers belong to previous month.
    if (dayNumber <= 15) {
        const nextMonthIdx = (currentMonthIdx + 1) % 12;
        const nextYear = currentMonthIdx === 11 ? currentYear + 1 : currentYear;
        return { monthIdx: nextMonthIdx, year: nextYear };
    }
    const prevMonthIdx = (currentMonthIdx + 11) % 12;
    const prevYear = currentMonthIdx === 0 ? currentYear - 1 : currentYear;
    return { monthIdx: prevMonthIdx, year: prevYear };
}

Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const startUrl = input.startUrl || 'https://elephantroom.com/calendar';
    const maxEvents = Number(input.maxEvents) || 400;
    const requestTimeoutSecs = Number(input.requestTimeoutSecs) || 90;

    const items = [];

    const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: requestTimeoutSecs,
        navigationTimeoutSecs: requestTimeoutSecs,
        launchContext: { launchOptions: { headless: true } },
        requestHandler: async ({ page }) => {
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: requestTimeoutSecs * 1000 });
            await page.waitForSelector('#calendar', { timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(4000);

            const data = await page.$$eval('#calendar table.calendar td', (cells) => {
                const strip = (t = '') => t.replace(/\s+/g, ' ').trim();
                const monthText = strip(document.querySelector('#calendar .month .month-name')?.textContent || '');
                return cells.map((cell) => {
                    const dayNum = Number(strip(cell.querySelector('.day')?.textContent || ''));
                    const isOther = cell.classList.contains('other-month');
                    const events = Array.from(cell.querySelectorAll('ul > li')).map(li => {
                        const link = li.querySelector('a.event_details');
                        const name = strip(link?.querySelector('.event-name')?.textContent || '');
                        const timeText = strip(link?.querySelector('.time')?.textContent || link?.innerText || '');
                        const href = link?.getAttribute('href') || '';
                        return { name, timeText, href, raw: strip(link?.innerText || '') };
                    });
                    return { dayNum, isOther, events, monthText };
                });
            });

            const monthLabel = data[0]?.monthText || '';
            const mtMatch = monthLabel.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
            if (!mtMatch) {
                log.error('Could not parse month header.');
                return;
            }
            const baseMonthIdx = monthIndex(mtMatch[1]);
            const baseYear = Number(mtMatch[2]);

            for (const cell of data) {
                if (!cell.dayNum || !cell.events.length) continue;
                const { monthIdx, year } = resolveMonthForCell(cell.dayNum, cell.isOther, baseMonthIdx, baseYear);
                const eventDate = formatDate(year, monthIdx, cell.dayNum);
                for (const evt of cell.events) {
                    if (maxEvents > 0 && items.length >= maxEvents) break;
                    const artist = evt.name || evt.raw;
                    if (!artist) continue;
                    const eventTime = parseTime(evt.timeText || evt.raw || '');
                    const role = 'headliner';
                    const eventUrl = evt.href ? new URL(evt.href, startUrl).toString() : startUrl;
                    items.push({
                        artist,
                        role,
                        eventDate,
                        eventTime,
                        venue: VENUE,
                        eventUrl,
                        price: '',
                        description: evt.raw,
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
