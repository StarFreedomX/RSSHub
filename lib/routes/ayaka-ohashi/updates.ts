import { createHash } from 'node:crypto';

import { load } from 'cheerio';
import type { Context } from 'hono';
import pMap from 'p-map';

import type { Data, DataItem, Route } from '@/types';
import logger from '@/utils/logger';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

import { fetchPage, getCookie, MemberAccessError } from './auth';
import { authNotice, baseUrl, notice, type Page, parsePage, selectArticle } from './content';

const updatesUrl = `${baseUrl}/updates`;
const unavailableNotice = '本文を取得できませんでした。公式サイトでご確認ください。';

export const route: Route = {
    path: '/updates',
    name: "WHAT'S NEW",
    example: '/ayaka-ohashi/updates',
    maintainers: ['StarFreedomX'],
    description: `大橋彩香公式サイトの WHAT'S NEW。NEWS、RADIO、BLOG、MOVIE、WALLPAPER、LIVE STREAMING など、最新ページのすべての更新を配信します。

公開記事は本文・画像・リンクを含みます。AYAKA\\_OHASHI\\_COOKIE または AYAKA\\_OHASHI\\_AUTH\\_TOKEN を設定すると、そのアカウントで閲覧可能な会員ブログ、ラジオ音声、動画プレイヤー、壁紙も配信します。未設定の場合は会員向け更新通知のみ配信します。同じ URL を共有する RADIO の各回も個別の項目として配信します。日付は日本時間です。

RSSHub の共通パラメーターを利用できます。例：ニュースのみ \`/ayaka-ohashi/updates?filter_category=NEWS\`、ラジオのみ \`/ayaka-ohashi/updates?filter_category=RADIO\`、最新 5 件 \`/ayaka-ohashi/updates?limit=5\`。分類による絞り込みは最新ページ内の項目が対象で、過去ログの全件取得ではありません。

中文：订阅官网最新一页的全部更新；公开文章提供正文；配置 AYAKA\\_OHASHI\\_COOKIE（完整 Cookie）或 AYAKA\\_OHASHI\\_AUTH\\_TOKEN（remember\\_user\\_token 的值）后显示账号有权访问的会员内容。Cookie 优先；修改后重启服务。登录失效或会员权限不足时显示配置检查提示。广播签名链接会过期，重新刷新订阅可获取新链接；视频需要阅读器支持 iframe，否则使用原站播放入口。凭据应放在 .env，公网实例应配合 RSSHub ACCESS\\_KEY 保护会员订阅。支持 RSSHub 内置分类筛选、关键词筛选、条数限制，以及 RSS、Atom、JSON Feed 输出。`,
    radar: [{ source: ['ayaka-ohashi.com/', 'ayaka-ohashi.com/updates'], target: '/updates' }],
    features: {
        requireConfig: [
            { name: 'AYAKA_OHASHI_COOKIE', description: '官网登录后的完整 Cookie 请求头。与 AUTH_TOKEN 二选一，Cookie 优先。', optional: true },
            { name: 'AYAKA_OHASHI_AUTH_TOKEN', description: '官网登录 Cookie 中 remember_user_token 的值。', optional: true },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: true,
        supportScihub: false,
    },
    handler,
};

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
    return parsePage(html, url).article?.description || '';
}

async function handler(ctx: Context): Promise<Data> {
    const cookie = getCookie();
    // Signed member media must be refreshed; only the short-lived account-scoped detail cache is used.
    if (cookie) {
        ctx.header('Cache-Control', 'no-cache');
    }
    const items = parseUpdates(await ofetch(updatesUrl, { responseType: 'text', timeout: 15000 }));
    const urls = items.map((item) => {
        const url = new URL(item.link!);
        url.hash = '';
        return url.href;
    });
    const pages = new Map(
        await pMap(
            [...new Set(urls)],
            async (url): Promise<[string, Page]> => {
                try {
                    return [url, await fetchPage(url, cookie)];
                } catch (error) {
                    // Never log request headers, cookies, or signed media URLs.
                    logger.warn(`ayaka-ohashi: could not load ${new URL(url).pathname}`);
                    return [url, { article: { description: notice(error instanceof MemberAccessError ? authNotice : unavailableNotice, url) } }];
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
        item: items.map((item, index) => {
            try {
                return { ...item, ...selectArticle(pages.get(urls[index])!, item) };
            } catch {
                return { ...item, description: notice(unavailableNotice, item.link!) };
            }
        }),
    };
}
