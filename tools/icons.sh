#!/bin/bash
# Regenerates every raster icon from the SVG sources.
set -euo pipefail
cd "$(dirname "$0")/.."

magick -background none app/icons/blot.svg -resize 192x192 app/icons/icon-192.png
magick -background none app/icons/blot.svg -resize 512x512 app/icons/icon-512.png

fg=tools/icon-fg.svg
res=android/app/src/main/res
magick -background none "$fg" -resize 108x108 "$res/mipmap-mdpi/ic_launcher_fg.png"
magick -background none "$fg" -resize 162x162 "$res/mipmap-hdpi/ic_launcher_fg.png"
magick -background none "$fg" -resize 216x216 "$res/mipmap-xhdpi/ic_launcher_fg.png"
magick -background none "$fg" -resize 324x324 "$res/mipmap-xxhdpi/ic_launcher_fg.png"
magick -background none "$fg" -resize 432x432 "$res/mipmap-xxxhdpi/ic_launcher_fg.png"
mono=tools/icon-mono.svg
for d in mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
  magick -background none "$mono" -resize "${d#*:}x${d#*:}" "$res/mipmap-${d%%:*}/ic_launcher_mono.png"
done
magick -background none app/icons/blot.svg -resize 512x512 fastlane/metadata/android/en-US/images/icon.png

# iOS wants a full-bleed opaque square; the brand background fills the
# rounded corners invisibly and iOS applies its own mask.
magick -size 1024x1024 xc:'#8d3b86' \
  \( -background none app/icons/blot.svg -resize 1024x1024 \) \
  -composite -alpha off ios/Assets.xcassets/AppIcon.appiconset/AppIcon1024.png
magick -background none app/icons/blot.svg -resize 180x180 \
  -size 180x180 xc:'#8d3b86' +swap -composite -alpha off app/icons/apple-touch-icon.png
echo "icons regenerated"
