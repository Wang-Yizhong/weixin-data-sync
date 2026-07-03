#!/bin/bash
set -e

PM2_APP_NAME="weixin-data-sync"

echo "==> [1/2] Restart PM2 service: ${PM2_APP_NAME}"
pm2 restart "${PM2_APP_NAME}"

echo "==> [2/2] PM2 process list"
pm2 list

echo "==> Restart finished"
