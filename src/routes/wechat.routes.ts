import { Router } from "express";
import { getAccessToken, getPublishedArticles } from "../services/wechat.service.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    service: "weixin-data-sync",
    status: "ok",
  });
});

router.get("/api/server/ip", async (_req, res) => {
  try {
    const response = await fetch("https://api.ipify.org");
    const publicIp = (await response.text()).trim();

    res.json({
      success: true,
      publicIp,
    });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      hint: "服务器出口 IP 查询失败，请检查服务器网络或 DNS 配置",
    });
  }
});

router.get("/api/wechat/token", async (_req, res) => {
  try {
    const result = await getAccessToken();

    if (!result.success) {
      res.status(502).json({
        success: false,
        error: result.error,
        hint: result.hint,
        raw: result.safeRaw,
      });
      return;
    }

    res.json({
      success: true,
      tokenPreview: result.tokenPreview,
      raw: result.safeRaw,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      hint: "请检查 .env 中的 WECHAT_APP_ID / WECHAT_APP_SECRET 是否存在",
    });
  }
});

router.get("/api/wechat/articles", async (_req, res) => {
  try {
    const result = await getPublishedArticles();

    if (!result.success) {
      res.status(502).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      source: "freepublish/batchget",
      error: error instanceof Error ? error.message : String(error),
      hint: "文章接口测试失败，请检查环境变量、服务器网络和微信公众号接口权限",
    });
  }
});

export default router;
