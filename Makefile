 # Makefile — LambdaScope monorepo root
#
# Single entry point for all build, deploy, and dev commands.
# Every teammate uses this. Judges run `make deploy` to evaluate the project.
#
# Usage:
#   make          — show available targets (default)
#   make build    — compile the Rust extension binary
#   make layer    — package binary into an AWS Lambda Layer and publish it
#   make deploy   — build → layer → deploy full stack to AWS (ap-south-1)
#   make dev      — start the dashboard locally against mock data
#   make clean    — remove all build artifacts

.PHONY: help build layer deploy dev clean

# Default target — print help when `make` is run with no arguments.
.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# help — list all available targets with descriptions
# ---------------------------------------------------------------------------
help:
	@echo ""
	@echo "  LambdaScope — eBPF observability layer for AWS Lambda"
	@echo ""
	@echo "  Available targets:"
	@echo ""
	@echo "    make build    Compile the Rust extension binary for aarch64 Lambda Linux"
	@echo "    make layer    Package the binary into a Lambda Layer and publish to AWS"
	@echo "    make deploy   Full deploy: build → layer → deploy stack to ap-south-1"
	@echo "    make dev      Start the dashboard locally (npm install + npm run dev)"
	@echo "    make clean    Remove extension/target/, lambdascope-layer.zip, layer/"
	@echo ""
	@echo "  Judges: run 'make deploy' to bring up the entire stack in one command."
	@echo ""

# ---------------------------------------------------------------------------
# build — cross-compile the Rust Lambda Extension for aarch64 Linux musl
# ---------------------------------------------------------------------------
build:
	@echo "[lambdascope] building Rust extension..."
	cargo build --release --target aarch64-unknown-linux-musl --manifest-path extension/Cargo.toml

# ---------------------------------------------------------------------------
# layer — package the binary into a Lambda Layer zip and publish it to AWS
#          depends on build so the binary is always fresh before packaging
# ---------------------------------------------------------------------------
layer: build
	@echo "[lambdascope] packaging Lambda Layer..."
	bash infra/scripts/package-layer.sh

# ---------------------------------------------------------------------------
# deploy — build → layer → deploy the full CloudFormation stack to AWS
#           depends on layer which depends on build — guaranteed order
# ---------------------------------------------------------------------------
deploy: layer
	@echo "[lambdascope] deploying stack..."
	bash infra/scripts/deploy.sh

# ---------------------------------------------------------------------------
# dev — start the dashboard locally against mock data (no infra dependency)
# ---------------------------------------------------------------------------
dev:
	@echo "[lambdascope] starting dashboard in dev mode..."
	cd dashboard && npm install && npm run dev

# ---------------------------------------------------------------------------
# clean — remove all local build artifacts
# ---------------------------------------------------------------------------
clean:
	@echo "[lambdascope] cleaning build artifacts..."
	rm -rf extension/target/
	rm -f lambdascope-layer.zip
	rm -rf layer/
	@echo "[lambdascope] clean complete."
