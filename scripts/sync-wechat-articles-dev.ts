import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { cleanWechatArticle, type WechatArticleCleanerInput } from "../src/utils/wechatArticleCleaner.js";

type WechatRawJson = Record<string, unknown>;

type RawArticleItem = {
  articleId: string;
  mediaId: string | null;
  publishTime: number | string | null;
  newsItem: WechatArticleCleanerInput;
};

type PageReport = {
  page: number;
  offset: number;
  count: number;
  itemCount: number;
  totalCount: number | null;
  fetchedTotal: number;
  error: string | null;
};

type ArticleSyncReport = {
  title: string | null;
  author: string | null;
  authorGroup: string | null;
  category: string | null;
  tags: string[];
  imageCount: number;
  videoCount: number;
  miniProgramCount: number;
  status: "inserted" | "updated" | "failed" | "skipped";
  error: string | null;
};

type FullSyncReport = {
  success: boolean;
  generatedAt: string;
  publicIp: string | null;
  databaseName: string | null;
  totalCount: number | null;
  fetchedCount: number;
  pageCount: number;
  inserted: number;
  updated: number;
  failed: number;
  skipped: number;
  pages: PageReport[];
  articles: ArticleSyncReport[];
  error?: string | null;
};

const envPath = resolve(process.cwd(), ".env");
dotenv.config({ path: envPath, quiet: true });

const TOKEN_API = "https://api.weixin.qq.com/cgi-bin/token";
const FREEPUBLISH_API = "https://api.weixin.qq.com/cgi-bin/freepublish/batchget";
const PAGE_COUNT = 20;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getNumberOrString(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  return null;
}

function maskToken(token: string): string {
  return `${token.slice(0, 8)}...`;
}

function getDatabaseConfig(): mysql.PoolOptions {
  const databaseUrl = process.env.DEV_DATABASE_URL ?? process.env.DATABASE_URL;

  if (databaseUrl) {
    return {
      uri: databaseUrl,
      waitForConnections: true,
      connectionLimit: 5,
      namedPlaceholders: false,
    };
  }

  return {
    host: process.env.DEV_MYSQL_HOST ?? process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.DEV_MYSQL_PORT ?? process.env.MYSQL_PORT ?? 3306),
    user: process.env.DEV_MYSQL_USER ?? process.env.MYSQL_USER,
    password: process.env.DEV_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD,
    database: process.env.DEV_MYSQL_DATABASE ?? process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
    namedPlaceholders: false,
  };
}

async function getPublicIp(): Promise<string | null> {
  for (const url of ["https://api.ipify.org", "https://ifconfig.me/ip"]) {
    try {
      const response = await fetch(url);
      const text = (await response.text()).trim();

      if (response.ok && text) {
        return text;
      }
    } catch {
      // Try the next provider.
    }
  }

  return null;
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

function getWechatError(raw: WechatRawJson): string | null {
  const errcode = raw.errcode;
  const errmsg = raw.errmsg;

  if (typeof errcode === "number" && errcode !== 0) {
    return `errcode=${errcode}, errmsg=${String(errmsg ?? "")}`;
  }

  return null;
}

async function getAccessToken(): Promise<string> {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("WECHAT_APP_ID 或 WECHAT_APP_SECRET 缺失");
  }

  const url = `${TOKEN_API}?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const raw = await readJsonResponse(url);
  const token = getString(raw.access_token);

  if (!token) {
    throw new Error(`access_token 获取失败：${getWechatError(raw) ?? JSON.stringify(raw)}`);
  }

  console.log(`access_token 获取成功：${maskToken(token)}`);
  return token;
}

async function batchGetPublishedArticles(accessToken: string, offset: number, count: number): Promise<WechatRawJson> {
  return readJsonResponse(`${FREEPUBLISH_API}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      offset,
      count,
      no_content: 0,
    }),
  });
}

function extractArticles(raw: WechatRawJson): RawArticleItem[] {
  const articles: RawArticleItem[] = [];
  const item = Array.isArray(raw.item) ? raw.item : [];

  for (const entry of item) {
    if (!isObject(entry)) {
      continue;
    }

    const articleId = getString(entry.article_id);
    const mediaId = getString(entry.media_id);
    const publishTime = getNumberOrString(entry.publish_time) ?? getNumberOrString(entry.update_time);
    const content = isObject(entry.content) ? entry.content : null;
    const newsItems = content && Array.isArray(content.news_item) ? content.news_item : [];

    if (!articleId) {
      continue;
    }

    for (const newsItem of newsItems) {
      if (!isObject(newsItem)) {
        continue;
      }

      articles.push({
        articleId: getString(newsItem.article_id) ?? articleId,
        mediaId: getString(newsItem.media_id) ?? mediaId,
        publishTime: getNumberOrString(newsItem.publish_time) ?? publishTime,
        newsItem: {
          title: getString(newsItem.title),
          author: getString(newsItem.author),
          digest: getString(newsItem.digest),
          content: getString(newsItem.content),
          url: getString(newsItem.url),
          content_source_url: getString(newsItem.content_source_url),
          thumb_url: getString(newsItem.thumb_url),
          publish_time: getNumberOrString(newsItem.publish_time) ?? publishTime,
          article_id: getString(newsItem.article_id) ?? articleId,
          media_id: getString(newsItem.media_id) ?? mediaId,
        },
      });
    }
  }

  return articles;
}

