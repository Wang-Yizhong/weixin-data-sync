import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { getWechatApiDebugInfo } from "../src/services/wechat.service.js";

const envPath = resolve(process.cwd(), ".env");
const envResult = dotenv.config({ path: envPath, quiet: true });

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

async function main(): Promise<void> {
  const publicIp = await getPublicIp();
  const apiDebugInfo = getWechatApiDebugInfo();

  console.log("微信 API 环境调试信息：");
  console.dir(
    {
      publicIp,
      cwd: process.cwd(),
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV ?? null,
      platform: process.platform,
      port: process.env.PORT ?? null,
      envFile: {
        path: envPath,
        exists: existsSync(envPath),
        loaded: !envResult.error,
        error: envResult.error?.message ?? null,
      },
      envExists: {
        WECHAT_APP_ID: Boolean(process.env.WECHAT_APP_ID),
        WECHAT_APP_SECRET: Boolean(process.env.WECHAT_APP_SECRET),
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

main().catch((error: unknown) => {
  console.error("微信 API 环境调试失败：");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
