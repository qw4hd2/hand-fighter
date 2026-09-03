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

# GameDistribution build: GD_OPTIONS + their SDK loader replace the CrazyGames tag.
# Set your Game ID from developer.gamedistribution.com:  GD_GAME_ID=xxxx ./build.sh
GD_ID="${GD_GAME_ID:-PUT-YOUR-GAMEDISTRIBUTION-GAME-ID-HERE}"
rm -rf dist/gd-build && mkdir -p dist/gd-build
cp game/index.html game/style.css dist/gd-build/
cp -r game/js dist/gd-build/js
python3 - "$GD_ID" <<'PY'
import sys
gid = sys.argv[1]
p = 'dist/gd-build/index.html'
s = open(p).read()
snippet = '''<script>
    window["GD_OPTIONS"] = {
      "gameId": "%s",
      "onEvent": function (event) {
        if (event.name === "SDK_READY") window.__gdReady = true;
        if (event.name === "SDK_GAME_PAUSE") document.dispatchEvent(new Event("portal-pause"));
        if (event.name === "SDK_GAME_START") document.dispatchEvent(new Event("portal-resume"));
        if (event.name === "SDK_REWARDED_WATCH_COMPLETE") document.dispatchEvent(new Event("gd-rewarded-complete"));
      }
    };
    (function (d, s, id) {
      var js, fjs = d.getElementsByTagName(s)[0];
      if (d.getElementById(id)) return;
      js = d.createElement(s); js.id = id;
      js.src = "https://html5.api.gamedistribution.com/main.min.js";
      fjs.parentNode.insertBefore(js, fjs);
    }(document, "script", "gamedistribution-jssdk"));
  </script>''' % gid
s = s.replace('<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>', snippet)
open(p, 'w').write(s)
PY
(cd dist/gd-build && zip -qr ../hand-fighter-gamedistribution.zip .)
rm -rf dist/gd-build
ls -la dist/hand-fighter-gamedistribution.zip
