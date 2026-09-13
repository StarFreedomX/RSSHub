import { createHash } from 'node:crypto';

import { load } from 'cheerio';
import { escape } from 'entities';
import pMap from 'p-map';

import { config } from '@/config';
import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import logger from '@/utils/logger';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://ayaka-ohashi.com';
const updatesUrl = `${baseUrl}/updates`;
const memberNotice = '会員限定コンテンツです。閲覧・視聴には公式サイトでのログインと対象の会員資格が必要です。';
const unavailableNotice = '本文を取得できませんでした。公式サイトでご確認ください。';

export const route: Route = {
    path: '/updates',
    name: "WHAT'S NEW",
    example: '/ayaka-ohashi/updates',
    maintainers: ['StarFreedomX'],
    description: `大橋彩香公式サイトの WHAT'S NEW。NEWS、RADIO、BLOG、MOVIE、WALLPAPER、LIVE STREAMING など、最新ページのすべての更新を配信します。

公開記事は本文・画像・リンクを含みます。会員限定コンテンツは公開された更新情報と公式サイトへのリンクのみ配信し、会員向け音声・動画の取得は行いません。同じ URL を共有する RADIO の各回も個別の項目として配信します。日付は日本時間です。

RSSHub の共通パラメーターを利用できます。例：ニュースのみ \`/ayaka-ohashi/updates?filter_category=NEWS\`、ラジオのみ \`/ayaka-ohashi/updates?filter_category=RADIO\`、最新 5 件 \`/ayaka-ohashi/updates?limit=5\`。分類による絞り込みは最新ページ内の項目が対象で、過去ログの全件取得ではありません。

中文：订阅官网最新一页的全部更新；公开文章提供正文，会员内容提供更新通知和原站入口。支持 RSSHub 内置分类筛选、关键词筛选、条数限制，以及 RSS、Atom、JSON Feed 输出。`,
    radar: [{ source: ['ayaka-ohashi.com/', 'ayaka-ohashi.com/updates'], target: '/updates' }],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler,
};

function notice(text: string, url: string) {
    return `<p>${text}</p><p><a href="${escape(url)}">公式サイトで続きを読む</a></p>`;
}

export function parseUpdates(html: string): DataItem[] {
    const $ = load(html);
    const items = new Map<string, DataItem>();
    for (const element of $('.corner-updates .c_text-list-item').toArray()) {
        const entry = $(element);
        const href = entry.find('a.c_text-list-anchor').attr('href');
        const title = entry.find('.c_text-list-heading').text();
        if (!href || !title) {
            continue;
        }
        const url = new URL(href, baseUrl);
        if (url.origin !== baseUrl) {
            continue;
        }
        const date = entry.find('time').attr('datetime');
        const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parseDate(date, 'YYYY-MM-DD', true).getTime());
        // Radio episodes share a landing page. Never use its bare URL as their identity.
        if (!url.hash && !/^\/(?:contents|movies|group)\/\d+\/?$/.test(url.pathname)) {
            url.hash = `rsshub-${createHash('sha256')
                .update(`${date || ''}\n${title}`)
                .digest('hex')}`;
        }
        const link = url.href;
        const category = [
            ...new Set(
                entry
                    .find('.category, .tag')
                    .toArray()
                    .map((tag) => $(tag).text().trim())
                    .filter(Boolean)
            ),
        ];
        items.set(link, {
            title,
            link,
            guid: link,
            ...(validDate && { pubDate: parseDate(`${date}T00:00:00+09:00`) }),
            category,
            author: '大橋彩香 OFFICIAL SITE',
        });
    }
    if (!items.size) {
        throw new Error("No WHAT'S NEW entries found at ayaka-ohashi.com/updates; the website may have changed its layout.");
    }
    return items.values().toArray();
}

export function parseDetail(html: string, url: string): string {
    const $ = load(html);
    const memberOnly = $('.members-only, .corner-users .sign-form').length > 0;
    const body = $('.corner-content-body').first();
    body.find('script, style, form, .social-list-wrapp, .members-only').remove();
    const description = body.html()?.trim();
    if (memberOnly) {
        return `${description || ''}${notice(memberNotice, url)}`;
    }
    if (!description) {
        throw new Error(`Article body not found at ${url}`);
    }
    return description;
}

function fetchDetail(url: string): Promise<string> {
    if (new URL(url).pathname.startsWith('/member/')) {
        return Promise.resolve(notice(memberNotice, url));
    }
    return cache.tryGet(`ayaka-ohashi:detail:${url}`, async () => parseDetail(await ofetch(url, { responseType: 'text', timeout: 15000 }), url), config.cache.contentExpire, false);
}

async function handler(): Promise<Data> {
    const items = parseUpdates(await ofetch(updatesUrl, { responseType: 'text', timeout: 15000 }));
    // Fetch shared landing pages once, with bounded concurrency and fixed cache expiry.
    const urls = items.map((item) => {
        const url = new URL(item.link!);
        url.hash = '';
        return url.href;
    });
    const descriptions = new Map(
        await pMap(
            [...new Set(urls)],
            async (url): Promise<[string, string]> => {
                try {
                    return [url, await fetchDetail(url)];
                } catch (error) {
                    // Do not cache transient failures; keep the update and retry next time.
                    logger.warn(`ayaka-ohashi: could not fetch ${url}: ${error}`);
                    return [url, notice(unavailableNotice, url)];
                }
            },
            { concurrency: 3 }
        )
    );
    return {
        title: "大橋彩香 OFFICIAL SITE - WHAT'S NEW",
        link: updatesUrl,
        description: '大橋彩香公式サイト・ファンクラブ「大橋家」の最新情報',
        language: 'ja',
        image: `${baseUrl}/assets/ayakaohashi/app/og_image.png`,
        item: items.map((item, index) => ({ ...item, description: descriptions.get(urls[index]) })),
    };
}
