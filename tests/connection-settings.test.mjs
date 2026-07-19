import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [settingsSource, runnerClientSource, settingsPageSource, workspaceSource, css] = await Promise.all([
  readFile(new URL("../app/ui/ConnectionSettings.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/local-runner.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/settings/connections/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/ui/Workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("connection settings are generated without provider-specific UI branches", () => {
  assert.match(settingsSource, /connection\.fields\.map/);
  assert.match(settingsSource, /field\.secret \? "password"/);
  assert.doesNotMatch(settingsSource, /azure-di|AZURE_DI|OpenAI|Anthropic/);
});

test("connection settings do not write secrets to browser persistence or URLs", () => {
  assert.doesNotMatch(
    `${settingsSource}\n${runnerClientSource}`,
    /localStorage|sessionStorage|indexedDB/,
  );
  assert.match(runnerClientSource, /body: JSON\.stringify\(\{ values \}\)/);
  assert.match(
    runnerClientSource,
    /\/v1\/connections\/\$\{encodeURIComponent\(type\)\}/,
  );
  assert.doesNotMatch(runnerClientSource, /searchParams.*values|options.*values/);
  assert.match(settingsSource, /field\.secret \? "off"/);
  assert.doesNotMatch(settingsSource, /new-password/);
});

test("connection setup preserves a safe workspace return path on mobile", () => {
  assert.match(settingsPageSource, /\^\\\/documents\\\//);
  assert.match(workspaceSource, /const connectionsHref = `\/settings\/connections\?returnTo=/);
  assert.match(workspaceSource, /connection-unavailable/);
  assert.match(css, /\.workspace-actions \.connections-button \{ width: 36px/);
  assert.match(css, /\.landing-secondary-link \{ display: none; \}/);
  assert.doesNotMatch(css, /\.connections-button\s*\{\s*display:\s*none/);
});

test("connection feedback is card-scoped and distinguishes errors", () => {
  assert.match(settingsSource, /feedback\[connection\.type\]/);
  assert.match(settingsSource, /connectionFeedback\.kind === "error" \? "alert" : "status"/);
  assert.match(settingsSource, /primaryButtons\.current\[connection\.type\]/);
  assert.match(settingsSource, /aria-busy=\{retrying\}/);
});
