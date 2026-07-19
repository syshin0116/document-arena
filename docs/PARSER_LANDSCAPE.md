# Open-source parser landscape

Snapshot: 2026-07-14  
Status: research input, not a permanent ranking

GitHub stars and release numbers change quickly. They are maintenance/adoption
signals, not quality evidence; Document Arena's own paired evaluation outranks
upstream benchmark claims.

## Initial shortlist

The shortlist is intentionally small. The MVP implements OpenDataLoader first
and MinerU second; LightOnOCR is the first post-MVP VLM candidate.

| Parser/profile | Plan | Important constraint |
|---|---|---|
| [OpenDataLoader PDF](https://github.com/opendataloader-project/opendataloader-pdf) deterministic | M1: one-click CPU vertical slice with native element boxes | Use deterministic mode. Hybrid currently invokes `docling-fast`, so it is a composite profile rather than an independent baseline |
| [MinerU](https://github.com/opendatalab/MinerU) Pipeline | M2: second real parser needed to prove comparison and dynamic registration | Pin Pipeline as its own profile; VLM/hybrid are separate entries. Its Apache-derived license requires visible hosted-service attribution and has scale thresholds |
| [LightOnOCR-2-1B](https://huggingface.co/lightonai/LightOnOCR-2-1B) | Later: first compact VLM profile | The general model is text-first. Its [bbox variant](https://huggingface.co/lightonai/LightOnOCR-2-1B-bbox) localizes embedded images rather than supplying complete text-block provenance, so text blocks have no source-region mapping in the MVP |

The shortlist covers native geometry, a heavier modular pipeline, and VLM
output. It does not claim to identify the globally best parsers or require all
three before the product is useful.

## Strong follow-up candidates

These wait until the two-parser MVP and fixture stage prove that a contribution
needs only an extension package and manifest.

| Candidate | Distinct value | Integration note |
|---|---|---|
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | large multilingual community; PP-StructureV3 and PaddleOCR-VL cover classical structured parsing and document VLMs | Treat PP-StructureV3 and each VL model as separate profiles |
| [Docling](https://github.com/docling-project/docling) / [GraniteDocling](https://huggingface.co/ibm-granite/granite-docling-258M) | rich `DoclingDocument` provenance and boxes; the small Granite model exercises a different VLM-to-structure path | Treat standard Docling and GraniteDocling as separate profiles; inspect every bundled model license |
| [GLM-OCR](https://github.com/zai-org/GLM-OCR) | compact model with a two-stage layout pipeline, Markdown, and JSON boxes | Attractive geometry-capable VLM candidate, but pin its still-young SDK and serving stack tightly |
| [LiteParse](https://github.com/run-llama/liteparse) | fast Rust/PDFium CPU and WASM path with Markdown/JSON and geometry | Useful low-cost baseline with a small deployment footprint |
| [olmOCR](https://github.com/allenai/olmocr) | established open document VLM and useful robustness benchmark ecosystem | GPU-heavy and largely Markdown-oriented; geometry is N/A in the MVP rather than recovered through post-hoc alignment |

## Experimental watchlist

Keep these in a rotating experimental catalog rather than making the core depend
on them:

- [DeepSeek-OCR-2](https://github.com/deepseek-ai/DeepSeek-OCR-2): active 3B
  document VLM, but a young integration surface with no mature release history.
- [dots.mocr](https://github.com/rednote-hilab/dots.mocr): MIT-tagged code and
  weights with promising bbox/category/text JSON and Markdown/visualization
  output, but only a handful of repository commits and no mature release line;
  review the additional agreement shipped beside its MIT files.
- [MonkeyOCRv2](https://github.com/Yuliang-Liu/MonkeyOCRv2): 0.6B/0.7B
  parsing models with bbox/label/content output and permissive weights, released
  only days before this snapshot.
- [Unlimited OCR](https://github.com/olmocr/unlimited-ocr): interesting new
  entrant with too little release history for the default hosted catalog.

Experimental adapters use the same result contract but display maturity,
revision age, unsupported capabilities, and a non-default execution flag.

## License-gated or hosted-disabled

Open-source code does not imply that model weights permit a competing public
service. Keep adapter availability separate from hosted activation.

| Candidate | Reason for gate |
|---|---|
| [Marker](https://github.com/datalab-to/marker) | GPL code plus separate model terms with commercial thresholds |
| [Surya](https://github.com/datalab-to/surya) | Apache code, but weight terms add revenue and service-use constraints |
| [Chandra OCR](https://github.com/datalab-to/chandra) | model terms restrict competing API/service use |
| [PyMuPDF4LLM](https://github.com/pymupdf/pymupdf4llm) | AGPL/commercial dual-licensing implications for a hosted product |
| [Kreuzberg](https://github.com/Goldziher/kreuzberg) | Elastic License 2.0 is source-available rather than a conventional permissive OSS service dependency |
| [HunyuanOCR](https://github.com/Tencent-Hunyuan/HunyuanOCR/blob/main/LICENSE) | its community license explicitly excludes South Korea, the EU, and UK from the licensed territory |
| [Nougat](https://github.com/facebookresearch/nougat) | model weights are non-commercial and the project is now a legacy academic baseline |

The catalog manifest records code license, model license, hosted allowance,
attribution, redistribution, review date, and reviewer separately. Legal review
is repeated when a pinned upstream revision or model changes.

## Components, not equivalent full parsers

- [Tesseract](https://github.com/tesseract-ocr/tesseract) is an OCR lower bound,
  not a table/formula/layout parser.
- [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF) is a searchable-PDF
  preprocessor and should be modeled as a pipeline stage.
- [MarkItDown](https://github.com/microsoft/markitdown) and
  [Unstructured](https://github.com/Unstructured-IO/unstructured) are useful
  conversion/ETL baselines, but their product roles differ from high-fidelity
  page parsing.

They may appear in a separate baseline or pipeline category. Unsupported
capabilities are N/A, not zero, and full parsers are not ranked against OCR-only
components under one opaque overall score.

## Admission policy

A candidate enters the stable catalog only when it has:

1. a pinned and reproducible OCI/model build;
2. a complete license and hosted-use review;
3. an adapter manifest with truthful capability levels;
4. passing conformance, failure, resource, and fixture tests;
5. measured value on an architecture/capability cell not already covered, or a
   meaningful quality/cost improvement over an existing stable adapter;
6. no parser-specific core or UI change.

Popularity can nominate a candidate. It cannot bypass these gates.
