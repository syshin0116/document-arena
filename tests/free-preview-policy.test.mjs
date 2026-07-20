import { describe, expect, test } from "bun:test";

import {
  FREE_PREVIEW_PROFILE_ID,
  assertFreePreviewResultSize,
  defineFreePreviewProfile,
  evaluateFreePreviewRun,
} from "../services/hosting/free-preview-policy.ts";

const MiB = 1024 * 1024;

function profile(overrides = {}) {
  const {
    limits: limitOverrides = {},
    r2: r2Overrides = {},
    ...profileOverrides
  } = overrides;
  return defineFreePreviewProfile({
    id: FREE_PREVIEW_PROFILE_ID,
    gpu: false,
    maxConcurrency: 1,
    trialCutoffAt: "2026-10-01T00:00:00Z",
    trialSafetyWindowSeconds: 7 * 24 * 60 * 60,
    gcpBillingEvidenceMaxAgeSeconds: 15 * 60,
    limits: {
      maxSourceBytes: 10 * MiB,
      maxResultBytes: 20 * MiB,
      maxJobTimeoutSeconds: 10 * 60,
      maxRunsPerUserPerUtcDay: 2,
      maxRunsPerUserPerUtcMonth: 5,
      ...limitOverrides,
    },
    r2: {
      maxStoredBytes: 100 * MiB,
      maxStorageByteHoursPerUtcMonth: 1_000 * MiB,
      maxClassAOperationsPerUtcMonth: 1_000,
      maxClassBOperationsPerUtcMonth: 2_000,
      retentionSeconds: 24 * 60 * 60,
      classAOperationsPerRun: 3,
      classBOperationsPerRun: 5,
      ...r2Overrides,
    },
    ...profileOverrides,
  });
}

function request(overrides = {}) {
  return {
    profileId: FREE_PREVIEW_PROFILE_ID,
    gpu: false,
    sourceBytes: 2 * MiB,
    timeoutSeconds: 10 * 60,
    ...overrides,
  };
}

function context(overrides = {}) {
  const now = overrides.now ?? new Date("2026-09-01T00:00:00Z");
  const utcDay = now.toISOString().slice(0, 10);
  const utcMonth = utcDay.slice(0, 7);
  return {
    now,
    authenticatedUserId: "user-1",
    allowedUserIds: ["user-1"],
    quota: {
      userId: "user-1",
      utcDay,
      utcMonth,
      grantActive: true,
      runsToday: 0,
      runsThisMonth: 0,
    },
    activeRuns: 0,
    gcpBilling: {
      mode: "free-trial-unupgraded",
      verifiedAt: now.toISOString(),
    },
    r2Usage: {
      utcMonth,
      policyReady: true,
      storedBytes: MiB,
      storageByteHoursThisMonth: 0,
      classAOperationsThisMonth: 0,
      classBOperationsThisMonth: 0,
    },
    ...overrides,
  };
}

function decide({ configuration, run, runContext } = {}) {
  return evaluateFreePreviewRun({
    configuration:
      configuration === undefined
        ? { enabled: true, profile: profile() }
        : configuration,
    request: run ?? request(),
    context: runContext ?? context(),
  });
}

function codes(decision) {
  return decision.reasons.map((reason) => reason.code);
}

