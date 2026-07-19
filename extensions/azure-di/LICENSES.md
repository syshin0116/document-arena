# Azure Document Intelligence extension licenses

Status: the extension source is distributed under the root MIT license. A
hosted offering still requires the normal Azure account, privacy, and billing
review described below.

- **Azure AI Document Intelligence** is a paid Microsoft cloud service, not
  bundled software. This extension calls it over the network with a
  customer-supplied endpoint and key; usage is governed by the customer's
  Azure agreement and billed per page. No Azure model or weight ships in this
  image.
- **`azure-ai-documentintelligence`** (Python SDK, pinned 1.0.2): MIT.
- **Adapter code** (`adapter/`): MIT, under the Document Arena root license.
  Normalization reads the SDK's native line, word, paragraph, table, span, and
  polygon fields directly; it contains no third-party application code.

Operational note: this is the first component that requires outbound network
and an external credential. The endpoint and key are provided through a local
connection and injected as env vars at run time; they are never written to any
artifact, log, or export. Secrets shared in plaintext (for example in chat)
should be rotated in the Azure portal.
