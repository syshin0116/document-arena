import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const [arenaSource, globalCss] = await Promise.all([
  readFile(new URL("../app/ui/ArenaBattle.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);
let appOrigin;
let nextServer;
let serverOutput = "";

function startNextServer() {
  nextServer = spawn(
    "bun",
    [
      "run",
      "start",
      "--",
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return new Promise((resolveOrigin, reject) => {
    let checking = false;
    let settled = false;
    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Next.js did not become ready within 20 seconds.\n${serverOutput}`,
        ),
      );
    }, 20_000);

    function finish(callback) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    }

    function fail(error) {
      finish(() => reject(error));
    }

    async function waitUntilReachable(origin) {
      const deadline = Date.now() + 15_000;
      while (!settled && Date.now() < deadline) {
        try {
          const response = await fetch(origin);
          await response.body?.cancel();
          finish(() => resolveOrigin(origin));
          return;
        } catch {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
        }
      }
      if (!settled) {
        fail(new Error(`Next.js was not reachable.\n${serverOutput}`));
      }
    }

    function collect(chunk) {
      serverOutput += chunk.toString();
      if (checking) return;
      const match = serverOutput.match(
        /https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/,
      );
      if (!match) return;
      checking = true;
      void waitUntilReachable(`http://127.0.0.1:${match[1]}`);
    }

    nextServer.stdout.on("data", collect);
    nextServer.stderr.on("data", collect);
    nextServer.once("error", fail);
    nextServer.once("exit", (code, signal) => {
      if (!settled) {
        fail(
          new Error(
            `Next.js exited before it became ready (${code ?? signal}).\n${serverOutput}`,
          ),
        );
      }
    });
  });
}

before(async () => {
  appOrigin = await startNextServer();
});

after(async () => {
  if (!nextServer || nextServer.exitCode !== null) return;

  const exited = once(nextServer, "exit");
  nextServer.kill("SIGTERM");
  let shutdownTimer;
  const forced = await Promise.race([
    exited.then(() => {
      clearTimeout(shutdownTimer);
      return false;
    }),
    new Promise((resolveTimeout) =>
      (shutdownTimer = setTimeout(() => resolveTimeout(true), 5_000)),
    ),
  ]);
  if (forced && nextServer.exitCode === null) {
    nextServer.kill("SIGKILL");
    await once(nextServer, "exit");
  }
});

async function requestApp(path = "/", init = {}) {
  return fetch(`${appOrigin}${path}`, {
    ...init,
    headers: { accept: "text/html", ...init.headers },
  });
}

function render(path = "/") {
  return requestApp(path);
}

test("server-renders the focused PDF upload experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Document Arena · Compare document pipelines<\/title>/i);
  assert.match(html, /Parse first\. Compare with evidence\./);
  assert.match(html, /Bring your PDF into focus/);
  assert.match(html, /type="file"/);
  assert.match(html, /accept="application\/pdf,.pdf"/);
  assert.match(html, /Your document stays in this browser until you choose a runner/);
  // Arena and standings are navigation, so the home page names them. It still
  // must not surface parser choice: that is a decision the workspace makes
  // after upload, and putting it here is what docs/PAGES.md rules out.
  assert.match(html, /href="\/arena"/);
  assert.match(html, /href="\/leaderboard"/);
  assert.doesNotMatch(html, /href="\/settings\/connections"/);
  assert.doesNotMatch(html, /OpenDataLoader|MinerU/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("server-renders the source-linked demo workspace", async () => {
  const response = await render("/documents/demo");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /llama-open-and-efficient-foundation-language-models\.pdf/);
  assert.match(html, /Source PDF/);
  assert.match(html, /Original file/);
  assert.match(html, /OpenDataLoader/);
  // The demo shows one real run, not a real one beside a hand-written second
  // candidate. MinerU has not been run over the sample, so it must not appear.
  assert.doesNotMatch(html, /MinerU/);
  assert.match(html, /Loading source PDF/);
  assert.match(html, /Starting the local PDF renderer/);
  assert.match(html, /Run another parser/);
  assert.doesNotMatch(html, /\/settings\/connections/);
  assert.doesNotMatch(html, /Hover either side/);
  assert.doesNotMatch(html, /Parsed result</);
  assert.doesNotMatch(html, /Parser-native source regions/);
  assert.doesNotMatch(html, /aria-label="Highlight parsed Document title"/);
});

test("server-renders the blind arena intro", async () => {
  const response = await render("/arena");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Two parsers\. No labels\. Your call\./);
  assert.match(html, /Start a sample battle/);
  assert.doesNotMatch(html, /Candidate A/);
});

test("mobile Arena keeps source and both candidates reachable before voting", () => {
  assert.match(arenaSource, /aria-label="Arena view"/);
  assert.match(
    arenaSource,
    /aria-pressed=\{mobilePane === "source"\}[\s\S]*aria-controls="arena-source-pane"/,
  );
  assert.match(
    arenaSource,
    /aria-pressed=\{mobilePane === "candidate-a"\}[\s\S]*aria-controls="arena-candidate-a"/,
  );
  assert.match(
    arenaSource,
    /aria-pressed=\{mobilePane === "candidate-b"\}[\s\S]*aria-controls="arena-candidate-b"/,
  );

  assert.match(
    globalCss,
    /\.arena-shell\[data-phase="blind"\],[\s\S]*grid-template-rows:\s*58px\s+42px\s+minmax\(0,\s*1fr\)\s+auto/,
  );
  assert.match(
    globalCss,
    /\.arena-canvas\[data-mobile-pane="source"\]\s+\.results-pane/,
  );
  assert.match(
    globalCss,
    /data-mobile-pane="candidate-a"[\s\S]*data-arena-candidate="b"/,
  );
  assert.match(
    globalCss,
    /data-phase="blind"\]\[data-mobile-pane="source"\][\s\S]*\.arena-vote-bar\s*\{\s*display:\s*none/,
  );
});

test("server-renders the leaderboard with a device-local empty state", async () => {
  const response = await render("/leaderboard");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Who wins blind votes\?/);
  assert.match(html, /No blind votes yet\./);
  assert.match(html, /Methodology/);
});

test("built demo content endpoint serves complete and ranged PDF bytes", async () => {
  const complete = await requestApp("/v1/documents/demo/content", {
    headers: { accept: "application/pdf" },
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.headers.get("content-type"), "application/pdf");
  assert.equal(complete.headers.get("accept-ranges"), "bytes");
  const size = Number(complete.headers.get("content-length"));
  const completeBytes = new Uint8Array(await complete.arrayBuffer());
  assert.equal(completeBytes.length, size);
  assert.match(new TextDecoder().decode(completeBytes.slice(0, 8)), /^%PDF-1\.\d$/);

  const ranged = await requestApp("/v1/documents/demo/content", {
    headers: { accept: "application/pdf", range: "bytes=0-7" },
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-range"), `bytes 0-7/${size}`);
  assert.equal(ranged.headers.get("content-length"), "8");
  assert.match(
    new TextDecoder().decode(await ranged.arrayBuffer()),
    /^%PDF-1\.\d$/,
  );
});