function toMysqlDatetime(value: number | string | null): string | null {
  if (value === null || value === "") {
    return null;
  }

  const numericValue = typeof value === "string" ? Number(value) : value;
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue > 10_000_000_000 ? numericValue : numericValue * 1000)
    : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const pad = (part: number) => String(part).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function getCurrentDatabaseName(connection: PoolConnection): Promise<string | null> {
  const [rows] = await connection.query("SELECT DATABASE() AS database_name");
  const firstRow = Array.isArray(rows) ? rows[0] : null;

  if (isObject(firstRow) && typeof firstRow.database_name === "string") {
    return firstRow.database_name;
  }

  return null;
}

function assertTububangDevDatabase(databaseName: string | null): void {
  const normalized = (databaseName ?? "").toLowerCase();

  if (normalized !== "tububang_dev" || !normalized.includes("dev") || normalized.includes("prod")) {
    throw new Error(`安全校验失败：当前数据库名为 ${databaseName ?? "<null>"}，必须是 tububang_dev`);
  }
}

async function columnExists(connection: PoolConnection, tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  const firstRow = Array.isArray(rows) ? rows[0] : null;

  return isObject(firstRow) && Number(firstRow.count) > 0;
}

async function ensureSyncSchema(connection: PoolConnection): Promise<void> {
  const hasAuthorGroup = await columnExists(connection, "wechat_articles", "author_group");

  if (!hasAuthorGroup) {
    throw new Error("wechat_articles.author_group 字段不存在，请先执行 npm run setup:wechat-schema-dev");
  }
}

