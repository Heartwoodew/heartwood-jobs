#!/usr/bin/env bash
# Builds the CallUp Firebase Hosting site (callupapp.web.app / app.callupapp.com.au) from the same files
# GitHub Pages serves at jobs.heartwoodew.com: app/ under /app/, plus the root redirect pages.
# Output: cloud/hosting-dist (git-ignored). Deploy: see cloud/firebase.hosting.json.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/cloud/hosting-dist"
rm -rf "$out"
mkdir -p "$out/app"
cp "$root/index.html" "$root/404.html" "$out/"
( cd "$root/app" && tar --exclude=node_modules --exclude=package.json --exclude=package-lock.json -cf - . ) | ( cd "$out/app" && tar -xf - )
echo "built $(find "$out" -type f | wc -l) files in $out"
