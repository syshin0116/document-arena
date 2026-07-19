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

ENV PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir uv \
    && uv pip install --system "mineru[pipeline]==3.4.4"

# Bake the pipeline models into the image under a fixed home, then point the
# runtime at the resulting mineru.json while HOME moves to tmpfs.
ENV HOME=/opt/mineru-home \
    MINERU_MODEL_SOURCE=huggingface
RUN mkdir -p /opt/mineru-home \
    && mineru-models-download -s huggingface -m pipeline \
    && chmod -R a+rX /opt/mineru-home

# 3.4.4 imports `six` transitively without declaring it; install it in a
# separate layer so the model bake above stays cached.
RUN uv pip install --system six

ENV HOME=/tmp \
    MINERU_TOOLS_CONFIG_JSON=/opt/mineru-home/mineru.json \
    MINERU_MODEL_SOURCE=local \
    MINERU_DEVICE_MODE=cpu

RUN groupadd --gid 10001 arena \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin arena

WORKDIR /opt/parser-arena/extension
COPY adapter/ ./adapter/

LABEL org.opencontainers.image.title="Parser Arena MinerU Pipeline adapter"
LABEL parser-arena.component.id="mineru-pipeline"
LABEL parser-arena.component.version="0.1.0"
LABEL parser-arena.upstream.version="3.4.4"
LABEL parser-arena.upstream.source="https://github.com/opendatalab/MinerU"

USER 10001:10001
ENTRYPOINT ["python", "adapter/main.py"]
