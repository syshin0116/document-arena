#!/bin/sh
set -eu

bun install --frozen-lockfile
exec bun run dev:container
