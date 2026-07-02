export type WechatRawJson = Record<string, unknown>;

export type ArticlePreview = {
  title: string | null;
  author: string | null;
  digest: string | null;
  url: string | null;
  content_source_url: string | null;
  publish_time: number | string | null;
  article_id: string | null;
  media_id: string | null;
  thumb_media_id: string | null;
  inferred_category: string;
};

export type AccessTokenResult = {
  success: boolean;
  raw: WechatRawJson;
  safeRaw: WechatRawJson;
  accessToken: string | null;
  tokenPreview: string | null;
  error?: {
    errcode: number | string | null;
    errmsg: string | null;
  };
  hint?: string;
};

export type PublishedArticlesResult = {
  success: boolean;
  source: "freepublish/batchget";
  raw?: WechatRawJson;
  preview: ArticlePreview[];
  accessToken?: {
    tokenPreview: string | null;
    raw: WechatRawJson;
  };
  error?: {
    errcode: number | string | null;
    errmsg: string | null;
  };
  hint?: string;
};

const TOKEN_API = "https://api.weixin.qq.com/cgi-bin/token";
const FREEPUBLISH_API_NAME = "freepublish/batchget";
const FREEPUBLISH_API = `https://api.weixin.qq.com/cgi-bin/${FREEPUBLISH_API_NAME}`;
const BATCH_BODY = {
  offset: 0,
  count: 5,
  no_content: 0,
};

function maskAppId(appId: string | undefined): string | null {
  if (!appId) {
    return null;
  }

  if (appId.length <= 8) {
    return `${appId.slice(0, 2)}...`;
  }

  return `${appId.slice(0, 6)}...${appId.slice(-4)}`;
}

function getWechatConfig(): { appId: string; appSecret: string } {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("WECHAT_APP_ID 或 WECHAT_APP_SECRET 缺失");
  }

  return { appId, appSecret };
}

