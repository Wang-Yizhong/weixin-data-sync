import * as cheerio from "cheerio";

export type WechatArticleCleanerInput = {
  title?: string | null;
  author?: string | null;
  digest?: string | null;
  content?: string | null;
  url?: string | null;
  content_source_url?: string | null;
  thumb_url?: string | null;
  publish_time?: number | string | null;
  article_id?: string | null;
  media_id?: string | null;
};

export type CleanedArticleAsset = {
  assetType: "image" | "video" | "mini_program" | "link";
  assetUrl: string | null;
  originalAssetUrl: string | null;
  assetTitle: string | null;
  assetDescription: string | null;
  assetOrder: number;
};

export type CleanedWechatArticle = {
  rawWechatHtml: string;
  cleanContentHtml: string;
  plainTextContent: string;
  aiSummary: string;
  detectedCategory: string;
  authorGroup: string;
  detectedTags: string[];
  contentType: "article" | "video" | "gallery" | "training" | "announcement";
  assets: CleanedArticleAsset[];
};

const ALLOWED_TAGS = new Set([
  "p",
  "section",
  "div",
  "span",
  "br",
  "strong",
  "b",
  "em",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "img",
  "a",
]);

const ALLOWED_ATTRIBUTES_BY_TAG: Record<string, Set<string>> = {
  img: new Set(["src", "alt", "title", "width", "height", "style", "class", "data-src"]),
  a: new Set(["href", "title", "target", "rel", "style", "class"]),
  default: new Set(["style", "class"]),
};

const TAG_KEYWORDS = [
  "贡嘎",
  "川西",
  "四姑娘山",
  "雨崩",
  "武功山",
  "冈仁波齐",
  "尼泊尔",
  "新疆",
  "西藏",
  "云南",
  "青海",
  "甘南",
  "长白山",
  "黄山",
  "恩施",
  "户外",
  "徒步",
  "露营",
  "登山",
  "穿越",
  "装备",
  "高反",
  "登山杖",
  "领队培训",
  "中级班",
  "初级班",
  "航拍",
  "视频",
];

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function compactPlainText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function detectCategory(text: string): string {
  if (includesAny(text, ["领队", "培训", "中级班", "初级班"])) {
    return "领队培训";
  }

  if (includesAny(text, ["知识库", "百科", "装备", "徒步技巧", "高反", "登山杖"])) {
    return "户外百科";
  }

  if (includesAny(text, ["游记", "穿越", "徒步记录", "故事"])) {
    return "徒步游记";
  }

  if (includesAny(text, ["目的地", "推荐", "季节", "路线推荐"])) {
    return "目的地推荐";
  }

  if (includesAny(text, ["十年", "品牌", "徒步中国", "我们"])) {
    return "品牌故事";
  }

  if (includesAny(text, ["活动", "报名", "名额", "开班", "福利"])) {
    return "活动公告";
  }

  if (includesAny(text, ["视频", "影像", "照片", "航拍"])) {
    return "影像合集";
  }

  return "未分类";
}

function detectTags(text: string): string[] {
  return TAG_KEYWORDS.filter((keyword) => text.includes(keyword));
}

export function detectAuthorGroup(author?: string | null, title?: string | null, content?: string | null): string {
  const normalizedAuthor = author?.trim() ?? "";
  const titleAndContent = `${title ?? ""} ${content ?? ""}`;

  if (!normalizedAuthor) {
    return "未知作者";
  }

  if (includesAny(normalizedAuthor, ["徒步中国", "徒步帮", "编辑部", "官方"])) {
    return "官方编辑部";
  }

  if (includesAny(normalizedAuthor, ["领队", "教练", "向导", "培训"])) {
    return "领队/教练";
  }

  if (includesAny(titleAndContent, ["投稿", "游记", "作者", "分享"])) {
    return "用户投稿";
  }

  return "外部作者";
}

function sanitizeUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("#")) {
    return trimmed;
  }

  return null;
}

