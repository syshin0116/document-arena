import assert from "node:assert/strict";
import test from "node:test";
import { componentAvailability } from "../services/runner/component-availability.mjs";

test("local components are runnable when their pinned image exists", () => {
  assert.deepEqual(
    componentAvailability({
      imageAvailable: true,
      requirements: { network: "none" },
      env: {},
    }),
    { runnable: true, reasons: [] },
  );
});

test("a missing image disables execution without hiding the component", () => {
  const availability = componentAvailability({
    imageAvailable: false,
    requirements: { network: "none" },
    env: {},
  });

  assert.equal(availability.runnable, false);
  assert.deepEqual(availability.reasons.map((reason) => reason.code), [
    "image-unavailable",
  ]);
});

test("remote readiness checks every connection value without leaking it", () => {
  const requirements = {
    network: "remote",
    connection: {
      type: "partner-api",
      env: { endpoint: "PARTNER_ENDPOINT", key: "PARTNER_SECRET" },
    },
  };
  const unavailable = componentAvailability({
    imageAvailable: true,
    requirements,
    env: { PARTNER_ENDPOINT: "https://example.invalid", PARTNER_SECRET: "" },
  });

  assert.equal(unavailable.runnable, false);
  assert.equal(unavailable.reasons[0].code, "connection-unavailable");
  assert.match(unavailable.reasons[0].message, /partner-api/);
  assert.doesNotMatch(
    JSON.stringify(unavailable),
    /PARTNER_ENDPOINT|PARTNER_SECRET|example\.invalid/,
  );

  assert.deepEqual(
    componentAvailability({
      imageAvailable: true,
      requirements,
      env: {
        PARTNER_ENDPOINT: "https://example.invalid",
        PARTNER_SECRET: "configured-secret",
      },
    }),
    { runnable: true, reasons: [] },
  );
});
