# @wasm-gaming/smbros-wasm — build & preview
#
#   make build     Full build → dist/ (Godot web export + TypeScript SDK)
#   make preview   Serve dist/ at http://localhost:$(PORT)
#
# The web export is produced from an unmodified upstream checkout plus the
# patches in scripts/patch-smbros-project.mjs; nothing from the game lives in
# this repo. build-demo preserves the Godot-generated shell by keeping it at
# dist/original/index.html before writing this package's demo shell.

BIN := node_modules/.bin

PORT ?= 8027

# Upstream game + toolchain. Pinned so a build is reproducible; override on the
# command line to track a newer revision (make build-wasm UPSTREAM_REF=main).
UPSTREAM_REPO ?= https://github.com/JHDev2006/Super-Mario-Bros.-Remastered-Public.git
UPSTREAM_REF  ?= d5bd2b4b85c5ddb58ba1ee66c53455b090152af8
GODOT_VERSION ?= 4.6.3-stable

# Runtime variants to export: `nothreads` runs anywhere, `threads` needs
# cross-origin isolation (COOP/COEP) but gets real worker threads.
VARIANTS ?= nothreads threads

# Shared demo template shipped by the engine contract package; this repo only
# adds index.html + theme.nes.css on top of it.
SPECS_DEMO := node_modules/@wasm-gaming/engine-specs/demo

export UPSTREAM_REPO UPSTREAM_REF GODOT_VERSION VARIANTS

.PHONY: build build-sdk build-lib build-manifest build-demo build-wasm \
	build-wasm-docker preview preview.threaded typecheck test release-check \
	i install clean clean-all help

i: install
install: ## Install dev dependencies
	npm install

node_modules: package.json
	npm install
	@touch node_modules

build: build-wasm build-sdk ## Full build → dist/ (web export first, then SDK/demo)

build-sdk: build-lib build-manifest build-demo ## TypeScript + manifest + demo shell

build-lib: node_modules ## Compile SDK/options/manifest → dist/smbros/
	$(BIN)/tsc -p tsconfig.json

build-manifest: build-lib ## Serialize typed manifest → dist/manifest.json
	node scripts/emit-manifest.mjs

build-demo: build-lib ## Compile demo + keep the Godot shell at dist/original/index.html
	@mkdir -p dist/original
	@if [ -f dist/index.html ] && [ ! -f dist/original/index.html ]; then mv dist/index.html dist/original/index.html; fi
	$(BIN)/tsc -p tsconfig.demo.json
	rm -rf dist/demo
	cp -R $(SPECS_DEMO) dist/demo
	cp src/demo/index.html dist/index.html
	cp src/demo/theme.nes.css dist/theme.nes.css

build-wasm: ## Export the Godot project to WebAssembly → dist/smbros/
	bash scripts/build-smbros-web.sh

build-wasm-docker: ## Same export, inside a pinned Linux container (CI parity)
	bash scripts/build-smbros-web-docker.sh

typecheck: build-lib
	$(BIN)/tsc -p tsconfig.json --noEmit
	$(BIN)/tsc -p tsconfig.demo.json --noEmit

test: typecheck build-manifest
	node --test tests/*.test.mjs

release-check: test
	npm config get registry
	npm pack --dry-run

preview: ## Serve dist/ with COOP/COEP headers (threaded runtime)
	@echo "Serving dist/ at http://localhost:$(PORT) (Ctrl+C to stop)"
	python3 scripts/preview-server.py --port $(PORT) --directory dist

preview.single: ## Serve dist/ without COOP/COEP headers (single-threaded runtime)
	@echo "Serving dist/ at http://localhost:$(PORT) (Ctrl+C to stop)"
	python3 -m http.server $(PORT) --directory dist

clean: ## Remove build outputs
	@if [ -d dist ]; then find dist -mindepth 1 -delete; fi

clean-all: clean ## Also drop the cached Godot toolchain and upstream checkout
	rm -rf .tmp

help: ## List targets
	@grep -E '^[a-zA-Z_.-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
