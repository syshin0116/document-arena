FROM oven/bun:1.3.10-debian@sha256:367842b35abbdf23f39e23c71f3a08eee940ff2679a14e08a5afcf4a1436cd89 AS dependencies
WORKDIR /workspace
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS runtime
WORKDIR /workspace
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
RUN groupadd --system --gid 1001 document-arena \
    && useradd --system --uid 1001 --gid document-arena document-arena
COPY --from=builder --chown=document-arena:document-arena /workspace/public ./public
COPY --from=builder --chown=document-arena:document-arena /workspace/.next/standalone ./
COPY --from=builder --chown=document-arena:document-arena /workspace/.next/static ./.next/static
USER document-arena
EXPOSE 8080
CMD ["node", "server.js"]
