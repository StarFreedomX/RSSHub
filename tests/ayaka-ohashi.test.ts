import { readFileSync } from 'node:fs';

import { load } from 'cheerio';
import { http, HttpResponse } from 'msw';
import Parser from 'rss-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import app from '../lib/app-bootstrap';
import { config } from '../lib/config';
import { namespaces } from '../lib/registry';
import { fetchPage, getCookie } from '../lib/routes/ayaka-ohashi/auth';
import { parsePage, selectArticle } from '../lib/routes/ayaka-ohashi/content';
import { parseDetail, parseUpdates, route } from '../lib/routes/ayaka-ohashi/updates';
import server from '../lib/setup.test';
import cache from '../lib/utils/cache';

const originalAuth = config.ayakaOhashi;
beforeEach(() => {
    config.ayakaOhashi = {};
});
afterEach(() => {
    config.ayakaOhashi = originalAuth;
    vi.restoreAllMocks();
});

const fixture = (name: string) => readFileSync(new URL(`fixtures/ayaka-ohashi/${name}.html`, import.meta.url), 'utf8');
const list = fixture('updates');
const article = fixture('article');
const members = fixture('members');
const baseUrl = 'https://ayaka-ohashi.com';

// Synthetic member content follows the observed DOM; no account data or signed URLs are committed.
const blogPage = `<div class="c_blog-list-item" id="id1109907"><span class="c_blog-list-name">Staff</span><time datetime="2026-09-13-21:30"></time><div class="c_blog-list-body"><p>First private blog</p><img src="/private-photo.jpg"></div><form>Private CSRF value</form></div>
<div class="c_blog-list-item" id="id1103701"><span class="c_blog-list-name">Artist</span><div class="c_blog-list-body"><p>Second private blog</p></div></div>`;
const radioPage = `<div class="c_thumb-list-item"><div class="js-musicPlayBtn" data-src="https://media.example.com/three.mp3?Expires=9999999999&amp;Signature=test"><time datetime="2026-09-11"></time><h3 class="c_thumb-list-heading">第3回 何も変わらないな</h3></div></div>
<div class="c_thumb-list-item"><div class="js-musicPlayBtn js-musicPlayBtn--disabled" data-src="https://media.example.com/two.mp3"><time datetime="2026-09-04"></time><h3 class="c_thumb-list-heading">第2回 これ通じたな！！？</h3></div></div>
<div class="c_thumb-list-item"><div class="js-musicPlayBtn" data-src="https://media.example.com/one.mp3"><time datetime="2026-09-01"></time><h3 class="c_thumb-list-heading">第1回 最近言われたことが…</h3></div></div>`;

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

