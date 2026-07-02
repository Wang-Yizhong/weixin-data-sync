import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader } from "mysql2/promise";
import { cleanWechatArticle, type WechatArticleCleanerInput } from "../src/utils/wechatArticleCleaner.js";

type RawWechatJson = Record<string, unknown>;

type RawArticleItem = {
  articleId: string;
  mediaId: string | null;
  publishTime: number | string | null;
  newsItem: WechatArticleCleanerInput;
};

type ImportArticleReport = {
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

type ImportReport = {
  success: boolean;
  generatedAt: string;
  inputFilePath: string;
  databaseName: string | null;
  parsedArticleCount: number;
  selectedArticleCount: number;
  inserted: number;
  updated: number;
  failed: number;
  skipped: number;
  articles: ImportArticleReport[];
};

const envPath = resolve(process.cwd(), ".env");
dotenv.config({ path: envPath, quiet: true });

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

function parseJsonFile(filePath: string): RawWechatJson {
  const content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();

  try {
    return JSON.parse(content) as RawWechatJson;
  } catch {
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1)) as RawWechatJson;
    }

    throw new Error("输入文件不是有效 JSON，也没有找到可解析的 JSON 对象");
  }
}

function getFreepublishRaw(parsed: RawWechatJson): RawWechatJson {
  if (isObject(parsed.raw)) {
    return parsed.raw;
  }

  return parsed;
}

function extractArticles(raw: RawWechatJson): RawArticleItem[] {
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
        articleId,
        mediaId,
        publishTime,
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

async function getCurrentDatabaseName(connection: PoolConnection): Promise<string | null> {
  const [rows] = await connection.query("SELECT DATABASE() AS database_name");
  const firstRow = Array.isArray(rows) ? rows[0] : null;

  if (isObject(firstRow) && typeof firstRow.database_name === "string") {
    return firstRow.database_name;
  }

  return null;
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

async function ensureImportSchema(connection: PoolConnection): Promise<void> {
  const hasAuthorGroup = await columnExists(connection, "wechat_articles", "author_group");

  if (!hasAuthorGroup) {
    throw new Error("wechat_articles.author_group 字段不存在，请先执行 npm run setup:wechat-schema-dev");
  }
}

function assertDevDatabase(databaseName: string | null): void {
  const normalized = (databaseName ?? "").toLowerCase();

  if (!normalized.includes("dev") || normalized.includes("prod")) {
    throw new Error(`安全校验失败：当前数据库名为 ${databaseName ?? "<null>"}，必须包含 dev 且不能包含 prod`);
  }
}

async function importOneArticle(connection: PoolConnection, rawArticle: RawArticleItem): Promise<ImportArticleReport> {
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

    await connection.execute<ResultSetHeader>(
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

function writeReport(report: ImportReport): void {
  const jsonPath = resolve(process.cwd(), "data/reports/wechat-articles-file-import-dev-report.json");
  const mdPath = resolve(process.cwd(), "data/reports/wechat-articles-file-import-dev-report.md");

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, toMarkdown(report), "utf8");

  console.log(`JSON 报告：${jsonPath}`);
  console.log(`Markdown 报告：${mdPath}`);
}

function escapeMarkdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function toMarkdown(report: ImportReport): string {
  const lines = [
    "# 微信文章本地文件导入 dev 报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 输入文件：${report.inputFilePath}`,
    `- 数据库：${report.databaseName ?? ""}`,
    `- 是否成功：${report.success ? "是" : "否"}`,
    `- 解析文章数量：${report.parsedArticleCount}`,
    `- 本次选择导入数量：${report.selectedArticleCount}`,
    `- inserted：${report.inserted}`,
    `- updated：${report.updated}`,
    `- failed：${report.failed}`,
    `- skipped：${report.skipped}`,
    "",
    "| 标题 | 作者 | 作者分类 | 内容分类 | 标签 | 图片数 | 视频数 | 小程序卡片数 | 入库状态 | 错误信息 |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |",
  ];

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

function getLimitArg(argv: string[]): number | null {
  const rawLimit = argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length);

  if (!rawLimit) {
    return null;
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`无效 limit 参数：${rawLimit}`);
  }

  return limit;
}

async function main(): Promise<void> {
  const inputArg = process.argv[2];
  const limit = getLimitArg(process.argv.slice(3));

  if (!inputArg) {
    throw new Error("缺少输入文件路径。示例：npm run import:wechat-articles-file-dev -- ./data/raw/wechat-articles-result.txt");
  }

  const inputFilePath = resolve(process.cwd(), inputArg);

  if (!existsSync(inputFilePath)) {
    throw new Error(`输入文件不存在：${inputFilePath}`);
  }

  console.log("开始从本地文件导入微信公众号文章到 dev 数据库。");
  console.log("注意：本脚本不会调用微信公众号 API，不会打印 AppSecret 或 access_token。");
  console.log(`输入文件：${inputFilePath}`);

  const parsed = parseJsonFile(inputFilePath);
  const raw = getFreepublishRaw(parsed);
  const allArticles = extractArticles(raw);
  const articles = limit ? allArticles.slice(0, limit) : allArticles;
  const pool: Pool = mysql.createPool(getDatabaseConfig());
  const connection = await pool.getConnection();
  let databaseName: string | null = null;
  const articleReports: ImportArticleReport[] = [];

  try {
    databaseName = await getCurrentDatabaseName(connection);
    console.log(`当前数据库：${databaseName ?? "<null>"}`);
    assertDevDatabase(databaseName);
    console.log("安全校验通过：当前数据库名包含 dev，且不包含 prod。");
    await ensureImportSchema(connection);
    console.log(`解析文章数量：${allArticles.length}`);
    console.log(`本次选择导入数量：${articles.length}${limit ? `（--limit=${limit}）` : ""}`);

    for (const article of articles) {
      const report = await importOneArticle(connection, article);
      articleReports.push(report);
      console.log(`${report.status}: ${report.title ?? "<无标题>"}`);
    }
  } finally {
    connection.release();
    await pool.end();
  }

  const report: ImportReport = {
    success: articleReports.every((article) => article.status === "inserted" || article.status === "updated"),
    generatedAt: new Date().toISOString(),
    inputFilePath,
    databaseName,
    parsedArticleCount: allArticles.length,
    selectedArticleCount: articles.length,
    inserted: articleReports.filter((article) => article.status === "inserted").length,
    updated: articleReports.filter((article) => article.status === "updated").length,
    failed: articleReports.filter((article) => article.status === "failed").length,
    skipped: articleReports.filter((article) => article.status === "skipped").length,
    articles: articleReports,
  };

  writeReport(report);

  if (!report.success) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const inputArg = process.argv[2];
  const fallbackReport: ImportReport = {
    success: false,
    generatedAt: new Date().toISOString(),
    inputFilePath: inputArg ? resolve(process.cwd(), inputArg) : "",
    databaseName: null,
    parsedArticleCount: 0,
    selectedArticleCount: 0,
    inserted: 0,
    updated: 0,
    failed: 1,
    skipped: 0,
    articles: [
      {
        title: null,
        author: null,
        authorGroup: null,
        category: null,
        tags: [],
        imageCount: 0,
        videoCount: 0,
        miniProgramCount: 0,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
    ],
  };

  writeReport(fallbackReport);
  console.error("本地文件导入 dev 数据库失败：");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
