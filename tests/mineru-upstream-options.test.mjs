import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const extensionRoot = resolve(root, "extensions/mineru-pipeline");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("MinerU schema mirrors the pinned public CLI choices", async () => {
  const schema = await readJson(resolve(extensionRoot, "options.schema.json"));

  assert.deepEqual(Object.keys(schema.properties), [
    "inputPath",
    "outputDirectory",
    "apiUrl",
    "method",
    "backend",
    "effort",
    "lang",
    "serverUrl",
    "startPage",
    "endPage",
    "formula",
    "table",
    "imageAnalysis",
    "clientSideOutputGeneration",
    "device",
    "modelSource",
    "modelRevision",
    "chineseFormula",
    "mergeCrossPageTables",
    "pdfRenderTimeoutSeconds",
    "pdfRenderThreads",
    "processingWindowSize",
    "intraOpThreads",
    "interOpThreads",
  ]);
  assert.deepEqual(
    schema.properties.backend.oneOf.map((choice) => choice.const),
    [
      "pipeline",
      "vlm-engine",
      "hybrid-engine",
      "vlm-http-client",
      "hybrid-http-client",
    ],
  );
  assert.deepEqual(
    schema.properties.method.oneOf.map((choice) => choice.const),
    ["auto", "txt", "ocr"],
  );
  assert.deepEqual(
    schema.properties.lang.oneOf.map((choice) => choice.const),
    [
      "ch",
      "ch_server",
      "korean",
      "ta",
      "te",
      "ka",
      "th",
      "el",
      "arabic",
      "east_slavic",
      "cyrillic",
      "devanagari",
    ],
  );
  assert.equal(schema.properties.lang.default, "ch");
  assert.equal(
    schema.properties.backend["x-document-arena"].availability.state,
    "fixed",
  );
  for (const name of [
    "apiUrl",
    "effort",
    "serverUrl",
    "startPage",
    "endPage",
    "imageAnalysis",
    "clientSideOutputGeneration",
  ]) {
    assert.equal(
      schema.properties[name]["x-document-arena"].availability.state,
      "unavailable",
      `${name} must stay visible with an unavailable reason`,
    );
  }
});

test("MinerU adapter validates and records effective pipeline settings", () => {
  const adapterPath = resolve(extensionRoot, "adapter/main.py");
  const script = `
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("mineru_adapter", ${JSON.stringify(adapterPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

result = {
    "defaults": module.resolve_options({}),
    "custom": module.resolve_options({
        "method": "ocr",
        "lang": "korean",
        "formula": False,
        "table": True,
        "chineseFormula": True,
        "mergeCrossPageTables": False,
        "pdfRenderTimeoutSeconds": 120,
        "pdfRenderThreads": 2,
        "processingWindowSize": 32,
        "intraOpThreads": 4,
        "interOpThreads": -1,
    }),
}
canonical, _, _ = module.build_canonical(
    middle={"pdf_info": [{"page_idx": 0, "page_size": [612, 792]}]},
    content_list=[],
    markdown="",
    source_artifact_id="source:document",
    raw_artifact_id="raw:mineru",
    file_name="document.pdf",
)
result["canonicalRawArtifactRefs"] = canonical["rawArtifactRefs"]
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    source = root / "source"
    (source / "images").mkdir(parents=True)
    for relative, content in {
        "document.md": "# document",
        "document_middle.json": "{}",
        "document_content_list.json": "[]",
        "document_content_list_v2.json": "[]",
        "document_model.json": "{}",
        "images/figure.png": "png",
    }.items():
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    copied = module.copy_raw_outputs(source, root / "raw")
    result["rawFiles"] = [
        str(path.relative_to(root / "raw")) for path in copied
    ]
for name, options in {
    "oldLanguageRejected": {"lang": "auto"},
    "unavailableRejected": {"serverUrl": "http://localhost:30000"},
    "zeroThreadsRejected": {"intraOpThreads": 0},
}.items():
    try:
        module.resolve_options(options)
    except ValueError:
        result[name] = True
    else:
        result[name] = False
print(json.dumps(result))
`;
  const completed = spawnSync("python3", ["-c", script], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(completed.status, 0, completed.stderr);
  const result = JSON.parse(completed.stdout);
  assert.equal(result.defaults.backend, "pipeline");
  assert.equal(result.defaults.method, "auto");
  assert.equal(result.defaults.lang, "ch");
  assert.equal(result.defaults.pdfRenderTimeoutSeconds, 300);
  assert.equal(result.defaults.processingWindowSize, 64);
  assert.equal(result.custom.method, "ocr");
  assert.equal(result.custom.lang, "korean");
  assert.equal(result.custom.chineseFormula, true);
  assert.equal(result.custom.mergeCrossPageTables, false);
  assert.deepEqual(result.canonicalRawArtifactRefs, ["raw:mineru"]);
  assert.deepEqual(result.rawFiles, [
    "mineru-output/document.md",
    "mineru-output/document_content_list.json",
    "mineru-output/document_content_list_v2.json",
    "mineru-output/document_middle.json",
    "mineru-output/document_model.json",
    "mineru-output/images/figure.png",
  ]);
  assert.equal(result.oldLanguageRejected, true);
  assert.equal(result.unavailableRejected, true);
  assert.equal(result.zeroThreadsRejected, true);
});

test("MinerU process uses supported CLI flags and pipeline environment controls", async () => {
  const source = await readFile(resolve(extensionRoot, "adapter/main.py"), "utf8");
  const component = await readJson(resolve(extensionRoot, "component.json"));
  const dockerfile = await readFile(resolve(extensionRoot, "Dockerfile"), "utf8");
  const modelBuild = await readFile(
    resolve(extensionRoot, "build/download_models.py"),
    "utf8",
  );
  const pyproject = await readFile(resolve(extensionRoot, "pyproject.toml"), "utf8");
  const lock = await readFile(resolve(extensionRoot, "uv.lock"), "utf8");

  assert.doesNotMatch(source, /["']-d["']/);
  assert.doesNotMatch(source, /["']--source["']/);
  assert.match(source, /"MINERU_FORMULA_CH_SUPPORT"/);
  assert.match(source, /"MINERU_TABLE_MERGE_ENABLE"/);
  assert.match(source, /"MINERU_PROCESSING_WINDOW_SIZE"/);
  assert.match(source, /env=process_env/);
  assert.equal(component.spec.requirements.memoryMiB, 16384);
  assert.match(dockerfile, /document-arena\.upstream\.version="3\.4\.4"/);
  assert.match(
    dockerfile,
    /document-arena\.model\.revision="hf:opendatalab\/PDF-Extract-Kit-1\.0@ed6b654c018d742e65a17671e379c5e6ecc87ec9"/,
  );
  assert.match(
    modelBuild,
    /MODEL_REVISION = "ed6b654c018d742e65a17671e379c5e6ecc87ec9"/,
  );
  assert.match(modelBuild, /revision=MODEL_REVISION/);
  assert.match(source, /"modelRevision": model_revision/);
  assert.match(pyproject, /"six>=1\.17\.0"/);
  assert.match(lock, /name = "six"/);
});
