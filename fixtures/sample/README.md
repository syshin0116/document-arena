# Sample document

The document served at `/documents/demo`, and everything the demo shows about it.

## The document

`llama-open-and-efficient-foundation-language-models.pdf`

> Touvron, H., Lavril, T., Izacard, G., Martinet, X., Lachaux, M-A., Lacroix, T.,
> Rozière, B., Goyal, N., Hambro, E., Azhar, F., Rodriguez, A., Joulin, A.,
> Grave, E., Lample, G. (2023).
> *LLaMA: Open and Efficient Foundation Language Models.*
> arXiv:2302.13971. https://arxiv.org/abs/2302.13971

Licensed **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/), which is
why it can be redistributed here. Most well-known AI papers cannot be: arXiv's
default submission licence is non-exclusive and grants no redistribution right
to third parties, so a paper is only usable as a fixture when its listing
explicitly carries a Creative Commons licence. This one does. Check the arXiv
listing, not the reputation of the paper, before swapping in another.

The file is the unmodified arXiv PDF. Do not re-encode or re-compress it: the
parse below is keyed to these exact bytes by SHA-256.

## The parse

`llama-opendataloader-parsed-document.json` is real output from a real run, not
a fixture written by hand:

```
bun services/runner/run-local.mjs \
  --manifest extensions/opendataloader-pdf/component.json \
  --input fixtures/sample/llama-open-and-efficient-foundation-language-models.pdf
```

27 pages, 902 blocks, 844 parser-native source regions.
`llama-opendataloader-run.json` keeps the component identity, image digest,
source hash, resolved options, and timing from the same run.

The demo previously drew a synthetic PDF with text operators and paired it with
three bounding boxes typed in by hand, each labelled `provenance: "native"`.
Nothing had been parsed. That contradicted the product's own claim that derived
artifacts never masquerade as native evidence, so it was replaced with this.

## Regenerating

Rebuild the image first, since a stale one speaks an older job-event
apiVersion:

```
bun run parser:build:opendataloader
```

Then re-run the command above and copy `primary/parsed-document.json` here. If
the block indices on page 1 shift, update `demoEvidenceRegions` in
`app/ui/Workspace.tsx`, which cites this file by block id and JSON pointer.
