import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";
import { cleanWechatArticle, type WechatArticleCleanerInput } from "../src/utils/wechatArticleCleaner.js";
import { getPublishedArticles, getWechatApiDebugInfo, type WechatRawJson } from "../src/services/wechat.service.js";

const envPath = resolve(process.cwd(), ".env");
const envResult = dotenv.config({ path: envPath, quiet: true });

type ReportArticle = {
  title: string | null;
  author: string | null;
  publishTime: number | string | null;
  rawHtmlLength: number;
  cleanHtmlLength: number;
  plainTextLength: number;
  aiSummary: string;
  detectedCategory: string;
  detectedTags: string[];
  contentType: string;
  imageCount: number;
  videoCount: number;
  miniProgramCount: number;
  wechatArticleUrl: string | null;
};

type PreviewReport = {
  success: boolean;
  generatedAt: string;
  source: string;
  articleCount: number;
  articles: ReportArticle[];
  error?: unknown;
  hint?: string;
};

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

function extractWechatArticles(raw: WechatRawJson): WechatArticleCleanerInput[] {
  const articles: WechatArticleCleanerInput[] = [];
  const item = Array.isArray(raw.item) ? raw.item : [];

  for (const entry of item) {
    if (!isObject(entry)) {
      continue;
    }

    const content = isObject(entry.content) ? entry.content : null;
    const newsItems = content && Array.isArray(content.news_item) ? content.news_item : [];
    const fallbackPublishTime = getNumberOrString(entry.publish_time) ?? getNumberOrString(entry.update_time);
    const fallbackArticleId = getString(entry.article_id);
    const fallbackMediaId = getString(entry.media_id);

    for (const newsItem of newsItems) {
      if (!isObject(newsItem)) {
        continue;
      }

      articles.push({
        title: getString(newsItem.title),
        author: getString(newsItem.author),
        digest: getString(newsItem.digest),
        content: getString(newsItem.content),
        url: getString(newsItem.url),
        content_source_url: getString(newsItem.content_source_url),
        thumb_url: getString(newsItem.thumb_url),
        publish_time: getNumberOrString(newsItem.publish_time) ?? fallbackPublishTime,
        article_id: getString(newsItem.article_id) ?? fallbackArticleId,
        media_id: getString(newsItem.media_id) ?? fallbackMediaId,
      });
    }
  }

  return articles;
}

function buildReportArticle(article: WechatArticleCleanerInput): ReportArticle {
  const cleaned = cleanWechatArticle(article);

  return {
    title: article.title ?? null,
    author: article.author ?? null,
    publishTime: article.publish_time ?? null,
    rawHtmlLength: cleaned.rawWechatHtml.length,
    cleanHtmlLength: cleaned.cleanContentHtml.length,
    plainTextLength: cleaned.plainTextContent.length,
    aiSummary: cleaned.aiSummary,
    detectedCategory: cleaned.detectedCategory,
    detectedTags: cleaned.detectedTags,
    contentType: cleaned.contentType,
    imageCount: cleaned.assets.filter((asset) => asset.assetType === "image").length,
    videoCount: cleaned.assets.filter((asset) => asset.assetType === "video").length,
    miniProgramCount: cleaned.assets.filter((asset) => asset.assetType === "mini_program").length,
    wechatArticleUrl: article.url ?? null,
  };
}

function escapeMarkdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function toMarkdown(report: PreviewReport): string {
  const lines = [
    "# 微信文章清洗预览报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 来源接口：${report.source}`,
    `- 是否成功：${report.success ? "是" : "否"}`,
    `- 文章数量：${report.articleCount}`,
  ];

  if (!report.success) {
    lines.push(`- 错误信息：${escapeMarkdownCell(JSON.stringify(report.error ?? null))}`);
    lines.push(`- 提示：${report.hint ?? ""}`);
  }

  lines.push("");
  lines.push("| 标题 | 作者 | 发布时间 | 原始HTML长度 | 清洗HTML长度 | 纯文本长度 | 摘要 | 初判分类 | 标签 | 内容类型 | 图片数 | 视频数 | 小程序卡片数 | 微信原文链接 |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | ---: | ---: | ---: | --- |");

  for (const article of report.articles) {
    lines.push(
      [
        article.title,
        article.author,
        article.publishTime,
        article.rawHtmlLength,
        article.cleanHtmlLength,
        article.plainTextLength,
        article.aiSummary,
        article.detectedCategory,
        article.detectedTags.join(", "),
        article.contentType,
        article.imageCount,
        article.videoCount,
        article.miniProgramCount,
        article.wechatArticleUrl,
      ]
        .map(escapeMarkdownCell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }

  return `${lines.join("\n")}\n`;
}

function writeReport(report: PreviewReport): void {
  const jsonPath = resolve(process.cwd(), "data/reports/wechat-article-clean-preview.json");
  const mdPath = resolve(process.cwd(), "data/reports/wechat-article-clean-preview.md");

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, toMarkdown(report), "utf8");

  console.log(`JSON 报告：${jsonPath}`);
  console.log(`Markdown 报告：${mdPath}`);
}

async function getPublicIp(): Promise<string | null> {
  const urls = ["https://api.ipify.org", "https://ifconfig.me/ip"];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      const text = (await response.text()).trim();

      if (response.ok && text) {
        return text;
      }
    } catch {
      // Try the next public IP provider.
    }
  }

  return null;
}

async function printRuntimeDebugInfo(): Promise<void> {
  const publicIp = await getPublicIp();
  const apiDebugInfo = getWechatApiDebugInfo();

  console.log("运行环境排查信息：");
  console.dir(
    {
      publicIp,
      cwd: process.cwd(),
      nodeEnv: process.env.NODE_ENV ?? null,
      platform: process.platform,
      envFile: {
        path: envPath,
        exists: existsSync(envPath),
        loaded: !envResult.error,
        error: envResult.error?.message ?? null,
      },
      envExists: {
        WECHAT_APP_ID: apiDebugInfo.appIdExists,
        WECHAT_APP_SECRET: apiDebugInfo.appSecretExists,
      },
      proxyEnvExists: {
        HTTP_PROXY: Boolean(process.env.HTTP_PROXY),
        HTTPS_PROXY: Boolean(process.env.HTTPS_PROXY),
        ALL_PROXY: Boolean(process.env.ALL_PROXY),
        NO_PROXY: Boolean(process.env.NO_PROXY),
      },
      wechatApi: {
        tokenApiUrl: apiDebugInfo.tokenApiUrl,
        publishedArticlesApiUrl: apiDebugInfo.publishedArticlesApiUrl,
      },
    },
    { depth: null },
  );
}

async function main(): Promise<void> {
  console.log("开始拉取微信公众号已发布文章并生成清洗预览。");
  console.log("注意：本脚本不入库，不打印 AppSecret 或完整 access_token。");
  await printRuntimeDebugInfo();

  const result = await getPublishedArticles();

  if (!result.success || !result.raw) {
    const report: PreviewReport = {
      success: false,
      generatedAt: new Date().toISOString(),
      source: result.source,
      articleCount: 0,
      articles: [],
      error: result.error ?? null,
      hint: result.hint,
    };

    writeReport(report);
    process.exitCode = 1;
    return;
  }

  const articles = extractWechatArticles(result.raw).slice(0, 10);
  const reportArticles = articles.map(buildReportArticle);
  const report: PreviewReport = {
    success: true,
    generatedAt: new Date().toISOString(),
    source: result.source,
    articleCount: reportArticles.length,
    articles: reportArticles,
    hint: result.hint,
  };

  writeReport(report);
  console.log(`清洗预览完成，共处理 ${report.articleCount} 篇文章。`);
}

main().catch((error: unknown) => {
  const report: PreviewReport = {
    success: false,
    generatedAt: new Date().toISOString(),
    source: "freepublish/batchget",
    articleCount: 0,
    articles: [],
    error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
    hint: "脚本执行失败，请检查环境变量、服务器网络和微信公众号接口权限",
  };

  writeReport(report);
  console.error("清洗预览脚本执行失败。");
  process.exitCode = 1;
});