describe("free-preview hosted execution policy", () => {
  test("is disabled by default", () => {
    const decision = evaluateFreePreviewRun({
      request: request(),
      context: context(),
    });

    expect(decision.allowed).toBe(false);
    expect(codes(decision)).toEqual(["hosted_disabled"]);
  });

  test("requires one explicit reviewed profile", () => {
    expect(
      codes(decide({ configuration: { enabled: true } })),
    ).toEqual(["profile_required"]);
    expect(codes(decide({ run: request({ profileId: undefined }) }))).toEqual([
      "profile_required",
    ]);
    expect(codes(decide({ run: request({ profileId: "another-profile" }) }))).toContain(
      "profile_not_allowed",
    );
  });

  test("rejects unsafe profile configuration and requires a trial cutoff", () => {
    expect(() => profile({ gpu: true })).toThrow("disable GPU");
    expect(() => profile({ maxConcurrency: 2 })).toThrow(
      "maxConcurrency to exactly one",
    );
    expect(() => profile({ id: "unreviewed-profile" })).toThrow(
      FREE_PREVIEW_PROFILE_ID,
    );
    expect(() => profile({ r2: { retentionSeconds: 3_600 } })).toThrow(
      "exactly one day",
    );

    const missingCutoff = {
      ...profile(),
      trialCutoffAt: undefined,
    };
    expect(
      codes(
        decide({
          configuration: { enabled: true, profile: missingCutoff },
        }),
      ),
    ).toEqual(["trial_cutoff_required"]);
  });

  test("permits CPU only", () => {
    expect(codes(decide({ run: request({ gpu: true }) }))).toContain(
      "cpu_only",
    );
    expect(codes(decide({ run: request({ gpu: undefined }) }))).toContain(
      "cpu_only",
    );
  });

  test("requires current evidence of an unupgraded GCP free trial", () => {
    expect(
      codes(decide({ runContext: context({ gcpBilling: undefined }) })),
    ).toContain("gcp_free_trial_required");
    expect(
      codes(
        decide({
          runContext: context({
            gcpBilling: {
              mode: "paid",
              verifiedAt: "2026-09-01T00:00:00Z",
            },
          }),
        }),
      ),
    ).toContain("gcp_free_trial_required");
    expect(
      codes(
        decide({
          runContext: context({
            gcpBilling: {
              mode: "free-trial-unupgraded",
              verifiedAt: "2026-08-31T23:44:59Z",
            },
          }),
        }),
      ),
    ).toContain("gcp_billing_evidence_stale");
  });

  test("rejects runs that start in or could cross the trial safety window", () => {
    const safe = decide({
      runContext: context({ now: new Date("2026-09-23T23:49:59Z") }),
    });
    expect(safe.allowed).toBe(true);

    const crossing = decide({
      runContext: context({ now: new Date("2026-09-23T23:50:00Z") }),
    });
    expect(codes(crossing)).toContain("trial_safety_window");

    const inside = decide({
      runContext: context({ now: new Date("2026-09-24T00:00:00Z") }),
    });
    expect(codes(inside)).toContain("trial_safety_window");
  });

  test("bounds source, result, and job duration", () => {
    expect(
      codes(decide({ run: request({ sourceBytes: 10 * MiB + 1 }) })),
    ).toContain("source_too_large");
    expect(
      codes(decide({ run: request({ timeoutSeconds: 10 * 60 + 1 }) })),
    ).toContain("timeout_too_large");

    const configuredProfile = profile();
    expect(() =>
      assertFreePreviewResultSize(configuredProfile, 20 * MiB),
    ).not.toThrow();
    expect(() =>
      assertFreePreviewResultSize(configuredProfile, 20 * MiB + 1),
    ).toThrow("Result bytes exceed");
  });

  test("requires authenticated, allowlisted identity and a current grant", () => {
    expect(
      codes(
        decide({
          runContext: context({ authenticatedUserId: undefined }),
        }),
      ),
    ).toContain("authentication_required");
    expect(
      codes(decide({ runContext: context({ allowedUserIds: [] }) })),
    ).toContain("allowlist_required");
    expect(
      codes(decide({ runContext: context({ allowedUserIds: ["user-2"] }) })),
    ).toContain("user_not_allowed");
    expect(
      codes(decide({ runContext: context({ quota: undefined }) })),
    ).toContain("quota_required");
    expect(
      codes(
        decide({
          runContext: context({
            quota: { ...context().quota, grantActive: false },
          }),
        }),
      ),
    ).toContain("quota_grant_required");
  });

  test("enforces current UTC daily and monthly quota snapshots", () => {
    expect(
      codes(
        decide({
          runContext: context({
            quota: { ...context().quota, utcDay: "2026-08-31" },
          }),
        }),
      ),
    ).toContain("quota_stale");
    expect(
      codes(
        decide({
          runContext: context({
            quota: { ...context().quota, runsToday: 2 },
          }),
        }),
      ),
    ).toContain("daily_quota_exhausted");
    expect(
      codes(
        decide({
          runContext: context({
            quota: { ...context().quota, runsThisMonth: 5 },
          }),
        }),
      ),
    ).toContain("monthly_quota_exhausted");
  });

  test("allows at most one globally active hosted run", () => {
    expect(
      codes(decide({ runContext: context({ activeRuns: undefined }) })),
    ).toContain("capacity_snapshot_required");
    expect(
      codes(decide({ runContext: context({ activeRuns: 1 }) })),
    ).toContain("concurrency_exhausted");
  });

  test("requires current R2 policy and usage snapshots", () => {
    expect(
      codes(decide({ runContext: context({ r2Usage: undefined }) })),
    ).toContain("r2_usage_required");
    expect(
      codes(
        decide({
          runContext: context({
            r2Usage: { ...context().r2Usage, policyReady: false },
          }),
        }),
      ),
    ).toContain("r2_policy_not_ready");
    expect(
      codes(
        decide({
          runContext: context({
            r2Usage: { ...context().r2Usage, utcMonth: "2026-08" },
          }),
        }),
      ),
    ).toContain("r2_usage_stale");
  });

  test("guards R2 stored bytes, byte-hours, and Class A/B operations", () => {
    const cases = [
      [
        { storedBytes: 100 * MiB },
        "r2_stored_bytes_exhausted",
      ],
      [
        { storageByteHoursThisMonth: 990 * MiB },
        "r2_storage_byte_hours_exhausted",
      ],
      [{ classAOperationsThisMonth: 998 }, "r2_class_a_exhausted"],
      [{ classBOperationsThisMonth: 1_996 }, "r2_class_b_exhausted"],
    ];

    for (const [usage, expectedCode] of cases) {
      const decision = decide({
        runContext: context({
          r2Usage: { ...context().r2Usage, ...usage },
        }),
      });
      expect(codes(decision)).toContain(expectedCode);
    }
  });

  test("returns fixed execution constraints and atomic reservation inputs", () => {
    const decision = decide();
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error("expected an allowed decision");

    expect(decision.constraints).toEqual({
      gpu: false,
      timeoutSeconds: 600,
      maxResultBytes: 20 * MiB,
      maxConcurrency: 1,
    });
    expect(decision.reservation).toEqual({
      profileId: FREE_PREVIEW_PROFILE_ID,
      userId: "user-1",
      utcDay: "2026-09-01",
      utcMonth: "2026-09",
      runs: 1,
      sourceBytes: 2 * MiB,
      resultBytes: 20 * MiB,
      storageByteHours: 528 * MiB,
      classAOperations: 3,
      classBOperations: 5,
    });
  });
});
