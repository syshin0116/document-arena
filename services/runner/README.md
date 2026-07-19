# Local component runner

`run-local.mjs` is the smallest executable boundary for parser extensions. It
loads a component manifest, pins the run to the inspected local image ID, starts
one network-disabled OCI container, and validates every declared output before
returning it.

It intentionally is not a scheduler, public API, LangGraph node, or Redis worker.
Those layers can call the exported `runComponent()` function later without
changing the extension protocol.

## Run

```bash
bun services/runner/run-local.mjs \
  --manifest extensions/opendataloader-pdf/component.json \
  --input work/fixtures/document-arena-smoke.pdf
```

Use `--output <new-directory>` to choose an output directory and
`--options '{"pages":"1-2"}'` to pass component options. The runner refuses to reuse an
existing output directory.

The container has no network, a read-only root filesystem, dropped Linux
capabilities, bounded CPU/memory/PIDs, a temporary `/tmp`, read-only input and
request mounts, and one writable output mount. The host still needs to treat
third-party parsers as untrusted and apply stronger isolation before offering
this as a public multi-tenant service.
