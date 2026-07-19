FROM oven/bun:1.3.10-debian@sha256:367842b35abbdf23f39e23c71f3a08eee940ff2679a14e08a5afcf4a1436cd89 AS dependencies

WORKDIR /opt/document-arena/extension

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS node-runtime

FROM eclipse-temurin:17.0.18_8-jre-jammy@sha256:642d45bf22d3cb9face159181732ed9fa70873b2681e50445eff7d4785c176bb

COPY --from=node-runtime /usr/local/ /usr/local/

RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && groupadd --gid 10001 arena \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin arena

WORKDIR /opt/document-arena/extension

COPY --from=dependencies /opt/document-arena/extension/node_modules ./node_modules
COPY package.json bun.lock ./

COPY adapter/ ./adapter/

ENV NODE_ENV=production
ENV JAVA_TOOL_OPTIONS="-Djava.awt.headless=true -Dfile.encoding=UTF-8"

LABEL org.opencontainers.image.title="Document Arena OpenDataLoader PDF adapter"
LABEL document-arena.component.id="opendataloader-pdf"
LABEL document-arena.component.version="0.1.0"
LABEL document-arena.upstream.version="2.5.0"
LABEL document-arena.upstream.source="https://github.com/opendataloader-project/opendataloader-pdf"

USER 10001:10001
ENTRYPOINT ["node", "adapter/main.mjs"]
