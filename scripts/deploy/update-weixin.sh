#!/bin/bash
set -e

APP_DIR="/opt/weixin-data-sync"
PM2_APP_NAME="weixin-data-sync"

echo "==> [1/6] Enter project directory: ${APP_DIR}"
cd "${APP_DIR}"

echo "==> [2/6] Pull latest code from origin/main"
git pull origin main

echo "==> [3/6] Install dependencies"
npm install

echo "==> [4/6] Build project"
npm run build

echo "==> [5/6] Restart PM2 service: ${PM2_APP_NAME}"
pm2 restart "${PM2_APP_NAME}"

echo "==> [6/6] PM2 process list"
pm2 list

echo "==> Update finished"
