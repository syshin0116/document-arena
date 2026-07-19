FROM oven/bun:1.3.10-debian@sha256:367842b35abbdf23f39e23c71f3a08eee940ff2679a14e08a5afcf4a1436cd89 AS bun-runtime

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
      /usr/local/bin/pnpm /usr/local/bin/pnpx

WORKDIR /workspace

RUN mkdir -p \
      /workspace/node_modules \
      /workspace/.next \
      /tmp/document-arena-home/.bun/install/cache \
    && chmod 0777 \
      /workspace/node_modules \
      /workspace/.next \
      /tmp/document-arena-home \
      /tmp/document-arena-home/.bun \
      /tmp/document-arena-home/.bun/install \
      /tmp/document-arena-home/.bun/install/cache

ENV BUN_INSTALL_BIN=/usr/local/bin \
    HOME=/tmp/document-arena-home

LABEL document-arena.image.role="web-development"

CMD ["sh", "/workspace/infra/scripts/web-dev.sh"]
