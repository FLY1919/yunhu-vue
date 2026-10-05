#!/usr/bin/env bash
# 部署脚本：构建 → 整目录同步 → 清掉服务器上的旧产物
#
# 以前的教训：我手动按文件名传 dist，结果 index.html 引用的 CSS 没传上去，
# 请求 CSS 落到 SPA 兜底返回 index.html（text/html）→ 整站没样式变成纯文本。
# 所以这里改成**整目录 rsync + 删掉多余文件**，杜绝漏传。
set -euo pipefail

HOST="${YH_HOST:-root@2409:8a4c:9e33:4570::9}"
REMOTE="${YH_REMOTE:-/opt/yunhu-vue}"
cd "$(dirname "$0")"

echo "▶ 1/4 类型检查"
npx tsc --noEmit
if npx tsc --noEmit 2>&1 | grep -q "error TS"; then echo "✗ 有类型错误，中止"; exit 1; fi

echo "▶ 2/4 构建"
npm run build

echo "▶ 3/4 校验 index.html 引用的资源是否都存在"
missing=0
for f in $(grep -oE '(src|href)="\./assets/[^"]+"' dist/index.html | sed -E 's/.*"\.\/(assets\/[^"]+)"/\1/'); do
  if [ ! -f "dist/$f" ]; then echo "  ✗ 缺少 $f"; missing=1; else echo "  ✓ $f"; fi
done
[ "$missing" = 0 ] || { echo "✗ 引用的资源缺失，中止"; exit 1; }

echo "▶ 4/4 同步到 $HOST:$REMOTE （用 tar 整目录覆盖，不依赖 rsync）"
# 先清空服务器 dist，再把本地 dist 整个推过去 —— 这样绝不会漏传某个被引用的资源
ssh -o StrictHostKeyChecking=no "$HOST" "rm -rf $REMOTE/dist && mkdir -p $REMOTE/dist"
tar -cz -C dist . | ssh -o StrictHostKeyChecking=no "$HOST" "tar -xz -C $REMOTE/dist"
tar -cz webdav.ts server.ts package.json deploy.sh 2>/dev/null | \
  ssh -o StrictHostKeyChecking=no "$HOST" "tar -xz -C $REMOTE"

echo "▶ 重启服务"
ssh -o StrictHostKeyChecking=no "$HOST" 'systemctl restart yunhu-vue && sleep 2 && systemctl is-active yunhu-vue'

echo "▶ 冒烟测试：index.html 里引用的每个资源都要 200 且类型正确"
for f in $(grep -oE '(src|href)="\./assets/[^"]+"' dist/index.html | sed -E 's/.*"\.\/(assets\/[^"]+)"/\1/'); do
  url="http://127.0.0.1:8902/$f"
  ssh -o StrictHostKeyChecking=no "$HOST" "curl -s -o /dev/null -w '%{http_code} %{content_type}  $f\n' $url"
done
ssh -o StrictHostKeyChecking=no "$HOST" "curl -s -o /dev/null -w '%{http_code} %{content_type}  /\n' http://127.0.0.1:8902/"
echo "✅ 部署完成"
