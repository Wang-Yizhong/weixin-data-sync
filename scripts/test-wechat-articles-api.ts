import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type EnvMap = Record<string, string>;

type WechatJson = Record<string, unknown>;

type ArticlePreview = {
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

const TOKEN_API = "https://api.weixin.qq.com/cgi-bin/token";
const FREEPUBLISH_API_NAME = "freepublish/batchget";
const DRAFT_API_NAME = "draft/batchget";
const BATCH_BODY = {
  offset: 0,
  count: 5,
  no_content: 0,
};

function loadEnvFile(fileName: string): EnvMap {
  const filePath = resolve(process.cwd(), fileName);

  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, "utf8");
  const env: EnvMap = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadDevEnv(): EnvMap {
  const envDev = loadEnvFile(".env.dev");
  const envFallback = loadEnvFile(".env");

  return {
    ...envFallback,
    ...envDev,
    ...process.env,
  } as EnvMap;
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

function hasWechatError(json: WechatJson): boolean {
  return typeof json.errcode === "number" && json.errcode !== 0;
}

function explainWechatError(errcode: unknown, errmsg: unknown): string {
  const code = typeof errcode === "number" ? errcode : null;
  const message = typeof errmsg === "string" ? errmsg : "";

  if (code === 40125 || message.includes("invalid appsecret")) {
    return "可能原因：AppSecret 错误，请检查 WECHAT_APP_SECRET。";
  }

  if (code === 40164 || message.includes("invalid ip")) {
    return "可能原因：当前服务器出口 IP 未加入公众号 IP 白名单。";
  }

  if (code === 40013 || message.includes("invalid appid")) {
    return "可能原因：AppID 错误，请检查 WECHAT_APP_ID。";
  }

  if (code === 48001 || message.includes("api unauthorized")) {
    return "可能原因：接口权限不足，公众号类型或权限未开通。";
  }

  if (code === 45009) {
    return "可能原因：接口调用频率达到上限，请稍后重试。";
  }

  if (code === -1) {
    return "可能原因：微信系统繁忙，请稍后重试。";
  }

  return "可能原因：请结合 errcode / errmsg 查询微信公众平台接口文档。";
}

function inferCategory(article: Partial<ArticlePreview>): string {
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

function extractArticles(json: WechatJson): Record<string, unknown>[] {
  const articles: Record<string, unknown>[] = [];
  const item = Array.isArray(json.item) ? json.item : [];

  for (const entry of item) {
    if (!isObject(entry)) {
      continue;
    }

    const mediaId = getString(entry.media_id);
    const publishTime = getNumberOrString(entry.publish_time) ?? getNumberOrString(entry.update_time);

    const content = isObject(entry.content) ? entry.content : null;
    const newsItems = content && Array.isArray(content.news_item) ? content.news_item : null;

    if (newsItems) {
      for (const newsItem of newsItems) {
        if (isObject(newsItem)) {
          articles.push({
            ...newsItem,
            media_id: getString(newsItem.media_id) ?? mediaId,
            publish_time: getNumberOrString(newsItem.publish_time) ?? publishTime,
          });
        }
      }
      continue;
    }

    articles.push({
      ...entry,
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

async function readJsonResponse(url: string, init?: RequestInit): Promise<WechatJson> {
  const response = await fetch(url, init);
  const text = await response.text();

  try {
    return JSON.parse(text) as WechatJson;
  } catch {
    return {
      errcode: -999999,
      errmsg: `HTTP ${response.status} 返回内容不是 JSON`,
      raw_response: text,
    };
  }
}

async function getAccessToken(appId: string, appSecret: string): Promise<string | null> {
  const url = `${TOKEN_API}?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const json = await readJsonResponse(url);

  if (typeof json.access_token === "string" && json.access_token.length > 0) {
    console.log(`access_token 获取状态：成功 (${maskToken(json.access_token)})`);
    return json.access_token;
  }

  console.log("access_token 获取状态：失败");
  console.log(`errcode: ${String(json.errcode ?? "未知")}`);
  console.log(`errmsg: ${String(json.errmsg ?? "未知")}`);
  console.log(explainWechatError(json.errcode, json.errmsg));
  console.log("完整响应：");
  console.dir(json, { depth: null });

  return null;
}

async function batchGetArticles(apiName: string, accessToken: string): Promise<WechatJson> {
  const url = `https://api.weixin.qq.com/cgi-bin/${apiName}?access_token=${encodeURIComponent(accessToken)}`;

  console.log("");
  console.log(`实际调用接口：${apiName}`);
  console.log("请求 body：");
  console.dir(BATCH_BODY, { depth: null });

  const json = await readJsonResponse(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(BATCH_BODY),
  });

  console.log("原始 JSON：");
  console.dir(json, { depth: null });

  return json;
}

function printPreview(apiName: string, json: WechatJson): void {
  const articles = extractArticles(json);

  if (articles.length === 0) {
    console.log("");
    console.log("简化文章预览：[]");
    console.log("提示：没有解析到文章列表。可能是公众号没有已发布文章/草稿，或返回结构和预期不一致。");
    return;
  }

  const previews = articles.map(toPreview);

  console.log("");
  console.log(`简化文章预览（来源：${apiName}）：`);
  console.dir(previews, { depth: null });
}

async function main(): Promise<void> {
  console.log("当前环境：dev");

  if (!existsSync(resolve(process.cwd(), ".env.dev"))) {
    console.log("提示：未找到 .env.dev，当前将兼容读取 .env。建议后续将开发环境变量放入 .env.dev。");
  }

  const env = loadDevEnv();
  const appId = env.WECHAT_APP_ID;
  const appSecret = env.WECHAT_APP_SECRET;

  if (!appId || !appSecret) {
    console.error("错误：WECHAT_APP_ID 或 WECHAT_APP_SECRET 缺失。");
    console.error("请在 .env.dev 中配置 WECHAT_APP_ID 和 WECHAT_APP_SECRET。");
    process.exitCode = 1;
    return;
  }

  const accessToken = await getAccessToken(appId, appSecret);

  if (!accessToken) {
    console.log("已停止调用文章接口：access_token 获取失败。");
    process.exitCode = 1;
    return;
  }

  const freepublishJson = await batchGetArticles(FREEPUBLISH_API_NAME, accessToken);
  let finalApiName = FREEPUBLISH_API_NAME;
  let finalJson = freepublishJson;

  if (hasWechatError(freepublishJson)) {
    console.log("");
    console.log(`${FREEPUBLISH_API_NAME} 调用失败。`);
    console.log(`失败原因：errcode=${String(freepublishJson.errcode)}, errmsg=${String(freepublishJson.errmsg)}`);
    console.log(explainWechatError(freepublishJson.errcode, freepublishJson.errmsg));
    console.log("继续尝试草稿箱接口作为兜底。");

    const draftJson = await batchGetArticles(DRAFT_API_NAME, accessToken);
    finalApiName = DRAFT_API_NAME;
    finalJson = draftJson;

    if (hasWechatError(draftJson)) {
      console.log("");
      console.log(`${DRAFT_API_NAME} 调用失败。`);
      console.log(`失败原因：errcode=${String(draftJson.errcode)}, errmsg=${String(draftJson.errmsg)}`);
      console.log(explainWechatError(draftJson.errcode, draftJson.errmsg));
    }
  }

  printPreview(finalApiName, finalJson);
}

main().catch((error: unknown) => {
  console.error("脚本执行失败：");
  console.error(error);
  console.error("可能原因：网络不可达、DNS/代理问题、Node.js 版本过低或微信接口暂时不可用。");
  process.exitCode = 1;
});
