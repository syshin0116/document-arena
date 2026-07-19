# Azure Document Intelligence adapter. Unlike the local parsers this image
# needs outbound network at run time to reach the Azure endpoint; the runner
# grants that only for components whose manifest declares network: remote, and
# injects the endpoint/key from a local connection as env vars.
# TODO: pin the base image by digest once the first working build is recorded.
FROM python:3.11-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.10.5 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    HOME=/tmp

WORKDIR /opt/parser-arena/extension
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

ENV PATH="/opt/parser-arena/extension/.venv/bin:$PATH"

RUN groupadd --gid 10001 arena \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin arena

COPY adapter/ ./adapter/

LABEL org.opencontainers.image.title="Parser Arena Azure Document Intelligence adapter"
LABEL parser-arena.component.id="azure-di"
LABEL parser-arena.component.version="0.1.0"
LABEL parser-arena.upstream.version="azure-ai-documentintelligence@1.0.2"
LABEL parser-arena.upstream.source="https://learn.microsoft.com/azure/ai-services/document-intelligence/"

USER 10001:10001
ENTRYPOINT ["python", "adapter/main.py"]
