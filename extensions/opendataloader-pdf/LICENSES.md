# OpenDataLoader extension licenses

The adapter source in this directory follows the Parser Arena project's root
license once that license is selected.

Runtime dependencies:

| Dependency | Version | License | Source |
|---|---:|---|---|
| OpenDataLoader PDF | 2.5.0 | Apache-2.0 | https://github.com/opendataloader-project/opendataloader-pdf |
| Commander | 15.0.0 | MIT | https://github.com/tj/commander.js |
| PDF.js (`pdfjs-dist`) | 6.1.200 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| `@napi-rs/canvas` (PDF.js optional native dependency) | 1.0.2 | MIT | https://github.com/Brooooooklyn/canvas |
| Bun package installer | 1.3.10 | MIT | https://github.com/oven-sh/bun |
| Eclipse Temurin JRE | 17.0.18+8 | GPL-2.0 with Classpath Exception | https://github.com/adoptium/containers |
| Node.js runtime | 22.22.0 | MIT and bundled third-party notices | https://github.com/nodejs/node |

The official `@opendataloader/pdf` registry package includes its own `LICENSE`,
`NOTICE`, and third-party notices in the installed package. The container keeps
those files under `node_modules/@opendataloader/pdf/`.
