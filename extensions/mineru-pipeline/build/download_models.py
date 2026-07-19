"""Download the reviewed MinerU pipeline model snapshot during image build."""

from __future__ import annotations

import json
from pathlib import Path

from huggingface_hub import snapshot_download

MODEL_REPOSITORY = "opendatalab/PDF-Extract-Kit-1.0"
MODEL_REVISION = "ed6b654c018d742e65a17671e379c5e6ecc87ec9"
MODEL_PATHS = (
    "models/Layout/PP-DocLayoutV2",
    "models/MFR/unimernet_hf_small_2503",
    "models/OCR/paddleocr_torch",
    "models/TabRec/SlanetPlus/slanet-plus.onnx",
    "models/TabRec/UnetStructure/unet.onnx",
    "models/TabCls/paddle_table_cls/PP-LCNet_x1_0_table_cls.onnx",
    "models/MFR/pp_formulanet_plus_m",
)
MODEL_ROOT = Path("/opt/mineru-models")
CONFIG_ROOT = Path("/opt/mineru-home")


def main() -> None:
    patterns = [pattern for path in MODEL_PATHS for pattern in (path, f"{path}/*")]
    snapshot_download(
        repo_id=MODEL_REPOSITORY,
        revision=MODEL_REVISION,
        allow_patterns=patterns,
        local_dir=MODEL_ROOT,
    )
    CONFIG_ROOT.mkdir(parents=True, exist_ok=True)
    (CONFIG_ROOT / "mineru.json").write_text(
        json.dumps(
            {
                "models-dir": {"pipeline": str(MODEL_ROOT), "vlm": ""},
                "model-source": "local",
                "config_version": "1.3.2",
            },
            indent=2,
        )
        + "\n",
        "utf-8",
    )
    (CONFIG_ROOT / "model-revision.json").write_text(
        json.dumps(
            {
                "source": "huggingface",
                "repository": MODEL_REPOSITORY,
                "revision": MODEL_REVISION,
                "paths": MODEL_PATHS,
            },
            indent=2,
        )
        + "\n",
        "utf-8",
    )


if __name__ == "__main__":
    main()
