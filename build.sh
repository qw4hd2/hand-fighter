#!/bin/bash
# Builds the three portal zips from the game/ folder.
#   ./build.sh
set -e
cd "$(dirname "$0")"
mkdir -p dist
rm -f dist/hand-fighter-web.zip dist/hand-fighter-crazygames.zip dist/hand-fighter-poki.zip

# itch.io / generic web + CrazyGames (CrazyGames SDK is inert elsewhere)
(cd game && zip -qr ../dist/hand-fighter-web.zip index.html style.css js -x '*.DS_Store')
cp dist/hand-fighter-web.zip dist/hand-fighter-crazygames.zip

# Poki build: swap the SDK script tag
rm -rf dist/poki-build && mkdir -p dist/poki-build
cp game/index.html game/style.css dist/poki-build/
cp -r game/js dist/poki-build/js
sed -i '' 's|<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>|<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>|' dist/poki-build/index.html
(cd dist/poki-build && zip -qr ../hand-fighter-poki.zip .)
rm -rf dist/poki-build

ls -la dist/*.zip
