SHELL := /bin/sh
.DEFAULT_GOAL := help

COMPOSE ?= docker compose
PARSER_ARENA_WEB_PORT ?= 3000
PARSER_ARENA_UID ?= $(shell id -u)
PARSER_ARENA_GID ?= $(shell id -g)
DEV_HOST ?= 127.0.0.1

export PARSER_ARENA_WEB_PORT
export PARSER_ARENA_UID
export PARSER_ARENA_GID

.PHONY: help doctor deps dev up down logs ps test lint check parser-fixture parser-image parser-smoke runner-serve mineru-image azure-di-image

help: ## Show available commands.
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

doctor: ## Verify the required local tools.
	@command -v bun >/dev/null
	@command -v node >/dev/null
	@node -e 'if (process.versions.node.split(".")[0] !== "24") { console.error("Parser Arena requires Node.js 24.x"); process.exit(1) }'
	@command -v docker >/dev/null
	@docker compose version
	@docker info >/dev/null
	@printf "Node %s\n" "$$(node --version)"
	@printf "Bun %s\n" "$$(bun --version)"

deps: ## Install the locked JavaScript dependencies with Bun.
	bun install --frozen-lockfile

dev: deps ## Run the web app on the host with hot reload.
	bun run dev -- --hostname $(DEV_HOST) --port $(PARSER_ARENA_WEB_PORT)

up: ## Start the Compose development stack in the background.
	$(COMPOSE) up --detach --build --wait --wait-timeout 120
	@printf "Parser Arena: http://localhost:%s\n" "$(PARSER_ARENA_WEB_PORT)"

down: ## Stop the Compose stack while retaining dependency caches.
	$(COMPOSE) down --remove-orphans

logs: ## Follow web container logs.
	$(COMPOSE) logs --follow web

ps: ## Show Compose service status.
	$(COMPOSE) ps

test: ## Build the app and run the Bun test suite.
	bun run test

lint: ## Run ESLint.
	bun run lint

check: test lint ## Run all local verification.

parser-fixture: ## Generate the deterministic parser smoke PDF.
	bun run parser:fixture

parser-image: ## Build the pinned OpenDataLoader component image.
	bun run parser:build:opendataloader

parser-smoke: parser-fixture parser-image ## Run the first parser end to end.
	bun run parser:run:opendataloader -- --input work/fixtures/parser-arena-smoke.pdf

runner-serve: parser-image ## Serve the local runner so the web app can run real parses.
	bun services/runner/serve.mjs

mineru-image: ## Build the pinned MinerU pipeline image (downloads models, several GB).
	docker build -t parser-arena/mineru-pipeline:3.4.4 extensions/mineru-pipeline

azure-di-image: ## Build the Azure Document Intelligence adapter image (remote API; needs AZURE_DI_* in .env).
	docker build -t parser-arena/azure-di:0.1.0 extensions/azure-di
