import "dotenv/config";
import express from "express";
import wechatRoutes from "./routes/wechat.routes.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const nodeEnv = process.env.NODE_ENV ?? "development";

app.use(express.json());
app.use(wechatRoutes);

// TODO: 当前服务仅用于开发测试。公网开放前请增加接口鉴权、IP 限制、频率限制、
// 日志脱敏、access_token 缓存和错误告警。
app.listen(port, () => {
  console.log("服务名称：weixin-data-sync");
  console.log(`当前端口：${port}`);
  console.log(`当前环境：${nodeEnv}`);
  console.log(`当前服务器出口 IP 查询方式：http://服务器公网IP:${port}/api/server/ip`);
});