function maskToken(token: string): string {
  return `${token.slice(0, 8)}...`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumberOrString(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  return null;
}

function hasWechatError(raw: WechatRawJson): boolean {
  return typeof raw.errcode === "number" && raw.errcode !== 0;
}

function getWechatError(raw: WechatRawJson): { errcode: number | string | null; errmsg: string | null } {
  return {
    errcode: typeof raw.errcode === "number" || typeof raw.errcode === "string" ? raw.errcode : null,
    errmsg: typeof raw.errmsg === "string" ? raw.errmsg : null,
  };
}

export function getWechatErrorHint(errcode: unknown, errmsg?: unknown): string {
  const code = typeof errcode === "number" ? errcode : Number(errcode);
  const message = typeof errmsg === "string" ? errmsg : "";

  if (code === 40164 || message.includes("invalid ip")) {
    return "当前服务器公网 IP 不在微信公众号白名单";
  }

  if (code === 40013 || message.includes("invalid appid")) {
    return "AppID 无效";
  }

  if (code === 40125 || message.includes("invalid appsecret")) {
    return "AppSecret 无效";
  }

  if (code === 48001 || message.includes("api unauthorized")) {
    return "API 权限不足";
  }

  if (code === 45009) {
    return "接口调用频率达到上限，请稍后重试";
  }

  if (code === -1) {
    return "微信系统繁忙，请稍后重试";
  }

  return "请结合 errcode / errmsg 查询微信公众平台接口文档";
}

function sanitizeTokenRaw(raw: WechatRawJson, tokenPreview: string | null): WechatRawJson {
  if (!("access_token" in raw)) {
    return raw;
  }

  return {
    ...raw,
    access_token: tokenPreview,
  };
}

export function getWechatApiDebugInfo(): {
  tokenApiUrl: string;
  publishedArticlesApiUrl: string;
  appIdExists: boolean;
  appSecretExists: boolean;
  appIdPreview: string | null;
} {
  const appId = process.env.WECHAT_APP_ID;

  return {
    tokenApiUrl: `${TOKEN_API}?grant_type=client_credential&appid=${maskAppId(appId) ?? "<missing>"}&secret=<hidden>`,
    publishedArticlesApiUrl: `${FREEPUBLISH_API}?access_token=<hidden>`,
    appIdExists: Boolean(process.env.WECHAT_APP_ID),
    appSecretExists: Boolean(process.env.WECHAT_APP_SECRET),
    appIdPreview: maskAppId(appId),
  };
}

async function readJsonResponse(url: string, init?: RequestInit): Promise<WechatRawJson> {
  const response = await fetch(url, init);
  const text = await response.text();

  try {
    return JSON.parse(text) as WechatRawJson;
  } catch {
    return {
      errcode: -999999,
      errmsg: `HTTP ${response.status} 返回内容不是 JSON`,
      raw_response: text,
    };
  }
}

export function inferCategory(article: Partial<ArticlePreview>): string {
  const text = `${article.title ?? ""} ${article.digest ?? ""}`;

  if (text.includes("百科")) {
    return "徒步百科";
  }

  if (text.includes("游记")) {
    return "徒步游记";
  }

  if (text.includes("领队") || text.includes("培训")) {
    return "领队培训";
  }

  if (text.includes("装备")) {
    return "装备知识";
  }

  if (text.includes("视频") || text.includes("影像") || text.includes("纪录片")) {
    return "影像合集";
  }

  if (text.includes("活动") || text.includes("报名") || text.includes("路线")) {
    return "徒步路线";
  }

  if (text.includes("公告") || text.includes("通知") || text.includes("新闻") || text.includes("动态")) {
    return "公司动态";
  }

  return "未分类";
}

function extractArticles(raw: WechatRawJson): Record<string, unknown>[] {
  const articles: Record<string, unknown>[] = [];
  const item = Array.isArray(raw.item) ? raw.item : [];

  for (const entry of item) {
    if (!isObject(entry)) {
      continue;
    }

    const mediaId = getString(entry.media_id);
    const publishTime = getNumberOrString(entry.publish_time) ?? getNumberOrString(entry.update_time);
    const articleId = getString(entry.article_id);
    const content = isObject(entry.content) ? entry.content : null;
    const newsItems = content && Array.isArray(content.news_item) ? content.news_item : null;

    if (newsItems) {
      for (const newsItem of newsItems) {
        if (isObject(newsItem)) {
          articles.push({
            ...newsItem,
            article_id: getString(newsItem.article_id) ?? articleId,
            media_id: getString(newsItem.media_id) ?? mediaId,
            publish_time: getNumberOrString(newsItem.publish_time) ?? publishTime,
          });
        }
      }
      continue;
    }

    articles.push({
      ...entry,
      article_id: articleId,
      media_id: mediaId,
      publish_time: publishTime,
    });
  }

  return articles;
}

function toPreview(article: Record<string, unknown>): ArticlePreview {
  const preview: Omit<ArticlePreview, "inferred_category"> = {
    title: getString(article.title),
    author: getString(article.author),
    digest: getString(article.digest),
    url: getString(article.url),
    content_source_url: getString(article.content_source_url),
    publish_time: getNumberOrString(article.publish_time),
    article_id: getString(article.article_id),
    media_id: getString(article.media_id),
    thumb_media_id: getString(article.thumb_media_id),
  };

  return {
    ...preview,
    inferred_category: inferCategory(preview),
  };
}

export async function getAccessToken(): Promise<AccessTokenResult> {
  const { appId, appSecret } = getWechatConfig();
  const url = `${TOKEN_API}?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const raw = await readJsonResponse(url);
  const accessToken = typeof raw.access_token === "string" ? raw.access_token : null;
  const tokenPreview = accessToken ? maskToken(accessToken) : null;
  const safeRaw = sanitizeTokenRaw(raw, tokenPreview);

  if (accessToken) {
    return {
      success: true,
      raw,
      safeRaw,
      accessToken,
      tokenPreview,
    };
  }

  const error = getWechatError(raw);

  return {
    success: false,
    raw,
    safeRaw,
    accessToken: null,
    tokenPreview: null,
    error,
    hint: getWechatErrorHint(error.errcode, error.errmsg),
  };
}

export async function getPublishedArticles(): Promise<PublishedArticlesResult> {
  const tokenResult = await getAccessToken();

  if (!tokenResult.success || !tokenResult.accessToken) {
    return {
      success: false,
      source: FREEPUBLISH_API_NAME,
      preview: [],
      accessToken: {
        tokenPreview: tokenResult.tokenPreview,
        raw: tokenResult.safeRaw,
      },
      error: tokenResult.error,
      hint: tokenResult.hint ?? "access_token 获取失败",
    };
  }

  const raw = await readJsonResponse(`${FREEPUBLISH_API}?access_token=${encodeURIComponent(tokenResult.accessToken)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(BATCH_BODY),
  });

  const preview = extractArticles(raw).map(toPreview);

  if (hasWechatError(raw)) {
    const error = getWechatError(raw);

    return {
      success: false,
      source: FREEPUBLISH_API_NAME,
      raw,
      preview,
      accessToken: {
        tokenPreview: tokenResult.tokenPreview,
        raw: tokenResult.safeRaw,
      },
      error,
      hint: getWechatErrorHint(error.errcode, error.errmsg),
    };
  }

  const itemCount = typeof raw.item_count === "number" ? raw.item_count : null;

  return {
    success: true,
    source: FREEPUBLISH_API_NAME,
    raw,
    preview,
    accessToken: {
      tokenPreview: tokenResult.tokenPreview,
      raw: tokenResult.safeRaw,
    },
    hint: itemCount === 0 ? "接口成功，但没有返回文章" : undefined,
  };
}
