#!/usr/bin/env bash
#
# 把打包产物传到 R2，供自动更新和手动下载用。
#
#   ./scripts/publish-r2.sh [产物目录]    # 默认 app/release
#
# 传到 install 桶的 claudebuddy/ 下（那个桶绑了 dl.mkstore.life）。
# 为什么是 claudebuddy 前缀：桶是共用的，按产品分目录，别人的东西不会被覆盖。
#
# 缓存策略：
#   · latest-mac.yml —— 不能缓存。它是「有没有新版」的唯一入口，
#     被 CDN 缓存住就会出现「明明发了新版，客户端一直说已是最新」。
#   · zip / dmg / blockmap —— 文件名带版本号，内容永不变，缓存一年没问题。
#
set -euo pipefail

ENV_FILE="${HOME}/.config/claudebuddy/r2.env"
BUCKET="install"
PREFIX="claudebuddy"

DIR="${1:-app/release}"

if [ ! -f "$ENV_FILE" ]; then
  echo "缺少凭据文件：$ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

for k in R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  if [ -z "${!k:-}" ]; then
    echo "凭据里缺少 $k" >&2
    exit 1
  fi
done

if [ ! -f "$DIR/latest-mac.yml" ]; then
  echo "$DIR 里没有 latest-mac.yml —— 先跑 npm run dmg" >&2
  exit 1
fi

put() {
  local file="$1" key="$2" cache="$3" ctype="$4"
  local url="${R2_ENDPOINT}/${BUCKET}/${PREFIX}/${key}"
  printf '  %-42s ' "$key"
  if curl -sS --fail --max-time 600 \
      --aws-sigv4 "aws:amz:auto:s3" \
      --user "${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}" \
      -T "$file" \
      -H "Content-Type: ${ctype}" \
      -H "Cache-Control: ${cache}" \
      "$url" > /dev/null; then
    echo "ok"
  else
    echo "失败"
    exit 1
  fi
}

echo "上传到 ${BUCKET}/${PREFIX}/"

# 清单最后传：先让 zip 就位，再切「有没有新版」的开关，
# 否则检查更新的那一瞬间会拿到一个指向还不存在的文件的清单。
for f in "$DIR"/*.zip "$DIR"/*.zip.blockmap "$DIR"/*.dmg "$DIR"/*.dmg.blockmap; do
  [ -f "$f" ] || continue
  ct="application/octet-stream"
  case "$f" in *.dmg) ct="application/x-apple-diskimage" ;; esac
  put "$f" "$(basename "$f")" "public, max-age=31536000, immutable" "$ct"
done

put "$DIR/latest-mac.yml" "latest-mac.yml" "no-cache" "text/yaml"

echo
echo "完成。客户端拉清单的地址："
echo "  https://dl.mkstore.life/${PREFIX}/latest-mac.yml"
echo "给人手动下载的："
echo "  https://dl.mkstore.life/${PREFIX}/$(cd "$DIR" && ls *.dmg | head -1)"
