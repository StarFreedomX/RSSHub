import { readFileSync } from 'node:fs';

import { load } from 'cheerio';
import { http, HttpResponse } from 'msw';
import Parser from 'rss-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../lib/app-bootstrap';
import { config } from '../lib/config';
import { namespaces } from '../lib/registry';
import { parseDetail, parseUpdates, route } from '../lib/routes/ayaka-ohashi/updates';
import server from '../lib/setup.test';
import cache from '../lib/utils/cache';

afterEach(() => vi.restoreAllMocks());

const fixture = (name: string) => readFileSync(new URL(`fixtures/ayaka-ohashi/${name}.html`, import.meta.url), 'utf8');
const list = fixture('updates');
const article = fixture('article');
const members = fixture('members');
const baseUrl = 'https://ayaka-ohashi.com';

describe("WHAT'S NEW parsing", () => {
    it('keeps all ten updates, including three radio episodes with distinct stable identities', () => {
        const items = parseUpdates(list);
        expect(items).toHaveLength(10);
        expect(new Set(items.map((item) => item.guid)).size).toBe(10);
        const radio = items.filter((item) => item.category?.includes('RADIO'));
        expect(radio).toHaveLength(3);
        expect(radio.every((item) => item.link?.startsWith(`${baseUrl}/pages/radio#rsshub-`))).toBe(true);
        const $ = load(list);
        $('.c_text-list-item').first().remove();
        expect(parseUpdates($.html()).map((item) => item.guid)).toEqual(items.slice(1).map((item) => item.guid));
        expect(items[0].link).toBe(`${baseUrl}/member/contents/blog#id1109907`);
    });

    it('uses Japan time regardless of server timezone and extracts categories and tags', () => {
        const items = parseUpdates(list);
        expect(items[0].pubDate).toEqual(new Date('2026-09-12T15:00:00Z'));
        expect(items[1].category).toEqual(['RADIO', 'radio']);
        expect(items[3].link).toBe(`${baseUrl}/contents/1103703`);
    });

    it('deduplicates repeated entries and keeps permalink identities through title edits', () => {
        const $ = load(list);
        const entry = $('.c_text-list-item').eq(3);
        entry.clone().appendTo('.c_text-list');
        entry.find('h2').text('Updated headline');
        expect(parseUpdates($.html())).toHaveLength(10);
        expect(parseUpdates($.html())[3].guid).toBe(`${baseUrl}/contents/1103703`);
    });

    it('omits missing or invalid dates instead of inventing publication times', () => {
        const $ = load(list);
        $('time').eq(0).removeAttr('datetime');
        $('time').eq(1).attr('datetime', '2026-02-31');
        const items = parseUpdates($.html());
        expect(items[0].pubDate).toBeUndefined();
        expect(items[1].pubDate).toBeUndefined();
    });

    it('rejects empty or changed listings and ignores links to another origin', () => {
        expect(() => parseUpdates('<html>Maintenance</html>')).toThrow("No WHAT'S NEW entries");
        const $ = load(list);
        $('a.c_text-list-anchor').attr('href', 'https://example.com/article');
        expect(() => parseUpdates($.html())).toThrow("No WHAT'S NEW entries");
    });

    it('extracts the public article without headings, navigation, or scripts', () => {
        const content = parseDetail(article, `${baseUrl}/contents/1103703`);
        expect(content).toContain('全電通労働会館');
        expect(content).not.toContain('corner-content-heading');
        expect(content).not.toContain('次へ');
        expect(content).not.toContain('<script');
    });

    it('preserves article images, links, and public previews while removing login forms', () => {
        const content = parseDetail('<div class="corner-content-body"><p>Preview</p><img src="/photo.jpg"><a href="/event">Event</a><script>bad()</script></div><div class="members-only"><form>Log in</form></div>', baseUrl);
        expect(content).toContain('Preview');
        expect(content).toContain('src="/photo.jpg"');
        expect(content).toContain('href="/event"');
        expect(content).toContain('会員限定');
        expect(content).not.toMatch(/<form|<script/);
    });

    it('recognizes member gates and login redirects without leaking page chrome', () => {
        expect(parseDetail(members, baseUrl)).toContain('会員限定');
        expect(parseDetail('<section class="corner-users"><div class="sign-form">Login</div></section>', baseUrl)).toContain('会員限定');
        expect(() => parseDetail('<html>Maintenance</html>', baseUrl)).toThrow('Article body not found');
    });
});