describe('member authentication and content', () => {
    beforeEach(() => {
        namespaces['ayaka-ohashi'].routes['/updates'].handler = route.handler;
        vi.spyOn(cache.globalCache, 'get').mockResolvedValue(undefined);
        vi.spyOn(cache, 'tryGet').mockImplementation((_key, getValue) => getValue());
    });

    it('supports remember_user_token and gives full Cookie precedence', () => {
        config.ayakaOhashi = { authToken: 'test-token' };
        expect(getCookie()).toBe('remember_user_token=test-token');
        config.ayakaOhashi.cookie = '_skiyaki_session=test-session';
        expect(getCookie()).toBe('_skiyaki_session=test-session');
        config.ayakaOhashi.cookie = 'bad\r\nCookie: injected';
        expect(() => getCookie()).toThrow('Invalid AYAKA_OHASHI');
    });

    it('matches blog anchors, preserves body images, and extracts author and precise Japan time', () => {
        const page = parsePage(blogPage, `${baseUrl}/member/contents/blog`);
        const items = parseUpdates(list);
        const first = selectArticle(page, items[0]);
        expect(first.description).toContain('First private blog');
        expect(first.description).toContain('private-photo.jpg');
        expect(first.description).not.toContain('Second private blog');
        expect(first.description).not.toContain('CSRF');
        expect(first.author).toBe('Staff');
        expect(first.pubDate).toEqual(new Date('2026-09-13T12:30:00Z'));
        expect(selectArticle(page, items[8]).description).toContain('Second private blog');
        expect(() => selectArticle(page, { title: 'missing', link: `${baseUrl}/member/contents/blog#id999` })).toThrow('Matching member entry');
    });

    it('matches each radio episode and exposes only enabled audio as an enclosure', () => {
        const page = parsePage(radioPage, `${baseUrl}/pages/radio`);
        const items = parseUpdates(list);
        const third = selectArticle(page, items[1]);
        expect(third.enclosure_url).toBe('https://media.example.com/three.mp3?Expires=9999999999&Signature=test');
        expect(third.enclosure_type).toBe('audio/mpeg');
        expect(third.description).toContain('<audio controls');
        const disabled = selectArticle(page, items[2]);
        expect(disabled.enclosure_url).toBeUndefined();
        expect(disabled.description).not.toContain('two.mp3');
        expect(selectArticle(page, items[6]).enclosure_url).toBe('https://media.example.com/one.mp3');
    });

    it('renders video players and wallpaper without actions or metadata', () => {
        const movie = parsePage('<div class="movie-player"><iframe src="https://player.example.com/embed?id=1" style="position:absolute"></iframe></div>', `${baseUrl}/movies/1`).article!;
        expect(movie.description).toContain('height="360"');
        expect(movie.description).not.toContain('position:absolute');
        expect(movie.enclosure_url).toBeUndefined();
        const wallpaper = parsePage(
            '<section class="corner-wallpaper"><h2>Metadata</h2><div class="corner-content-thumbnail"><img src="/wallpaper.jpg"></div><div class="corner-content-downloads"><a href="/photos/1/download" onclick="track()">Download</a></div></section>',
            `${baseUrl}/group/1`
        ).article!;
        expect(wallpaper.description).toContain('/wallpaper.jpg');
        expect(wallpaper.description).toContain('/photos/1/download');
        expect(wallpaper.description).not.toMatch(/onclick|Metadata/);
    });

    it('sends configured credentials, serves private bodies, and bypasses the shared feed cache', async () => {
        config.ayakaOhashi = { authToken: 'test-token' };
        const requests: string[] = [];
        server.use(
            http.get(`${baseUrl}/updates`, () => HttpResponse.html(list)),
            http.get(`${baseUrl}/*`, ({ request }) => {
                expect(request.headers.get('cookie')).toBe('remember_user_token=test-token');
                requests.push(request.url);
                return HttpResponse.html(request.url.includes('/member/') ? blogPage : request.url.endsWith('/radio') ? radioPage : article);
            })
        );
        const response = await app.request('/ayaka-ohashi/updates');
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-cache');
        const xml = await response.text();
        const feed = await new Parser().parseString(xml);
        expect(feed.items).toHaveLength(10);
        expect(feed.items[0].content).toContain('First private blog');
        expect(feed.items[8].content).toContain('Second private blog');
        expect(feed.items[1].enclosure?.type).toBe('audio/mpeg');
        expect(requests.filter((url) => url.endsWith('/blog'))).toHaveLength(1);
        expect(xml).not.toContain('test-token');
        expect(cache.tryGet).toHaveBeenCalledWith(expect.stringContaining('ayaka-ohashi:detail:v2:'), expect.any(Function), 60, false);
    });

    it('isolates cached content across accounts and anonymous access', async () => {
        server.use(http.get(`${baseUrl}/contents/1`, () => HttpResponse.html(article)));
        await fetchPage(`${baseUrl}/contents/1`, 'remember_user_token=one');
        await fetchPage(`${baseUrl}/contents/1`, 'remember_user_token=two');
        await fetchPage(`${baseUrl}/contents/1`, '');
        const keys = vi.mocked(cache.tryGet).mock.calls.map((call) => call[0]);
        expect(new Set(keys).size).toBe(3);
        expect(keys.join(',')).not.toMatch(/remember_user_token|=one|=two/);
    });

    it('does not reuse anonymous feed cache after enabling an account, or member content after removing it', async () => {
        const values = new Map<string, string>();
        vi.mocked(cache.globalCache.get).mockImplementation((key) => values.get(key));
        vi.spyOn(cache.globalCache, 'claim').mockImplementation((key) => {
            if (values.get(key) === '1') {
                return false;
            }
            values.set(key, '1');
            return true;
        });
        vi.spyOn(cache.globalCache, 'set').mockImplementation((key, value) => {
            values.set(key, value as string);
        });
        server.use(
            http.get(`${baseUrl}/updates`, () => HttpResponse.html(list)),
            http.get(`${baseUrl}/*`, ({ request }) => HttpResponse.html(request.url.includes('/member/') ? blogPage : request.url.endsWith('/radio') ? members : article))
        );
        const anonymous = await app.request('/ayaka-ohashi/updates');
        expect(await anonymous.text()).not.toContain('First private blog');
        config.ayakaOhashi = { authToken: 'test-token' };
        const member = await app.request('/ayaka-ohashi/updates');
        expect(await member.text()).toContain('First private blog');
        config.ayakaOhashi = {};
        const anonymousAgain = await app.request('/ayaka-ohashi/updates');
        expect(await anonymousAgain.text()).not.toContain('First private blog');
    });

    it('treats 401 and 403 responses as credential or membership failures', async () => {
        server.use(
            http.get(`${baseUrl}/contents/401`, () => new HttpResponse('', { status: 401 })),
            http.get(`${baseUrl}/contents/403`, () => new HttpResponse('', { status: 403 }))
        );
        await expect(fetchPage(`${baseUrl}/contents/401`, 'remember_user_token=test')).rejects.toThrow('会員コンテンツにアクセスできません');
        await expect(fetchPage(`${baseUrl}/contents/403`, 'remember_user_token=test')).rejects.toThrow('会員コンテンツにアクセスできません');
    });

    it('reports invalid sessions without caching login forms', async () => {
        config.ayakaOhashi = { authToken: 'expired-test-token' };
        server.use(http.get(`${baseUrl}/*`, ({ request }) => HttpResponse.html(request.url.endsWith('/updates') ? list : members)));
        const response = await app.request('/ayaka-ohashi/updates');
        const xml = await response.text();
        expect(xml).toContain('AYAKA_OHASHI_COOKIE');
        expect(xml).not.toContain('expired-test-token');
        await expect(fetchPage(`${baseUrl}/pages/radio`, getCookie())).rejects.toThrow('会員コンテンツにアクセスできません');
    });

    it('follows same-origin redirects with refreshed cookies and never forwards credentials off-site', async () => {
        server.use(
            http.get(`${baseUrl}/contents/1`, () => new HttpResponse('', { status: 302, headers: { location: '/contents/2', 'set-cookie': '_skiyaki_session=fresh; Path=/' } })),
            http.get(`${baseUrl}/contents/2`, ({ request }) => {
                expect(request.headers.get('cookie')).toContain('_skiyaki_session=fresh');
                return HttpResponse.html(article);
            }),
            http.get(`${baseUrl}/contents/3`, () => HttpResponse.redirect('https://example.com/signin'))
        );
        expect((await fetchPage(`${baseUrl}/contents/1`, 'remember_user_token=test')).article?.description).toContain('全電通');
        await expect(fetchPage(`${baseUrl}/contents/3`, 'remember_user_token=test')).rejects.toThrow('会員コンテンツにアクセスできません');
        expect(() => fetchPage('https://example.com/private', 'remember_user_token=test')).toThrow('another origin');
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
