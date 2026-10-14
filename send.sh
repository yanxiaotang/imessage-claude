#!/bin/sh
# 让服务器上的 AI 主动给你发 iMessage：./send.sh "想你了"
# 需要 .env 里设置了 SEND_TOKEN。文字里也可以带 [[表情:…]] [[链接:…]] 这些动作行。
DIR=$(dirname "$0")
TOKEN=$(grep '^SEND_TOKEN=' "$DIR/.env" | cut -d= -f2-)
python3 -c 'import json,sys;print(json.dumps({"text":sys.argv[1]}))' "$1" | curl -s -X POST http://127.0.0.1:18230/send \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @-
echo
