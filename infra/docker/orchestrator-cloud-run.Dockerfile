FROM oven/bun:1.3.10-debian@sha256:367842b35abbdf23f39e23c71f3a08eee940ff2679a14e08a5afcf4a1436cd89
WORKDIR /workspace
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DOCUMENT_ARENA_HOSTED_EXECUTION_ENABLED=false
RUN groupadd --system --gid 1001 document-arena \
    && useradd --system --uid 1001 --gid document-arena document-arena
COPY --chown=document-arena:document-arena services/orchestrator/serve.mjs ./services/orchestrator/serve.mjs
USER document-arena
EXPOSE 8080
CMD ["bun", "services/orchestrator/serve.mjs"]
