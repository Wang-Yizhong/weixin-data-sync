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