function sanitizeHtml(rawHtml: string): { cleanHtml: string; assets: CleanedArticleAsset[]; videoCount: number } {
  const $ = cheerio.load(rawHtml);
  const assets: CleanedArticleAsset[] = [];
  let assetOrder = 0;

  $("script, style, iframe").remove();

  $("img").each((_index, element) => {
    const img = $(element);
    const dataSrc = img.attr("data-src");
    const src = img.attr("src");

    if (!src && dataSrc) {
      img.attr("src", dataSrc);
    }
  });

  $("mp-common-videosnap, iframe, video").each((_index, element) => {
    const node = $(element);

    assets.push({
      assetType: "video",
      assetUrl: sanitizeUrl(node.attr("data-url") ?? node.attr("src") ?? undefined),
      originalAssetUrl: node.attr("data-url") ?? node.attr("src") ?? null,
      assetTitle: node.attr("data-title") ?? node.attr("data-nickname") ?? null,
      assetDescription: node.attr("data-desc") ?? null,
      assetOrder: assetOrder++,
    });
  });

  $("mp-miniprogram, wx-open-launch-weapp").each((_index, element) => {
    const node = $(element);

    assets.push({
      assetType: "mini_program",
      assetUrl: sanitizeUrl(node.attr("data-path") ?? node.attr("path") ?? undefined),
      originalAssetUrl: node.attr("data-path") ?? node.attr("path") ?? null,
      assetTitle: node.attr("data-title") ?? node.attr("title") ?? null,
      assetDescription: node.attr("data-desc") ?? null,
      assetOrder: assetOrder++,
    });
  });

  $("img").each((_index, element) => {
    const img = $(element);
    const src = img.attr("src");
    const dataSrc = img.attr("data-src");

    assets.push({
      assetType: "image",
      assetUrl: sanitizeUrl(src ?? dataSrc ?? undefined),
      originalAssetUrl: dataSrc ?? src ?? null,
      assetTitle: img.attr("alt") ?? img.attr("title") ?? null,
      assetDescription: null,
      assetOrder: assetOrder++,
    });
  });

  $("a[href]").each((_index, element) => {
    const link = $(element);
    const href = link.attr("href");

    assets.push({
      assetType: "link",
      assetUrl: sanitizeUrl(href ?? undefined),
      originalAssetUrl: href ?? null,
      assetTitle: compactPlainText(link.text()) || link.attr("title") || null,
      assetDescription: null,
      assetOrder: assetOrder++,
    });
  });

  $("*").each((_index, element) => {
    const node = $(element);
    const tagName = "name" in element && typeof element.name === "string" ? element.name.toLowerCase() : null;

    if (!tagName) {
      return;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      node.replaceWith(node.contents());
      return;
    }

    const allowedAttributes = ALLOWED_ATTRIBUTES_BY_TAG[tagName] ?? ALLOWED_ATTRIBUTES_BY_TAG.default;
    const attributes = node.attr() ?? {};

    for (const attributeName of Object.keys(attributes)) {
      const lowerName = attributeName.toLowerCase();
      const value = attributes[attributeName];

      if (lowerName.startsWith("on") || !allowedAttributes.has(lowerName)) {
        node.removeAttr(attributeName);
        continue;
      }

      if ((lowerName === "href" || lowerName === "src" || lowerName === "data-src") && !sanitizeUrl(value)) {
        node.removeAttr(attributeName);
      }
    }

    if (tagName === "a") {
      node.attr("rel", "noopener noreferrer");
    }
  });

  const cleanHtml = normalizeText($.root().html() ?? "");

  return {
    cleanHtml,
    assets,
    videoCount: assets.filter((asset) => asset.assetType === "video").length,
  };
}

function detectContentType(category: string, assets: CleanedArticleAsset[]): CleanedWechatArticle["contentType"] {
  const imageCount = assets.filter((asset) => asset.assetType === "image").length;
  const videoCount = assets.filter((asset) => asset.assetType === "video").length;

  if (videoCount > 0 || category === "影像合集") {
    return "video";
  }

  if (category === "领队培训") {
    return "training";
  }

  if (category === "活动公告") {
    return "announcement";
  }

  if (imageCount >= 12) {
    return "gallery";
  }

  return "article";
}

export function cleanWechatArticle(input: WechatArticleCleanerInput): CleanedWechatArticle {
  const rawWechatHtml = input.content ?? "";
  const { cleanHtml, assets } = sanitizeHtml(rawWechatHtml);
  const plainTextContent = compactPlainText(cheerio.load(cleanHtml).text());
  const summarySource = input.digest?.trim() || plainTextContent;
  const aiSummary = truncateText(compactPlainText(summarySource), input.digest?.trim() ? 200 : 160);
  const classifyText = `${input.title ?? ""} ${input.digest ?? ""} ${plainTextContent}`;
  const detectedCategory = detectCategory(classifyText);
  const authorGroup = detectAuthorGroup(input.author, input.title, plainTextContent);
  const detectedTags = detectTags(classifyText);
  const contentType = detectContentType(detectedCategory, assets);

  return {
    rawWechatHtml,
    cleanContentHtml: cleanHtml,
    plainTextContent,
    aiSummary,
    detectedCategory,
    authorGroup,
    detectedTags,
    contentType,
    assets,
  };
}
