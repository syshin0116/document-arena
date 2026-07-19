# MinerU Pipeline adapter image. Models are baked at build time so the
# container runs with network disabled at parse time, matching the manifest's
# network: none requirement.
# TODO: pin the base image by digest once the first working build is recorded.
FROM python:3.11-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.10.5 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /opt/parser-arena/extension
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

ENV PATH="/opt/parser-arena/extension/.venv/bin:$PATH"

# Bake the exact reviewed Hugging Face snapshot into a stable path and write
# the matching local MinerU config without fetching the mutable master template.
COPY build/download_models.py ./build/download_models.py
RUN python build/download_models.py \
    && chmod -R a+rX /opt/mineru-home /opt/mineru-models

ENV HOME=/tmp \
    MINERU_TOOLS_CONFIG_JSON=/opt/mineru-home/mineru.json \
    MINERU_MODEL_REVISION_PATH=/opt/mineru-home/model-revision.json \
    MINERU_MODEL_SOURCE=local \
    MINERU_DEVICE_MODE=cpu

RUN groupadd --gid 10001 arena \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin arena

COPY adapter/ ./adapter/

LABEL org.opencontainers.image.title="Parser Arena MinerU Pipeline adapter"
LABEL parser-arena.component.id="mineru-pipeline"
LABEL parser-arena.component.version="0.1.0"
LABEL parser-arena.upstream.version="3.4.4"
LABEL parser-arena.upstream.source="https://github.com/opendatalab/MinerU"
LABEL parser-arena.model.revision="hf:opendatalab/PDF-Extract-Kit-1.0@ed6b654c018d742e65a17671e379c5e6ecc87ec9"

USER 10001:10001
ENTRYPOINT ["python", "adapter/main.py"]
