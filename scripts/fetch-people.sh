#!/usr/bin/env bash
# Download a CC0 people GLB into public/models/people.glb
# Usage:
#   PEOPLE_GLTF_URL="https://example.com/people.glb" npm run fetch-people
set -euo pipefail
out_dir="public/models"
mkdir -p "$out_dir"
if [ -z "${PEOPLE_GLTF_URL:-}" ]; then
  echo "ERROR: PEOPLE_GLTF_URL is not set. Provide a direct URL to a .glb file hosted under a CC0 or permissive license."
  echo "Example: PEOPLE_GLTF_URL=https://example.com/people.glb npm run fetch-people"
  exit 2
fi
url="$PEOPLE_GLTF_URL"
out="$out_dir/people.glb"
echo "Downloading people GLB from: $url"
# Use curl for robustness; fail if HTTP errors
curl --fail --silent --show-error --location "$url" --output "$out"
chmod 644 "$out"
echo "Saved to $out"
