#!/usr/bin/env bash
set -euo pipefail
# Usage: WEBVIEW2_BOOTSTRAPPER=/path/MicrosoftEdgeWebview2Setup.exe ./scripts/package-windows-local.sh
# Requires: npm run build; node scripts/build-server-bundle.mjs;
# cargo build --manifest-path src-tauri/Cargo.toml --release --target x86_64-pc-windows-gnu
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_dir"
app_version="$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")"
release_dir="$project_dir/release"
target_dir="${WINDOWS_TARGET_DIR:-$project_dir/src-tauri/target/x86_64-pc-windows-gnu/release}"
: "${WEBVIEW2_BOOTSTRAPPER:?Set WEBVIEW2_BOOTSTRAPPER to the official Microsoft Evergreen setup executable}"
mkdir -p "$release_dir"
# A fresh stage prevents failed/overlapping local builds from bundling stale assets or partial copies.
stage_dir="$(mktemp -d "$release_dir/windows-stage.XXXXXXXX")"
trap 'rm -rf "$stage_dir"' EXIT
cp "$target_dir/yunhulaoda-desktop.exe" "$stage_dir/"
cp "$target_dir/WebView2Loader.dll" "$stage_dir/"
cp src-tauri/resources/node.exe src-tauri/resources/server-bundle.mjs "$stage_dir/"
cp -r dist "$stage_dir/dist"
cp "$WEBVIEW2_BOOTSTRAPPER" "$stage_dir/MicrosoftEdgeWebview2Setup.exe"
# Do not bundle a partial runtime just because it exists on disk.
node scripts/verify-windows-assets.mjs "$stage_dir"
makensis -V3 "-DSTAGE=$stage_dir" "-DOUTPUT=$release_dir/yunhulaoda-$app_version-windows-x64-setup.exe" \
  "-DAPPVERSION=$app_version" src-tauri/nsis/local-installer.nsi
