# PDF.js runtime assets

The versioned directories here are copied from the exactly pinned
`pdfjs-dist` dependency so the interactive viewer can render CMaps, standard
fonts, JPEG 2000 images, and ICC color profiles without a third-party CDN.

Keep the directory version, `package.json` pin, viewer URLs, and bundled worker
on the same PDF.js release. Each version directory retains the upstream PDF.js
and codec/font license files.