async function syncOneArticle(connection: PoolConnection, rawArticle: RawArticleItem): Promise<ArticleSyncReport> {
  const cleaned = cleanWechatArticle(rawArticle.newsItem);
  const imageCount = cleaned.assets.filter((asset) => asset.assetType === "image").length;
  const videoCount = cleaned.assets.filter((asset) => asset.assetType === "video").length;
  const miniProgramCount = cleaned.assets.filter((asset) => asset.assetType === "mini_program").length;
  const baseReport = {
    title: rawArticle.newsItem.title ?? null,
    author: rawArticle.newsItem.author ?? null,
    authorGroup: cleaned.authorGroup,
    category: cleaned.detectedCategory,
    tags: cleaned.detectedTags,
    imageCount,
    videoCount,
    miniProgramCount,
  };

  if (!rawArticle.articleId || !rawArticle.newsItem.title) {
    return {
      ...baseReport,
      status: "skipped",
      error: "缺少 wechat_article_id 或 article_title",
    };
  }

  await connection.beginTransaction();

  try {
    const [existingRows] = await connection.execute(
      "SELECT id FROM wechat_articles WHERE wechat_article_id = ? LIMIT 1",
      [rawArticle.articleId],
    );
    const existed = Array.isArray(existingRows) && existingRows.length > 0;

    await connection.execute(
      `INSERT INTO wechat_articles (
        wechat_article_id,
        wechat_media_id,
        article_title,
        article_author,
        author_group,
        article_digest,
        article_cover_url,
        wechat_article_url,
        original_source_url,
        raw_wechat_html,
        clean_content_html,
        plain_text_content,
        ai_summary,
        primary_category,
        content_tags,
        content_type,
        publish_time,
        sync_status,
        last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NOW())
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        wechat_media_id = VALUES(wechat_media_id),
        article_title = VALUES(article_title),
        article_author = VALUES(article_author),
        author_group = VALUES(author_group),
        article_digest = VALUES(article_digest),
        article_cover_url = VALUES(article_cover_url),
        wechat_article_url = VALUES(wechat_article_url),
        original_source_url = VALUES(original_source_url),
        raw_wechat_html = VALUES(raw_wechat_html),
        clean_content_html = VALUES(clean_content_html),
        plain_text_content = VALUES(plain_text_content),
        ai_summary = VALUES(ai_summary),
        primary_category = VALUES(primary_category),
        content_tags = VALUES(content_tags),
        content_type = VALUES(content_type),
        publish_time = VALUES(publish_time),
        sync_status = 'synced',
        last_sync_at = NOW()`,
      [
        rawArticle.articleId,
        rawArticle.mediaId,
        rawArticle.newsItem.title,
        rawArticle.newsItem.author ?? null,
        cleaned.authorGroup,
        rawArticle.newsItem.digest ?? null,
        rawArticle.newsItem.thumb_url ?? null,
        rawArticle.newsItem.url ?? null,
        rawArticle.newsItem.content_source_url ?? null,
        cleaned.rawWechatHtml,
        cleaned.cleanContentHtml,
        cleaned.plainTextContent,
        cleaned.aiSummary,
        cleaned.detectedCategory,
        JSON.stringify(cleaned.detectedTags),
        cleaned.contentType,
        toMysqlDatetime(rawArticle.publishTime),
      ],
    );

    const [articleIdRows] = await connection.execute("SELECT LAST_INSERT_ID() AS article_id");
    const articleIdRow = Array.isArray(articleIdRows) ? articleIdRows[0] : null;
    const articleDatabaseId = isObject(articleIdRow) ? Number(articleIdRow.article_id) : NaN;

    if (!Number.isFinite(articleDatabaseId) || articleDatabaseId <= 0) {
      throw new Error("无法获取 wechat_articles.id");
    }

    await connection.execute("DELETE FROM wechat_article_assets WHERE article_id = ?", [articleDatabaseId]);

    for (const asset of cleaned.assets) {
      await connection.execute(
        `INSERT INTO wechat_article_assets (
          article_id,
          asset_type,
          asset_url,
          original_asset_url,
          asset_title,
          asset_description,
          asset_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          articleDatabaseId,
          asset.assetType,
          asset.assetUrl,
          asset.originalAssetUrl,
          asset.assetTitle,
          asset.assetDescription,
          asset.assetOrder,
        ],
      );
    }

    await connection.commit();

    return {
      ...baseReport,
      status: existed ? "updated" : "inserted",
      error: null,
    };
  } catch (error) {
    await connection.rollback();

    return {
      ...baseReport,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function escapeMarkdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function toMarkdown(report: FullSyncReport): string {
  const lines = [
    "# 微信文章全量同步 dev 报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 出口 IP：${report.publicIp ?? ""}`,
    `- 数据库：${report.databaseName ?? ""}`,
    `- 是否成功：${report.success ? "是" : "否"}`,
    `- total_count：${report.totalCount ?? ""}`,
    `- fetched_count：${report.fetchedCount}`,
    `- page_count：${report.pageCount}`,
    `- inserted：${report.inserted}`,
    `- updated：${report.updated}`,
    `- failed：${report.failed}`,
    `- skipped：${report.skipped}`,
  ];

  if (report.error) {
    lines.push(`- 错误：${report.error}`);
  }

  lines.push("");
  lines.push("## 分页");
  lines.push("");
  lines.push("| page | offset | count | item_count | total_count | fetched_total | 错误 |");
  lines.push("| ---: | ---: | ---: | ---: | ---: | ---: | --- |");

  for (const page of report.pages) {
    lines.push(
      [
        page.offset,
        page.count,
        page.itemCount,
        page.totalCount ?? "",
        page.fetchedTotal,
        page.error ?? "",
      ]
        .map(escapeMarkdownCell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }

  lines.push("");
  lines.push("## 文章");
  lines.push("");
  lines.push("| 标题 | 作者 | 作者分类 | 内容分类 | 标签 | 图片数 | 视频数 | 小程序卡片数 | 入库状态 | 错误信息 |");
  lines.push("| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |");

  for (const article of report.articles) {
    lines.push(
      [
        article.title,
        article.author,
        article.authorGroup,
        article.category,
        article.tags.join(", "),
        article.imageCount,
        article.videoCount,
        article.miniProgramCount,
        article.status,
        article.error,
      ]
        .map(escapeMarkdownCell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }

  return `${lines.join("\n")}\n`;
}

function writeReport(report: FullSyncReport): void {
  const jsonPath = resolve(process.cwd(), "data/reports/wechat-articles-full-sync-dev-report.json");
  const mdPath = resolve(process.cwd(), "data/reports/wechat-articles-full-sync-dev-report.md");

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, toMarkdown(report), "utf8");

  console.log(`JSON 报告：${jsonPath}`);
  console.log(`Markdown 报告：${mdPath}`);
}

function summarizeReport(report: FullSyncReport): FullSyncReport {
  return {
    ...report,
    pageCount: report.pages.length,
    inserted: report.articles.filter((article) => article.status === "inserted").length,
    updated: report.articles.filter((article) => article.status === "updated").length,
    failed: report.articles.filter((article) => article.status === "failed").length,
    skipped: report.articles.filter((article) => article.status === "skipped").length,
  };
}

function printFinalSummary(report: FullSyncReport): void {
  console.log("================================");
  console.log("Final Summary");
  console.log(`total_count: ${report.totalCount ?? "<missing>"}`);
  console.log(`fetched_count: ${report.fetchedCount}`);
  console.log(`page_count: ${report.pageCount}`);
  console.log(`inserted: ${report.inserted}`);
  console.log(`updated: ${report.updated}`);
  console.log(`failed: ${report.failed}`);
  console.log(`skipped: ${report.skipped}`);
  console.log("================================");
}

async function main(): Promise<void> {
  console.log("开始同步微信公众号已发布文章到 tububang_dev。");
  console.log("注意：不打印 AppSecret 或完整 access_token，不 drop，不 truncate，不删除已有文章。");

  const publicIp = await getPublicIp();
  console.log(`当前出口 IP：${publicIp ?? "<unknown>"}`);
  console.log(`WECHAT_APP_ID exists: ${Boolean(process.env.WECHAT_APP_ID)}`);
  console.log(`WECHAT_APP_SECRET exists: ${Boolean(process.env.WECHAT_APP_SECRET)}`);

  const pool: Pool = mysql.createPool(getDatabaseConfig());
  const connection = await pool.getConnection();
  let databaseName: string | null = null;
  let report: FullSyncReport = {
    success: false,
    generatedAt: new Date().toISOString(),
    publicIp,
    databaseName: null,
    totalCount: null,
    fetchedCount: 0,
    pageCount: 0,
    inserted: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    pages: [],
    articles: [],
    error: null,
  };

  try {
    databaseName = await getCurrentDatabaseName(connection);
    report.databaseName = databaseName;
    console.log(`当前数据库：${databaseName ?? "<null>"}`);
    assertTububangDevDatabase(databaseName);
    await ensureSyncSchema(connection);
    console.log("数据库安全校验通过：当前数据库必须是 tububang_dev。");

    const accessToken = await getAccessToken();
    let offset = 0;
    let totalCount: number | null = null;
    let fetchedItemCount = 0;
    let pageIndex = 1;

    while (totalCount === null || offset < totalCount) {
      console.log("================================");
      console.log(`Page ${pageIndex}`);
      console.log(`offset: ${offset}`);
      console.log(`count: ${PAGE_COUNT}`);
      const raw = await batchGetPublishedArticles(accessToken, offset, PAGE_COUNT);
      const pageError = getWechatError(raw);
      const itemCount = getNumber(raw.item_count);
      const pageTotalCount = getNumber(raw.total_count);

      if (pageTotalCount === null) {
        throw new Error("Warning: 微信接口没有返回 total_count，停止同步，避免猜测分页终点");
      }

      totalCount = pageTotalCount;
      report.totalCount = totalCount;
      fetchedItemCount += itemCount ?? 0;

      report.pages.push({
        page: pageIndex,
        offset,
        count: PAGE_COUNT,
        itemCount: itemCount ?? 0,
        totalCount: pageTotalCount,
        fetchedTotal: fetchedItemCount,
        error: pageError,
      });

      console.log(`item_count: ${itemCount ?? "<missing>"}`);
      console.log(`total_count: ${totalCount}`);
      console.log(`fetched_total: ${fetchedItemCount}`);
      console.log("================================");

      if (pageError) {
        throw new Error(`freepublish/batchget 失败：${pageError}`);
      }

      const pageArticles = extractArticles(raw);
      report.fetchedCount += pageArticles.length;

      for (const article of pageArticles) {
        const articleReport = await syncOneArticle(connection, article);
        report.articles.push(articleReport);
        console.log(`${articleReport.status}: ${articleReport.title ?? "<无标题>"}`);
      }

      if (itemCount === null) {
        throw new Error("Warning: 微信接口没有返回 item_count，停止同步，避免猜测下一页 offset");
      }

      if (itemCount === 0) {
        console.log("item_count == 0，停止分页同步。");
        break;
      }

      offset += itemCount;
      pageIndex += 1;

      if (offset >= totalCount) {
        console.log(`offset >= total_count (${offset} >= ${totalCount})，分页正常结束。`);
      }
    }

    report = summarizeReport({
      ...report,
      success: report.articles.every((article) => article.status === "inserted" || article.status === "updated"),
      error: null,
    });
  } catch (error) {
    report = summarizeReport({
      ...report,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
    printFinalSummary(report);
    writeReport(report);
  }
}

main().catch((error: unknown) => {
  const report: FullSyncReport = {
    success: false,
    generatedAt: new Date().toISOString(),
    publicIp: null,
    databaseName: null,
    totalCount: null,
    fetchedCount: 0,
    pageCount: 0,
    inserted: 0,
    updated: 0,
    failed: 1,
    skipped: 0,
    pages: [],
    articles: [],
    error: error instanceof Error ? error.message : String(error),
  };

  writeReport(report);
  console.error("微信公众号文章全量同步失败：");
  console.error(report.error);
  process.exitCode = 1;
});
