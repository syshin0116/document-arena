import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  remoteConsentApprovalKey,
  requiresRemoteConsent,
  runnerConnectionType,
} from "../app/local-runner";
import { RemoteRunConsentDialog } from "../app/ui/Workspace";

const css = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function component(id, requirements) {
  return {
    id,
    version: "1.0.0",
    displayName: "Partner OCR",
    image: "example.invalid/partner-ocr@sha256:test",
    requirements,
  };
}

test("remote consent is derived only from the manifest network requirement", () => {
  const arbitraryRemote = component("future-partner-parser", {
    network: "remote",
    connection: { type: "partner-ocr" },
  });

  assert.equal(requiresRemoteConsent(arbitraryRemote), true);
  assert.equal(
    requiresRemoteConsent(component("azure-di", { network: "none" })),
    false,
    "a familiar id must not make an otherwise local component remote",
  );
  assert.equal(
    requiresRemoteConsent(
      component("another-parser", { connection: { type: "remote-api" } }),
    ),
    false,
    "a connection alone must not replace the manifest network declaration",
  );
  assert.equal(requiresRemoteConsent(component("offline", undefined)), false);
  assert.equal(runnerConnectionType(arbitraryRemote), "partner-ocr");
});

test("remote approval is scoped to the exact document and component version", () => {
  const remote = component("future-partner-parser", { network: "remote" });
  const key = remoteConsentApprovalKey("local_document-a", remote);

  assert.equal(
    key,
    remoteConsentApprovalKey("local_document-a", remote),
  );
  assert.notEqual(
    key,
    remoteConsentApprovalKey("local_document-b", remote),
  );
  assert.notEqual(
    key,
    remoteConsentApprovalKey("local_document-a", {
      ...remote,
      id: "another-parser",
    }),
  );
  assert.notEqual(
    key,
    remoteConsentApprovalKey("local_document-a", {
      ...remote,
      version: "2.0.0",
    }),
  );
});

test("remote run confirmation renders the disclosure and modal contract", () => {
  const html = renderToStaticMarkup(
    createElement(RemoteRunConsentDialog, {
      component: component("future-partner-parser", {
        network: "remote",
        connection: {
          type: "partner-ocr",
          env: { key: "REMOTE_API_KEY" },
        },
      }),
      fileName: "quarterly-report.pdf",
      fileSize: 123_456,
      confirming: false,
      onCancel() {},
      onConfirm() {},
    }),
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="remote-consent-title"/);
  assert.match(
    html,
    /aria-describedby="remote-consent-description remote-consent-warning"/,
  );
  assert.match(html, /Send this PDF to Partner OCR\?/);
  assert.match(html, /quarterly-report\.pdf/);
  assert.match(html, /123,456 bytes/);
  assert.match(html, /Connection type/);
  assert.match(html, /partner-ocr/);
  assert.match(html, /Provider billing may apply/);
  assert.match(html, /logging or retention/);
  assert.match(html, />Cancel</);
  assert.match(html, />Send and run</);
  assert.doesNotMatch(html, /REMOTE_API_KEY/);
});

test("confirmation controls expose an in-flight disabled state", () => {
  const html = renderToStaticMarkup(
    createElement(RemoteRunConsentDialog, {
      component: component("future-partner-parser", { network: "remote" }),
      fileName: "report.pdf",
      fileSize: 7,
      confirming: true,
      onCancel() {},
      onConfirm() {},
    }),
  );

  assert.match(html, /aria-busy="true"/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2);
  assert.match(html, />Starting…</);
});

test("remote confirmation CSS is blocking, responsive, and motion-free", () => {
  const backdrop = /\.remote-consent-backdrop\s*\{([^}]*)\}/.exec(css)?.[1];
  const dialog = /\.remote-consent-dialog\s*\{([^}]*)\}/.exec(css)?.[1];

  assert.ok(backdrop);
  assert.match(backdrop, /position:\s*fixed/);
  assert.match(backdrop, /inset:\s*0/);
  assert.match(backdrop, /z-index:\s*100/);
  assert.ok(dialog);
  assert.match(dialog, /width:\s*min\(520px, 100%\)/);
  assert.match(dialog, /max-height:\s*calc\(100dvh - 48px\)/);
  assert.doesNotMatch(`${backdrop}${dialog}`, /animation|transition/);
});