describe("WHAT'S NEW feed integration", () => {
    const requests: string[] = [];
    beforeEach(() => {
        requests.length = 0;
        namespaces['ayaka-ohashi'].routes['/updates'].handler = route.handler;
        vi.spyOn(cache.globalCache, 'get').mockResolvedValue(undefined);
        // Exercise the fetch path on each test, independently of process-wide cache state.
        vi.spyOn(cache, 'tryGet').mockImplementation((_key, getValue) => getValue());
        server.use(
            http.get(`${baseUrl}/updates`, () => HttpResponse.html(list)),
            http.get(`${baseUrl}/*`, ({ request }) => {
                requests.push(request.url);
                return HttpResponse.html(request.url.includes('/contents/') ? article : members);
            })
        );
    });

    it('serves valid RSS, keeps every update, fetches radio once, and caches with fixed expiry', async () => {
        const response = await app.request('/ayaka-ohashi/updates');
        expect(response.status).toBe(200);
        const feed = await new Parser().parseString(await response.text());
        expect(feed.title).toBe("大橋彩香 OFFICIAL SITE - WHAT'S NEW");
        expect(feed.items).toHaveLength(10);
        expect(new Set(feed.items.map((item) => item.guid)).size).toBe(10);
        expect(requests.filter((url) => url.endsWith('/pages/radio'))).toHaveLength(1);
        expect(requests.some((url) => url.includes('/member/'))).toBe(false);
        expect(feed.items.find((item) => item.link?.endsWith('/1103703'))?.content).toContain('全電通労働会館');
        expect(feed.items[0].content).toContain('会員限定');
        expect(cache.tryGet).toHaveBeenCalledWith(expect.stringContaining('ayaka-ohashi:detail:'), expect.any(Function), config.cache.contentExpire, false);
    });

    it('supports built-in category filtering and limits', async () => {
        const response = await app.request('/ayaka-ohashi/updates?filter_category=RADIO&limit=2');
        expect(response.status).toBe(200);
        const feed = await new Parser().parseString(await response.text());
        expect(feed.items).toHaveLength(2);
        expect(feed.items.every((item) => item.categories?.includes('RADIO'))).toBe(true);
    });

    it('serves Atom and JSON Feed with stable item identities', async () => {
        const atom = await app.request('/ayaka-ohashi/updates?format=atom');
        expect(atom.status).toBe(200);
        expect((await new Parser().parseString(await atom.text())).items).toHaveLength(10);
        const json = await app.request('/ayaka-ohashi/updates?format=json');
        expect(json.status).toBe(200);
        const feed = await json.json();
        expect(feed.items).toHaveLength(10);
        expect(new Set(feed.items.map((item: { id: string }) => item.id)).size).toBe(10);
    });

    it('retains updates on detail failure and retries failures on the next refresh', async () => {
        let attempts = 0;
        server.use(
            http.get(`${baseUrl}/contents/1103703`, () => {
                attempts++;
                return new HttpResponse('', { status: 404 });
            })
        );
        const checkFailure = async () => {
            const previousAttempts = attempts;
            const response = await app.request('/ayaka-ohashi/updates');
            const feed = await new Parser().parseString(await response.text());
            expect(feed.items).toHaveLength(10);
            expect(attempts).toBe(previousAttempts + 1);
            expect(feed.items.find((item) => item.link?.endsWith('/1103703'))?.content).toContain('本文を取得できませんでした');
        };
        await checkFailure();
        await checkFailure();
        expect(attempts).toBe(2);
    });

    it('resolves relative images and links through RSSHub middleware', async () => {
        server.use(http.get(`${baseUrl}/contents/1103703`, () => HttpResponse.html('<div class="corner-content-body"><img data-src="/photo.jpg"><a href="/event">Event</a></div>')));
        const response = await app.request('/ayaka-ohashi/updates');
        const feed = await new Parser().parseString(await response.text());
        const content = feed.items.find((item) => item.link?.endsWith('/1103703'))?.content;
        expect(content).toContain(`${baseUrl}/photo.jpg`);
        expect(content).toContain(`${baseUrl}/event`);
    });
});
