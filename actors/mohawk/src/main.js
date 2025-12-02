import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

function strip(text = '') {
    return text.replace(/\s+/g, ' ').trim();
}

function parseDateLine(line) {
    // Example: "THURSDAY, DEC 4 MOHAWK PRESENTS 7PM / INDOOR / ALL AGES"
    const parts = line.split('/')[0];
    const timeMatch = parts.match(/(?:\b)(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    const dateWords = parts.split(/\d{1,2}(?::\d{2})?\s*(AM|PM)?/i)[0].trim();

    const dateMatch = dateWords.match(/([A-Z]+),\s+([A-Z]{3,})\s+(\d{1,2})/i);
    let displayDate = '';
    if (dateMatch) {
        const [, , monthStr, dayStr] = dateMatch;
        const monthMap = {
            JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
            JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
        };
        const day = Number(dayStr);
        const now = new Date();
        const year = now.getFullYear();
        const month = monthMap[monthStr.toUpperCase()] ?? now.getMonth();
        const d = new Date(year, month, day);
        displayDate = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    let displayTime = '';
    if (timeMatch) {
        const hour = Number(timeMatch[1]);
        const minute = timeMatch[2] ?? '00';
        const ampm = (timeMatch[3] || '').toLowerCase();
        if (ampm) {
            displayTime = `${hour}:${minute} ${ampm}`;
        } else {
            // if no AM/PM, assume PM for evening shows
            const h12 = hour % 12 || 12;
            displayTime = `${h12}:${minute} pm`;
        }
    }

    return { displayDate, displayTime };
}

function buildItem({ title, subtitle, dateLine, url, stage, priceText }) {
    const { displayDate, displayTime } = parseDateLine(dateLine || '');
    return {
        artist: strip(title || ''),
        description: strip(subtitle || ''),
        eventDate: displayDate,
        eventTime: displayTime,
        venue: stage || 'Mohawk Austin',
        eventUrl: url || '',
        price: strip(priceText || ''),
        scrapedAt: new Date().toISOString(),
    };
}

console.log('Starting Mohawk Austin scraper (Playwright)...');
await Actor.init();

const input = await Actor.getInput() || {};
const startUrl = input.startUrl || 'https://mohawkaustin.com/';
const maxEvents = Number(input.maxEvents) || 200;

const items = [];

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    requestHandler: async ({ page, log }) => {
        await page.goto(startUrl, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1000);

        const seenUrls = new Set();

        async function harvest() {
            const rows = await page.$$eval('a[href*="/event/?id="]', (anchors) => {
                const out = [];
                for (const a of anchors) {
                    const url = a.getAttribute('href') || '';
                    const title = (a.textContent || '').trim();
                    const container = a.closest('article, section, div') || a.parentElement;
                    const text = (container?.innerText || '').replace(/\s+/g, ' ').trim();
                    const h2 = container?.querySelector('h2 a[href*="/event/?id="]');
                    const subtitle = h2 && h2 !== a ? (h2.textContent || '').trim() : '';
                    out.push({ url, title, subtitle, text });
                }
                return out;
            });

            let newCount = 0;
            for (const r of rows) {
                if (!r.url || seenUrls.has(r.url)) continue;
                if (items.length >= maxEvents) break;
                seenUrls.add(r.url);
                const dateLine = r.text.replace(r.title, '').replace(r.subtitle, '').trim();
                const stageMatch = dateLine.match(/\bINDOOR|OUTDOOR\b/i);
                const stage = stageMatch ? (stageMatch[0].toUpperCase() === 'INDOOR' ? 'Indoor' : 'Outdoor') : 'Mohawk Austin';
                const priceText = (dateLine.match(/FREE|SOLD OUT|GET TICKETS/i) || [])[0] || '';
                items.push(buildItem({ title: r.title, subtitle: r.subtitle, dateLine, url: r.url, stage, priceText }));
                newCount++;
            }
            return newCount;
        }

        await harvest();

        // Click SHOW ME MORE until exhausted or maxEvents reached
        for (let i = 0; i < 25; i++) { // hard cap to prevent infinite loop
            if (items.length >= maxEvents) break;
            const button = await page.$('text=SHOW ME MORE');
            if (!button) break;
            const before = items.length;
            await Promise.all([
                button.click(),
                page.waitForLoadState('networkidle').catch(() => {}),
            ]);
            await page.waitForTimeout(800);
            const added = await harvest();
            log.info(`Pagination click ${i + 1}: added ${added} new events (total ${items.length})`);
            if (items.length === before) {
                // no change after click; break to avoid looping
                break;
            }
        }

        log.info(`Collected ${items.length} items after pagination`);
    },
});

await crawler.run([{ url: startUrl }]);

for (const item of items) {
    await Actor.pushData(item);
}

console.log(`Mohawk scraper finished. Pushed ${items.length} items.`);
await Actor.exit();
