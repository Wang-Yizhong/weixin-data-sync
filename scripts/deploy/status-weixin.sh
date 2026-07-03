#!/bin/bash
set -e

PM2_APP_NAME="weixin-data-sync"

echo "==> [1/2] PM2 process list"
pm2 list

echo "==> [2/2] Recent logs for ${PM2_APP_NAME}"
pm2 logs "${PM2_APP_NAME}" --lines 80 --nostream

echo "==> Status check finished"
