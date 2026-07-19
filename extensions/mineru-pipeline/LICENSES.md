# MinerU Pipeline extension licenses

Status: verified against upstream on 2026-07-19 (GitHub license API,
`LICENSE.md` on master, and dependency lists at the pinned version); full
legal review still pending before any hosted or redistributed use.

## Pinned version: MinerU 3.4.4

- **MinerU code** (`mineru` PyPI, pinned 3.4.4): **MinerU Open Source
  License** — a custom license based on Apache-2.0 with additional terms:
  - a commercial license is required only above **100M monthly active users**
    or **USD 20M monthly revenue**;
  - an **online-service attribution obligation** applies when MinerU powers a
    public service (Parser Arena's hosted catalog entry must show visible
    MinerU attribution).
- **Dependency change vs 2.x**: 3.x removed the AGPL-3.0 `doclayout_yolo`
  code dependency (derived from AGPL YOLOv10); pipeline inference now runs
  through onnxruntime with upstream-shipped models. This removal is what made
  the relicense possible; the 2.x line remains AGPL-3.0.
- **Pipeline model weights** (layout, formula, OCR, and table files from
  `opendatalab/PDF-Extract-Kit-1.0`, pinned to Hugging Face revision
  `ed6b654c018d742e65a17671e379c5e6ecc87ec9`): the repository model card
  declares AGPL-3.0, while individual upstream model families may carry
  additional terms. These weights must complete legal review before the
  hosted catalog enables or redistributes this profile.
- **Adapter code** (`adapter/`): Parser Arena repository terms (root license
  still undecided).

## History

- 2.7.6 (previous pin): AGPL-3.0 code plus AGPL `doclayout_yolo==0.0.4`.
- 3.1.0: upstream relicensed to the MinerU Open Source License.
- Repository decision log entry 2026-07-19 records this upgrade as a
  licensing decision, not a routine version bump.

Catalog consequence: `hosted` availability requires visible attribution and a
completed model-weight review; the scale thresholds are far above any planned
deployment.
