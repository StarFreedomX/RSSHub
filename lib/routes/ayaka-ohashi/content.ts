import { load } from 'cheerio';
import { escape } from 'entities';

import type { DataItem } from '@/types';
import { parseDate } from '@/utils/parse-date';

export const baseUrl = 'https://ayaka-ohashi.com';
export const memberNotice = '会員限定コンテンツです。閲覧・視聴には公式サイトでのログインと対象の会員資格が必要です。';
export const authNotice = '会員コンテンツにアクセスできません。AYAKA_OHASHI_COOKIE / AYAKA_OHASHI_AUTH_TOKEN の有効期限と会員資格を確認し、ログイン情報を更新してください。';
export type Article = Partial<DataItem>;
export type Page = { article?: Article; entries?: Record<string, Article>; memberOnly?: boolean };

export function notice(text: string, url: string) {
    return `<p>${text}</p><p><a href="${escape(url)}">公式サイトで続きを読む</a></p>`;
}

function mediaUrl(value: string | undefined, url: string) {
    if (!value) {
        return;
    }
    const resolved = new URL(value, url);
    if (resolved.protocol === 'https:' || resolved.protocol === 'http:') {
        return resolved.href;
    }
}

function radioKey(title: string, date: string) {
    return `${date}\n${title.normalize('NFKC').replaceAll(/\s+/g, ' ').trim()}`;
}

export function parsePage(html: string, url: string): Page {
    const $ = load(html);
    const memberOnly = $('.members-only, .corner-users .sign-form').length > 0;
    $('script, style, form, .social-list-wrapp, .members-only').remove();
    $('*').each((_, element) => {
        if (!('attribs' in element)) {
            return;
        }
        for (const attribute of Object.keys(element.attribs)) {
            if (attribute.startsWith('on')) {
                $(element).removeAttr(attribute);
            }
        }
    });
    if (memberOnly) {
        return { memberOnly: true, article: { description: `${$('.corner-content-body').first().html() || ''}${notice(memberNotice, url)}` } };
    }
    if (new URL(url).pathname === '/member/contents/blog') {
        const entries: Record<string, Article> = {};
        for (const element of $('.c_blog-list-item[id]').toArray()) {
            const entry = $(element);
            const description = entry.find('.c_blog-list-body').html();
            if (!description) {
                continue;
            }
            const date = entry.find('time').attr('datetime');
            const timestamp = date?.match(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/);
            entries[entry.attr('id')!] = {
                description,
                author: entry.find('.c_blog-list-name').text() || undefined,
                ...(timestamp && { pubDate: parseDate(`${timestamp[1]}T${timestamp[2]}:00+09:00`) }),
            };
        }
        return { entries };
    }
    if (new URL(url).pathname === '/pages/radio') {
        const entries: Record<string, Article> = {};
        for (const element of $('.c_thumb-list-item').toArray()) {
            const entry = $(element);
            const title = entry.find('.c_thumb-list-heading').text();
            const date = entry.find('time').attr('datetime') || '';
            const button = entry.find('.js-musicPlayBtn');
            const source = button.hasClass('js-musicPlayBtn--disabled') ? undefined : mediaUrl(button.attr('data-src'), url);
            const image = mediaUrl(entry.find('[data-bg]').attr('data-bg'), url);
            entries[radioKey(title, date)] = source
                ? {
                      description: `<audio controls preload="none" src="${escape(source)}"></audio><p><a href="${escape(source)}">音声を再生・ダウンロード</a></p>`,
                      image,
                      ...(/\.mp3$/i.test(new URL(source).pathname) && { enclosure_url: source, enclosure_type: 'audio/mpeg', itunes_item_image: image }),
                  }
                : { description: notice('この回の音声は現在の会員資格では再生できないか、配信が終了しています。', url) };
        }
        return { entries };
    }
    const body = $('.corner-content-body').first().html() || '';
    const player = mediaUrl($('.movie-player iframe').attr('src'), url);
    if (player) {
        return { article: { description: `${body}<iframe src="${escape(player)}" width="640" height="360" allowfullscreen></iframe><p><a href="${escape(url)}">公式サイトで動画を再生</a></p>` } };
    }
    const wallpaper = $('.corner-wallpaper .corner-content-thumbnail').html();
    if (wallpaper) {
        return { article: { description: `${wallpaper}${body}${$('.corner-content-downloads').html() || ''}` } };
    }
    if (!body.trim()) {
        throw new Error('Article body not found');
    }
    return { article: { description: body.trim() } };
}

export function selectArticle(page: Page, item: DataItem): Article {
    if (page.article) {
        return page.article;
    }
    const url = new URL(item.link!);
    const date = item.pubDate ? new Date(+new Date(item.pubDate) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';
    const key = url.pathname === '/pages/radio' ? radioKey(item.title, date) : url.hash.slice(1);
    const article = page.entries?.[key];
    if (!article) {
        throw new Error('Matching member entry not found on the first page');
    }
    return article;
}
