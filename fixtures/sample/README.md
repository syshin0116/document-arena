# Sample documents

The documents the landing page offers, and everything the demo shows about
them. `llama` is the one served at `/documents/demo`.

## Licensing

All three are licensed **CC BY 4.0**
(https://creativecommons.org/licenses/by/4.0/), which is why they can be
redistributed here. Most well-known AI papers cannot be: arXiv's default
submission licence is non-exclusive and grants no redistribution right to third
parties, so a paper is only usable as a fixture when its listing explicitly
carries a Creative Commons licence. These do. Check the arXiv listing, not the
reputation of the paper, before swapping in another:

```
curl -s https://arxiv.org/abs/<id> | grep -o 'creativecommons.org/licenses/[a-z-]*/[0-9.]*'
```

Each file is the unmodified arXiv PDF. Do not re-encode or re-compress them:
the parses below are keyed to those exact bytes by SHA-256.

## The documents

### `llama-open-and-efficient-foundation-language-models.pdf`

> Touvron, H., Lavril, T., Izacard, G., Martinet, X., Lachaux, M-A., Lacroix, T.,
> Rozière, B., Goyal, N., Hambro, E., Azhar, F., Rodriguez, A., Joulin, A.,
> Grave, E., Lample, G. (2023).
> *LLaMA: Open and Efficient Foundation Language Models.*
> arXiv:2302.13971. https://arxiv.org/abs/2302.13971

27 pages, 902 blocks, 844 parser-native source regions. Dense benchmark tables:
7 tables and 335 table cells.

### `mistral-7b.pdf`

> Jiang, A. Q., Sablayrolles, A., Mensch, A., Bamford, C., Chaplot, D. S.,
> de las Casas, D., Bressand, F., Lengyel, G., Lample, G., Saulnier, L.,
> Lavaud, L. R., Lachaux, M-A., Stock, P., Le Scao, T., Lavril, T., Wang, T.,
> Lacroix, T., El Sayed, W. (2023).
> *Mistral 7B.*
> arXiv:2310.06825. https://arxiv.org/abs/2310.06825

9 pages, 140 blocks, 140 parser-native source regions. Figure-heavy and short:
6 images, no tables at all, so every block carries its own native region.

### `mamba-linear-time-sequence-modeling-with-selective-state-spaces.pdf`

> Gu, A., Dao, T. (2023).
> *Mamba: Linear-Time Sequence Modeling with Selective State Spaces.*
> arXiv:2312.00752. https://arxiv.org/abs/2312.00752

36 pages, 909 blocks, 836 parser-native source regions. The long one: 17 small
tables and 285 list items across nested lists and algorithm blocks.

## The parses

`<slug>-opendataloader-parsed-document.json` is real output from a real run, not
a fixture written by hand:

```
bun services/runner/run-local.mjs \
  --manifest extensions/opendataloader-pdf/component.json \
  --input fixtures/sample/<file>.pdf
```

`<slug>-opendataloader-run.json` keeps the component identity, image digest,
source hash, resolved options, and timing from the same run.

The demo previously drew a synthetic PDF with text operators and paired it with
three bounding boxes typed in by hand, each labelled `provenance: "native"`.
Nothing had been parsed. That contradicted the product's own claim that derived
artifacts never masquerade as native evidence, so it was replaced with this.

## Thumbnails

`public/samples/<slug>.webp` is page 1 of each PDF, rendered at 150 dpi with
`pdftoppm` and resized to 320px wide with ImageMagick:

```
pdftoppm -f 1 -l 1 -r 150 -png fixtures/sample/<file>.pdf /tmp/<slug>
magick /tmp/<slug>-1.png -resize 320x -quality 80 -define webp:method=6 \
  public/samples/<slug>.webp
```

## Why only one parser here

Committing a parsed-document fixture per candidate is a stopgap, not the plan.
Once artifact storage is connected, each parser runs for real and its output is
stored rather than checked in, and the demo can show a genuine multi-candidate
comparison. Until then the demo deliberately shows one result: a second column
would have to be written by hand, which is exactly what this directory exists to
undo.

So do not add a hand-authored second candidate to make the compare view look
populated. Either run the parser and store its real output, or leave the column
out.

## Regenerating

Rebuild the image first, since a stale one speaks an older job-event
apiVersion:

```
bun run parser:build:opendataloader
```

Then re-run the command above and copy `primary/parsed-document.json` here,
along with the `component`, `source`, `timing` and `options` keys of
`bundle.json` as the run JSON. If the block indices on page 1 of the llama
document shift, update `demoEvidenceRegions` in `app/ui/Workspace.tsx`, which
cites that file by block id and JSON pointer.
