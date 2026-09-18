#!/bin/bash
# infra/scripts/package-layer.sh
#
# Packages the compiled Rust Lambda Extension binary into an AWS Lambda Layer
# and publishes it to ap-south-1. Run from the monorepo root:
#
#   bash infra/scripts/package-layer.sh
#
# Requires: aws CLI, jq, zip

set -e

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BINARY_SRC="extension/target/aarch64-unknown-linux-musl/release/lambdascope"
LAYER_NAME="lambdascope"
LAYER_DIR="layer"
REGION="ap-south-1"
ZIP_FILE="lambdascope-layer.zip"

# ---------------------------------------------------------------------------
# Step 1 — Verify the compiled binary exists before doing anything else.
# ---------------------------------------------------------------------------
echo "[lambdascope] checking for compiled binary at: ${BINARY_SRC}"
if [ ! -f "${BINARY_SRC}" ]; then
  echo ""
  echo "[lambdascope] ERROR: binary not found at '${BINARY_SRC}'"
  echo "[lambdascope]        Ask Sudhanshu to run:"
  echo "[lambdascope]          cargo build --release --target aarch64-unknown-linux-musl"
  echo "[lambdascope]        from the extension/ directory, then re-run this script."
  exit 1
fi
echo "[lambdascope] binary found."

# ---------------------------------------------------------------------------
# Step 2 — Create a clean temp directory with the exact path AWS requires.
#           AWS Lambda Extensions MUST live at extensions/<name> inside the zip.
# ---------------------------------------------------------------------------
echo "[lambdascope] creating clean staging directory: ${LAYER_DIR}/extensions/"
rm -rf "${LAYER_DIR}"
mkdir -p "${LAYER_DIR}/extensions"

# ---------------------------------------------------------------------------
# Step 3 — Copy the binary into the staging directory.
# ---------------------------------------------------------------------------
echo "[lambdascope] copying binary to ${LAYER_DIR}/extensions/lambdascope"
cp "${BINARY_SRC}" "${LAYER_DIR}/extensions/lambdascope"

# ---------------------------------------------------------------------------
# Step 4 — Make the binary executable.
#           Lambda will silently skip the extension if this bit is missing.
# ---------------------------------------------------------------------------
echo "[lambdascope] setting executable bit on binary"
chmod +x "${LAYER_DIR}/extensions/lambdascope"

# ---------------------------------------------------------------------------
# Step 5 — Zip the extensions/ folder.
#           Must be run from inside layer/ so the zip root is extensions/,
#           not layer/extensions/. AWS validates the internal path on invoke.
# ---------------------------------------------------------------------------
echo "[lambdascope] zipping extensions/ folder into ${ZIP_FILE}"
(
  cd "${LAYER_DIR}"
  zip -r "../${ZIP_FILE}" extensions/
)
echo "[lambdascope] zip created: ${ZIP_FILE}"

# ---------------------------------------------------------------------------
# Step 6 — Publish the layer to AWS Lambda.
# ---------------------------------------------------------------------------
echo "[lambdascope] publishing layer '${LAYER_NAME}' to region ${REGION}..."
PUBLISH_RESPONSE=$(aws lambda publish-layer-version \
  --layer-name "${LAYER_NAME}" \
  --description "LambdaScope eBPF syscall observer — Rust extension, aarch64-musl" \
  --zip-file "fileb://${ZIP_FILE}" \
  --compatible-runtimes "provided.al2023" \
  --compatible-architectures "arm64" \
  --region "${REGION}")

# ---------------------------------------------------------------------------
# Step 7 — Parse and print the Layer ARN so Vardan can share it immediately.
# ---------------------------------------------------------------------------
LAYER_ARN=$(echo "${PUBLISH_RESPONSE}" | jq -r '.LayerVersionArn')
LAYER_VERSION=$(echo "${PUBLISH_RESPONSE}" | jq -r '.Version')

echo ""
echo "[lambdascope] ✓ Layer published successfully."
echo "[lambdascope] Layer version : ${LAYER_VERSION}"
echo "[lambdascope] Layer ARN     : ${LAYER_ARN}"
echo ""
echo "Copy the ARN above and share it with Sudhanshu in the group chat."
echo "Add it to the monitored Lambda function's Layers list to activate the extension."

# ---------------------------------------------------------------------------
# Step 8 — Clean up temp staging directory and zip.
# ---------------------------------------------------------------------------
echo "[lambdascope] cleaning up staging directory and zip..."
rm -rf "${LAYER_DIR}"
rm -f "${ZIP_FILE}"
echo "[lambdascope] done."
