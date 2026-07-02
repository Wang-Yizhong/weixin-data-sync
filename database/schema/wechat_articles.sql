CREATE TABLE IF NOT EXISTS article_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  category_name VARCHAR(64) NOT NULL COMMENT '分类中文名',
  category_slug VARCHAR(64) NOT NULL COMMENT '分类英文标识',
  category_description VARCHAR(255) NULL COMMENT '分类说明',
  display_order INT NOT NULL DEFAULT 0 COMMENT '官网展示顺序',
  is_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_category_slug (category_slug),
  UNIQUE KEY uk_category_name (category_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文章分类表';

CREATE TABLE IF NOT EXISTS wechat_articles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  wechat_article_id VARCHAR(128) NOT NULL COMMENT '微信已发布文章 article_id',
  wechat_media_id VARCHAR(128) NULL COMMENT '微信 media_id',
  article_title VARCHAR(255) NOT NULL COMMENT '文章标题',
  article_author VARCHAR(128) NULL COMMENT '文章作者',
  author_group VARCHAR(64) NOT NULL DEFAULT '未知作者' COMMENT '作者归类',
  article_digest VARCHAR(512) NULL COMMENT '微信文章摘要',
  article_cover_url TEXT NULL COMMENT '封面图 URL，优先使用 thumb_url',
  wechat_article_url TEXT NULL COMMENT '微信原文链接 url',
  original_source_url TEXT NULL COMMENT '原文来源链接 content_source_url',
  raw_wechat_html LONGTEXT NOT NULL COMMENT '微信返回的原始 HTML 富文本',
  clean_content_html LONGTEXT NULL COMMENT '清洗后用于官网展示的 HTML',
  plain_text_content LONGTEXT NULL COMMENT '去除 HTML 后的纯文本内容',
  ai_summary VARCHAR(512) NULL COMMENT '用于官网列表、AI 引用、GEO 的摘要',
  primary_category VARCHAR(64) NOT NULL DEFAULT '未分类' COMMENT '主分类',
  content_tags JSON NULL COMMENT '多标签，例如 ["贡嘎","川西","领队培训"]',
  content_type VARCHAR(32) NOT NULL DEFAULT 'article' COMMENT '内容类型：article/video/gallery/training/announcement',
  publish_time DATETIME NULL COMMENT '微信发布时间',
  sync_status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT '同步状态：pending/synced/failed/skipped',
  last_sync_at DATETIME NULL COMMENT '最后同步时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_wechat_article_id (wechat_article_id),
  KEY idx_publish_time (publish_time),
  KEY idx_primary_category (primary_category),
  KEY idx_article_author (article_author),
  KEY idx_author_group (author_group),
  KEY idx_sync_status (sync_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公众号文章主表';

CREATE TABLE IF NOT EXISTS wechat_article_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  article_id BIGINT UNSIGNED NOT NULL COMMENT '关联 wechat_articles.id',
  asset_type VARCHAR(32) NOT NULL COMMENT '素材类型：image/video/mini_program/link',
  asset_url TEXT NULL COMMENT '素材地址',
  original_asset_url TEXT NULL COMMENT '原始素材地址，例如 data-src',
  asset_title VARCHAR(255) NULL COMMENT '素材标题',
  asset_description VARCHAR(512) NULL COMMENT '素材描述',
  asset_order INT NOT NULL DEFAULT 0 COMMENT '素材在文章中的顺序',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (id),
  KEY idx_article_id (article_id),
  KEY idx_asset_type (asset_type),
  CONSTRAINT fk_wechat_article_assets_article_id
    FOREIGN KEY (article_id) REFERENCES wechat_articles (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文章素材表';

INSERT INTO article_categories
  (category_name, category_slug, category_description, display_order, is_enabled)
VALUES
  ('户外百科', 'outdoor_wiki', '户外知识、装备、技巧、安全与百科内容', 10, 1),
  ('徒步游记', 'hiking_story', '徒步记录、线路体验、人物故事与旅行见闻', 20, 1),
  ('领队培训', 'leader_training', '领队课程、培训班、能力建设与认证相关内容', 30, 1),
  ('目的地推荐', 'destination_guide', '目的地、季节、线路和旅行灵感推荐', 40, 1),
  ('品牌故事', 'brand_story', '品牌发展、团队故事、价值观与年度回顾', 50, 1),
  ('活动公告', 'activity_notice', '活动报名、开班、名额、福利与通知', 60, 1),
  ('影像合集', 'media_collection', '视频、照片、航拍、纪录片与影像合集', 70, 1)
ON DUPLICATE KEY UPDATE
  category_name = VALUES(category_name),
  category_description = VALUES(category_description),
  display_order = VALUES(display_order),
  is_enabled = VALUES(is_enabled),
  updated_at = CURRENT_TIMESTAMP;
