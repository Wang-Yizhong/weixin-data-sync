#!/bin/bash
set -e

APP_DIR="/opt/weixin-data-sync"

echo "==> [1/2] Enter project directory: ${APP_DIR}"
cd "${APP_DIR}"

echo "==> [2/2] Sync WeChat published articles to dev database"
npm run sync:wechat-articles-dev

echo "==> Sync finished"
