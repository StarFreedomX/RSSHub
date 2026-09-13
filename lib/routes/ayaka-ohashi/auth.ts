import { createHash } from 'node:crypto';

import { FetchError, type FetchResponse } from 'ofetch';
import { CookieJar } from 'tough-cookie';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';

import { authNotice, baseUrl, memberNotice, notice, type Page, parsePage } from './content';

export class MemberAccessError extends Error {
    constructor() {
        super(authNotice);
    }
}

export function getCookie() {
    const cookie = config.ayakaOhashi.cookie?.trim();
    const token = config.ayakaOhashi.authToken?.trim();
    const value = cookie || (token ? `remember_user_token=${token}` : '');
    if (/[\r\n]/.test(value) || (!cookie && token?.includes(';'))) {
        throw new ConfigNotFoundError('Invalid AYAKA_OHASHI_COOKIE / AYAKA_OHASHI_AUTH_TOKEN format. Use a single-line Cookie header or remember_user_token value.');
    }
    return value;
}

async function requestPage(url: string, cookie: string, jar: CookieJar, redirects = 0): Promise<string> {
    const headers = cookie ? { cookie: await jar.getCookieString(url) } : undefined;
    let response: FetchResponse<string>;
    try {
        response = await ofetch.raw<string, 'text'>(url, { headers, responseType: 'text', timeout: 15000, redirect: 'manual' });
    } catch (error) {
        if (error instanceof FetchError && (error.statusCode === 401 || error.statusCode === 403)) {
            throw new MemberAccessError();
        }
        throw error;
    }
    if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        const next = location && new URL(location, url);
        if (!next || next.origin !== baseUrl || redirects >= 3) {
            throw new MemberAccessError();
        }
        for (const value of response.headers.getSetCookie()) {
            jar.setCookieSync(value, url);
        }
        return requestPage(next.href, cookie, jar, redirects + 1);
    }
    return response._data || '';
}

export function fetchPage(url: string, cookie: string): Promise<Page> {
    if (new URL(url).origin !== baseUrl) {
        throw new Error('Refusing to send site credentials to another origin');
    }
    if (!cookie && new URL(url).pathname.startsWith('/member/')) {
        return Promise.resolve({ memberOnly: true, article: { description: notice(memberNotice, url) } });
    }
    const scope = createHash('sha256').update(cookie).digest('hex');
    return cache.tryGet(
        `ayaka-ohashi:detail:v2:${scope}:${url}`,
        async () => {
            const jar = new CookieJar();
            for (const value of cookie.split(';')) {
                if (value.trim()) {
                    jar.setCookieSync(`${value.trim()}; Path=/; Secure`, baseUrl);
                }
            }
            const page = parsePage(await requestPage(url, cookie, jar), url);
            if (cookie && page.memberOnly) {
                throw new MemberAccessError();
            }
            return page;
        },
        cookie ? Math.min(config.cache.contentExpire, 60) : config.cache.contentExpire,
        false
    );
}
