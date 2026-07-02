# weixin-data-sync

最小可部署的微信公众号 API 测试服务。当前阶段只用于验证腾讯云服务器出口 IP 是否能请求微信公众号接口，不入库、不做正式同步、不做前端页面。

## 本地开发

创建 `.env`：

```env
WECHAT_APP_ID=你的appid
WECHAT_APP_SECRET=你的appsecret
PORT=3000
```

启动：

```bash
npm install
npm run dev
```

构建并运行：

```bash
npm run build
npm run start
```

## 测试地址

```text
http://服务器公网IP:3000/health
http://服务器公网IP:3000/api/server/ip
http://服务器公网IP:3000/api/wechat/token
http://服务器公网IP:3000/api/wechat/articles
```

如果后续使用域名和反向代理，可以变成：

```text
https://你的域名/api/wechat/articles
```

## 微信文章数据流

当前项目建议的数据链路：

```text
微信 API
  → raw_html
  → cleaner
  → clean_html / plain_text / assets
  → MySQL
  → 官网 / API / AI
```

关键原则：

- `raw_wechat_html` 必须保留，方便后续重新清洗、排查展示问题和追溯微信原始内容。
- `clean_content_html` 面向官网展示，只做安全清洗和基础结构保留。
- `plain_text_content` 面向搜索、AI 摘要、GEO 和后续语义处理。
- `wechat_article_id` 是唯一键，入库必须 upsert，不能重复插入。

## 清洗预览

当前阶段只做 API 拉取和清洗预览，不自动写数据库。

运行：

```bash
npm run test:wechat-clean
```

输出报告：

```text
data/reports/wechat-article-clean-preview.json
data/reports/wechat-article-clean-preview.md
```

预览报告包含标题、作者、发布时间、原始 HTML 长度、清洗 HTML 长度、纯文本长度、摘要、初判分类、标签、内容类型、图片数量、视频数量、小程序卡片数量和微信原文链接。

预留同步命令：

```bash
npm run sync:wechat-articles-dev
```

这个命令当前不会写库，只作为后续入库脚本占位。确认清洗结果后再接入 MySQL 写入；入库时必须使用 `wechat_article_id` 做唯一键 upsert，并保留 `raw_wechat_html`。

## 从本地文件导入 dev 数据库

这个命令不会请求微信公众号 API，只读取本地保存的 `freepublish/batchget` 返回文件，清洗后写入 dev MySQL。

`.env` 需要配置 dev 数据库连接，任选一组：

```env
DEV_DATABASE_URL=mysql://user:password@127.0.0.1:3306/weixin_data_sync_dev
```

或：

```env
DEV_MYSQL_HOST=127.0.0.1
DEV_MYSQL_PORT=3306
DEV_MYSQL_USER=root
DEV_MYSQL_PASSWORD=你的开发库密码
DEV_MYSQL_DATABASE=weixin_data_sync_dev
```

运行：

```bash
npm run import:wechat-articles-file-dev -- ./data/raw/wechat-articles-result.txt
```

安全限制：

- 启动后会查询并打印当前数据库名。
- 数据库名必须包含 `dev`，且不能包含 `prod`，否则拒绝执行。
- 不执行 `drop` / `truncate`。
- 所有 SQL 使用参数化查询。
- 使用 `wechat_article_id` upsert，不删除数据库中已有文章。
- 每篇文章导入时会先删除该文章旧 assets，再插入清洗后的 assets。

导入报告：

```text
data/reports/wechat-articles-file-import-dev-report.json
data/reports/wechat-articles-file-import-dev-report.md
```

## 腾讯云全量同步微信公众号文章

全量同步命令会调用微信公众号 `freepublish/batchget`，按 `offset=0`、`count=20` 分页拉取，清洗后 upsert 到 `tububang_dev`。

运行前建议先确认腾讯云服务器出口 IP：

```bash
npm run debug:wechat-env
```

建表/补字段：

```bash
npm run setup:wechat-schema-dev
```

执行同步：

```bash
npm run sync:wechat-articles-dev
```

安全限制：

- 启动时打印当前出口 IP。
- 只输出 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 是否存在，不输出值。
- 数据库名必须严格等于 `tububang_dev`，否则停止。
- 不执行 `drop` / `truncate`。
- 不删除已有文章。
- 使用 `wechat_article_id` upsert。
- 每篇文章只重建自身 assets。

同步报告：

```text
data/reports/wechat-articles-full-sync-dev-report.json
data/reports/wechat-articles-full-sync-dev-report.md
```

## MySQL 表结构

SQL 文件：

```text
database/schema/wechat_articles.sql
```

包含三张表：

- `wechat_articles`：公众号文章主表，保存微信原始 HTML、清洗 HTML、纯文本、摘要、分类、标签、内容类型和同步状态。
- `wechat_article_assets`：文章素材表，保存图片、视频、小程序卡片和链接等素材。
- `article_categories`：文章分类表，预置户外百科、徒步游记、领队培训、目的地推荐、品牌故事、活动公告、影像合集。

## 飞书定位

不建议直接用飞书做官网主库：

- 飞书适合运营审核和人工补充分类。
- 飞书不适合作为官网高频线上数据源。
- 官网主数据建议存 MySQL，方便索引、缓存、权限、查询性能和后续 API 扩展。

飞书未来可以作为人工审核表：

- 补充分类、标签、推荐权重、是否展示。
- 辅助运营审核和内容校对。
- 最终线上读取仍以 MySQL 为准。

## 方式一：GitHub 拉代码

服务器执行：

```bash
git clone <你的仓库地址>
cd weixin-data-sync
npm install
```

创建 `.env`：

```env
WECHAT_APP_ID=你的appid
WECHAT_APP_SECRET=你的appsecret
PORT=3000
```

运行：

```bash
npm run build
npm run start
```

或者使用 pm2：

```bash
npm install -g pm2
pm2 start dist/app.js --name weixin-data-sync
pm2 save
```

## 方式二：本地上传

在本地执行：

```bash
scp -r ./weixin-data-sync root@服务器公网IP:/www/weixin-data-sync
```

然后在服务器执行：

```bash
cd /www/weixin-data-sync
npm install
npm run build
npm run start
```

也可以使用 pm2：

```bash
pm2 start dist/app.js --name weixin-data-sync
pm2 save
```

## 常见问题

如果 `/api/server/ip` 返回的 IP 不是微信公众号白名单中的 IP，需要把这个接口返回的公网 IP 添加到微信公众号后台 IP 白名单，或者检查服务器是否走了代理、NAT、负载均衡出口。

如果 `/api/wechat/token` 返回 `40164`，说明当前发起请求的服务器公网 IP 仍不在微信公众号白名单。以 `/api/server/ip` 的返回为准，把该 IP 加入白名单后再重试。

如果 `/api/wechat/articles` 返回 `48001`，说明当前公众号或 AppID 没有调用该 API 的权限。请检查公众号类型、接口权限、认证状态，以及当前 AppID 是否属于目标公众号。

如果 `/api/wechat/articles` 返回 `item_count = 0`，表示接口成功，但当前没有返回已发布文章。

## 安全提醒

当前接口仅用于开发测试。如果服务器公网开放 `3000` 端口，任何人访问都能触发微信公众号 API 请求。

正式上线前必须增加：

- 接口鉴权
- IP 限制
- 访问频率限制
- 日志脱敏
- access_token 缓存
- 错误告警
