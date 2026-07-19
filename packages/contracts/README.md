# Document Arena contracts

The `schemas/` directory contains the first portable contracts exercised by the
OpenDataLoader vertical slice:

- a provider-neutral component manifest;
- an OCI batch stage request;
- small phase progress events;
- a validated result bundle;
- a canonical parsed document with parser-native source regions;
- a catalog entry describing one reviewed, runnable component.

These schemas intentionally contain no LangGraph, Redis, Docker socket, local
path, or object-store provider concepts. Delivery adapters translate logical
artifact references into the mounts used by one runner invocation.

## Catalog entries

A catalog entry is the registry's reviewed view over a component manifest. The
manifest says what a component *is*; the entry adds what the service *decided*
about it: the pinned image digest, maturity (`stable`, `experimental`,
`license-gated`), availability per deployment (`local`, `self-host`,
`hosted`), the reviewed named profiles with revisions, and the license review
result. The slot dropdown in the UI renders catalog entries and their
profiles; it never reads extension directories directly.

Two deliberate non-features: there is no separate entry type for OCR models or
VLMs (they are `role: parser` with different capabilities), and LLM choice is
not a catalog concern (an LLM postprocessor entry declares `connectionTypes`;
the concrete provider and model come from the user's named connection).

`examples/catalog-entry.opendataloader.json` documents the shape with a
placeholder digest; real entries pin the reviewed digest.
