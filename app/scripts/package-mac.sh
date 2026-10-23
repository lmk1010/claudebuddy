#!/bin/bash
#
# 打包 macOS DMG。
#
# 为什么不用 electron-builder 直接出 dmg：
# 它在 distribution 模式下会给每个嵌套二进制做 **带时间戳** 的签名，
# 也就是每个文件都去连一次 Apple 的 TSA。走代理的网络环境下这一步会直接挂住
# —— 实测单个文件超过 12 秒无响应，整个 application 有上百个二进制。
#
# 所以拆成两步：electron-builder 只负责产出 .app（关闭自动签名），
# 签名由 codesign 自己做，不带 --timestamp。本地安装不需要可信时间戳；
# 要上架或公证时再单独做带时间戳的签名。

set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="ClaudeBuddy"
VERSION=$(node -p "require('./package.json').version")
OUT="release"
APP="$OUT/mac-arm64/$APP_NAME.app"
DMG="$OUT/$APP_NAME-$VERSION-arm64.dmg"

echo "▸ 构建前端"
npm run build

echo "▸ 打包 .app（跳过自动签名）"
rm -rf "$OUT/mac-arm64"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64

if [ ! -d "$APP" ]; then
  echo "✗ 没有产出 $APP" >&2
  exit 1
fi

# 优先用 Developer ID；没有就退到 ad-hoc（能装，但换机器会被 Gatekeeper 拦）
IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
  | grep "Developer ID Application" \
  | head -1 \
  | sed -E 's/.*"(.+)"/\1/')

if [ -n "$IDENTITY" ]; then
  echo "▸ 签名（Developer ID，不带时间戳）：$IDENTITY"
  codesign --force --deep --sign "$IDENTITY" "$APP"
else
  echo "▸ 没有 Developer ID 证书，改用 ad-hoc 签名"
  codesign --force --deep --sign - "$APP"
fi

echo "▸ 校验签名"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -3

echo "▸ 生成 DMG"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$APP" -ov -format UDZO "$DMG" >/dev/null

echo
echo "✓ 完成：$DMG ($(du -h "$DMG" | cut -f1))"
