export const FREE_PREVIEW_PROFILE_ID = "free-preview-cpu-v1";

export const FREE_PREVIEW_R2_RETENTION_SECONDS = 24 * 60 * 60;

export const DISABLED_HOSTED_EXECUTION_CONFIGURATION = Object.freeze({
  enabled: false,
}) satisfies FreePreviewConfiguration;

export type FreePreviewProfile = Readonly<{
  id: typeof FREE_PREVIEW_PROFILE_ID;
  gpu: false;
  maxConcurrency: 1;
  trialCutoffAt: string;
  trialSafetyWindowSeconds: number;
  gcpBillingEvidenceMaxAgeSeconds: number;
  limits: Readonly<{
    maxSourceBytes: number;
    maxResultBytes: number;
    maxJobTimeoutSeconds: number;
    maxRunsPerUserPerUtcDay: number;
    maxRunsPerUserPerUtcMonth: number;
  }>;
  r2: Readonly<{
    maxStoredBytes: number;
    maxStorageByteHoursPerUtcMonth: number;
    maxClassAOperationsPerUtcMonth: number;
    maxClassBOperationsPerUtcMonth: number;
    retentionSeconds: number;
    classAOperationsPerRun: number;
    classBOperationsPerRun: number;
  }>;
}>;

export type FreePreviewConfiguration = Readonly<{
  /** Hosted execution is unavailable unless this is explicitly true. */
  enabled?: boolean;
  /** Exactly one reviewed profile is enabled during the free preview. */
  profile?: FreePreviewProfile;
}>;

export type FreePreviewRunRequest = Readonly<{
  profileId?: string;
  gpu?: boolean;
  sourceBytes: number;
  timeoutSeconds: number;
}>;

export type FreePreviewQuotaSnapshot = Readonly<{
  userId: string;
  utcDay: string;
  utcMonth: string;
  grantActive: boolean;
  runsToday: number;
  runsThisMonth: number;
}>;

export type FreePreviewR2UsageSnapshot = Readonly<{
  utcMonth: string;
  policyReady: boolean;
  storedBytes: number;
  storageByteHoursThisMonth: number;
  classAOperationsThisMonth: number;
  classBOperationsThisMonth: number;
}>;

export type FreePreviewGcpBillingEvidence = Readonly<{
  mode: "free-trial-unupgraded";
  verifiedAt: string;
}>;

export type FreePreviewRunContext = Readonly<{
  now: Date;
  authenticatedUserId?: string;
  allowedUserIds?: readonly string[];
  quota?: FreePreviewQuotaSnapshot;
  /** Global active hosted jobs, read inside the same reservation transaction. */
  activeRuns?: number;
  r2Usage?: FreePreviewR2UsageSnapshot;
  gcpBilling?: FreePreviewGcpBillingEvidence;
}>;

export type FreePreviewDenialCode =
  | "hosted_disabled"
  | "profile_required"
  | "profile_not_allowed"
  | "profile_invalid"
  | "trial_cutoff_required"
  | "trial_safety_window"
  | "gcp_free_trial_required"
  | "gcp_billing_evidence_stale"
  | "cpu_only"
  | "source_size_invalid"
  | "source_too_large"
  | "timeout_invalid"
  | "timeout_too_large"
  | "clock_invalid"
  | "authentication_required"
  | "allowlist_required"
  | "user_not_allowed"
  | "quota_required"
  | "quota_invalid"
  | "quota_stale"
  | "quota_grant_required"
  | "daily_quota_exhausted"
  | "monthly_quota_exhausted"
  | "capacity_snapshot_required"
  | "concurrency_exhausted"
  | "r2_usage_required"
  | "r2_policy_not_ready"
  | "r2_usage_invalid"
  | "r2_usage_stale"
  | "r2_stored_bytes_exhausted"
  | "r2_storage_byte_hours_exhausted"
  | "r2_class_a_exhausted"
  | "r2_class_b_exhausted";

export type FreePreviewDenial = Readonly<{
  code: FreePreviewDenialCode;
  message: string;
}>;

export type FreePreviewReservation = Readonly<{
  profileId: string;
  userId: string;
  utcDay: string;
  utcMonth: string;
  runs: 1;
  sourceBytes: number;
  resultBytes: number;
  storageByteHours: number;
  classAOperations: number;
  classBOperations: number;
}>;

export type FreePreviewDecision =
  | Readonly<{
      allowed: false;
      reasons: readonly FreePreviewDenial[];
    }>
  | Readonly<{
      allowed: true;
      reasons: readonly [];
      constraints: Readonly<{
        gpu: false;
        timeoutSeconds: number;
        maxResultBytes: number;
        maxConcurrency: 1;
      }>;
      reservation: FreePreviewReservation;
    }>;

type EvaluationInput = Readonly<{
  configuration?: FreePreviewConfiguration;
  request: FreePreviewRunRequest;
  context: FreePreviewRunContext;
}>;

function denial(
  code: FreePreviewDenialCode,
  message: string,
): FreePreviewDenial {
  return Object.freeze({ code, message });
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hasExplicitTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}

function parsedCutoff(profile: FreePreviewProfile): number | null {
  if (
    typeof profile.trialCutoffAt !== "string" ||
    !profile.trialCutoffAt ||
    !hasExplicitTimezone(profile.trialCutoffAt)
  ) {
    return null;
  }

  const value = Date.parse(profile.trialCutoffAt);
  return Number.isFinite(value) ? value : null;
}

function profileConfigurationError(profile: FreePreviewProfile): string | null {
  if (profile.id !== FREE_PREVIEW_PROFILE_ID) {
    return `The free-preview profile id must be ${FREE_PREVIEW_PROFILE_ID}.`;
  }
  if (profile.gpu !== false) {
    return "The free-preview profile must explicitly disable GPU execution.";
  }
  if (profile.maxConcurrency !== 1) {
    return "The free-preview profile must set maxConcurrency to exactly one.";
  }
  if (parsedCutoff(profile) === null) {
    return "The free-preview profile requires a valid timezone-qualified trial cutoff.";
  }
  if (!isPositiveSafeInteger(profile.trialSafetyWindowSeconds)) {
    return "The trial safety window must be a positive integer number of seconds.";
  }
  if (!isPositiveSafeInteger(profile.gcpBillingEvidenceMaxAgeSeconds)) {
    return "The GCP billing evidence maximum age must be a positive integer number of seconds.";
  }

  const positiveLimits: readonly [unknown, string][] = [
    [profile.limits?.maxSourceBytes, "maxSourceBytes"],
    [profile.limits?.maxResultBytes, "maxResultBytes"],
    [profile.limits?.maxJobTimeoutSeconds, "maxJobTimeoutSeconds"],
    [
      profile.limits?.maxRunsPerUserPerUtcDay,
      "maxRunsPerUserPerUtcDay",
    ],
    [
      profile.limits?.maxRunsPerUserPerUtcMonth,
      "maxRunsPerUserPerUtcMonth",
    ],
    [profile.r2?.maxStoredBytes, "r2.maxStoredBytes"],
    [
      profile.r2?.maxStorageByteHoursPerUtcMonth,
      "r2.maxStorageByteHoursPerUtcMonth",
    ],
    [
      profile.r2?.maxClassAOperationsPerUtcMonth,
      "r2.maxClassAOperationsPerUtcMonth",
    ],
    [
      profile.r2?.maxClassBOperationsPerUtcMonth,
      "r2.maxClassBOperationsPerUtcMonth",
    ],
    [profile.r2?.retentionSeconds, "r2.retentionSeconds"],
    [profile.r2?.classAOperationsPerRun, "r2.classAOperationsPerRun"],
    [profile.r2?.classBOperationsPerRun, "r2.classBOperationsPerRun"],
  ];

  for (const [value, name] of positiveLimits) {
    if (!isPositiveSafeInteger(value)) {
      return `${name} must be a positive safe integer.`;
    }
  }

  if (profile.r2.retentionSeconds !== FREE_PREVIEW_R2_RETENTION_SECONDS) {
    return "The free-preview R2 retention must be exactly one day (86400 seconds).";
  }

  const reservedBytes =
    profile.limits.maxSourceBytes + profile.limits.maxResultBytes;
  if (
    !Number.isSafeInteger(reservedBytes) ||
    reservedBytes > profile.r2.maxStoredBytes
  ) {
    return "R2 maxStoredBytes must fit one maximum-size source and result reservation.";
  }

  return null;
}

/**
 * Validates and freezes a deployment-owned profile. No fallback values are
 * supplied: enabling hosted execution always requires an explicit profile.
 */
export function defineFreePreviewProfile(
  profile: FreePreviewProfile,
): FreePreviewProfile {
  const error = profileConfigurationError(profile);
  if (error) throw new TypeError(error);

  return Object.freeze({
    ...profile,
    limits: Object.freeze({ ...profile.limits }),
    r2: Object.freeze({ ...profile.r2 }),
  });
}

export function utcQuotaKeys(now: Date): Readonly<{
  utcDay: string;
  utcMonth: string;
}> {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("now must be a valid Date.");
  }
  const iso = now.toISOString();
  return Object.freeze({ utcDay: iso.slice(0, 10), utcMonth: iso.slice(0, 7) });
}

function safeProjectedSum(...values: number[]): number | null {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total : null;
}

function projectedStorageByteHours(
  sourceBytes: number,
  resultBytes: number,
  retentionSeconds: number,
): number | null {
  const reservedBytes = safeProjectedSum(sourceBytes, resultBytes);
  if (reservedBytes === null) return null;

  // Prior reservations are already included in storageByteHoursThisMonth.
  // Charging this run's full retention window to the current month cannot
  // undercount a run that crosses a month boundary.
  const byteHours = Math.ceil((reservedBytes * retentionSeconds) / 3_600);
  return Number.isSafeInteger(byteHours) ? byteHours : null;
}

/**
 * Performs a fail-closed hosted-run preflight. The caller must atomically
 * reserve the returned quota/capacity units before dispatch; this pure check
 * does not replace the database transaction that prevents concurrent races.
 */
export function evaluateFreePreviewRun({
  configuration,
  request,
  context,
}: EvaluationInput): FreePreviewDecision {
  if (configuration?.enabled !== true) {
    return Object.freeze({
      allowed: false,
      reasons: Object.freeze([
        denial(
          "hosted_disabled",
          "Hosted execution is disabled until it is explicitly enabled.",
        ),
      ]),
    });
  }

  const profile = configuration.profile;
  if (!profile || !request.profileId) {
    return Object.freeze({
      allowed: false,
      reasons: Object.freeze([
        denial(
          "profile_required",
          "Hosted execution requires an explicit reviewed profile.",
        ),
      ]),
    });
  }

  const profileError = profileConfigurationError(profile);
  if (profileError) {
    const missingCutoff = parsedCutoff(profile) === null;
    return Object.freeze({
      allowed: false,
      reasons: Object.freeze([
        denial(
          missingCutoff ? "trial_cutoff_required" : "profile_invalid",
          profileError,
        ),
      ]),
    });
  }

  const reasons: FreePreviewDenial[] = [];
  if (request.profileId !== profile.id) {
    reasons.push(
      denial(
        "profile_not_allowed",
        "The requested hosted profile is not enabled for this deployment.",
      ),
    );
  }
  if (request.gpu !== false) {
    reasons.push(
      denial("cpu_only", "The free preview permits CPU-only execution."),
    );
  }
  if (!isPositiveSafeInteger(request.sourceBytes)) {
    reasons.push(
      denial(
        "source_size_invalid",
        "Source size must be a positive safe integer number of bytes.",
      ),
    );
  } else if (request.sourceBytes > profile.limits.maxSourceBytes) {
    reasons.push(
      denial(
        "source_too_large",
        "Source bytes exceed the free-preview profile limit.",
      ),
    );
  }
  if (!isPositiveSafeInteger(request.timeoutSeconds)) {
    reasons.push(
      denial(
        "timeout_invalid",
        "Job timeout must be a positive safe integer number of seconds.",
      ),
    );
  } else if (request.timeoutSeconds > profile.limits.maxJobTimeoutSeconds) {
    reasons.push(
      denial(
        "timeout_too_large",
        "Job timeout exceeds the free-preview profile limit.",
      ),
    );
  }

  const nowMs = context.now.getTime();
  if (!Number.isFinite(nowMs)) {
    reasons.push(denial("clock_invalid", "A valid server time is required."));
  } else if (isPositiveSafeInteger(request.timeoutSeconds)) {
    const cutoffMs = parsedCutoff(profile)!;
    const safetyStartsAt =
      cutoffMs - profile.trialSafetyWindowSeconds * 1_000;
    const latestCompletionAt = nowMs + request.timeoutSeconds * 1_000;
    if (nowMs >= safetyStartsAt || latestCompletionAt >= safetyStartsAt) {
      reasons.push(
        denial(
          "trial_safety_window",
          "The job could enter or has reached the provider trial safety window.",
        ),
      );
    }
  }


  const gcpBilling = context.gcpBilling;
  if (
    !gcpBilling ||
    gcpBilling.mode !== "free-trial-unupgraded" ||
    typeof gcpBilling.verifiedAt !== "string" ||
    !hasExplicitTimezone(gcpBilling.verifiedAt) ||
    !Number.isFinite(Date.parse(gcpBilling.verifiedAt))
  ) {
    reasons.push(
      denial(
        "gcp_free_trial_required",
        "Current evidence of an unupgraded GCP free-trial billing account is required.",
      ),
    );
  } else if (Number.isFinite(nowMs)) {
    const evidenceAgeMs = nowMs - Date.parse(gcpBilling.verifiedAt);
    if (
      evidenceAgeMs < 0 ||
      evidenceAgeMs > profile.gcpBillingEvidenceMaxAgeSeconds * 1_000
    ) {
      reasons.push(
        denial(
          "gcp_billing_evidence_stale",
          "The GCP free-trial billing evidence is stale or dated in the future.",
        ),
      );
    }
  }

  const userId = context.authenticatedUserId;
  if (!userId || userId.trim() !== userId) {
    reasons.push(
      denial(
        "authentication_required",
        "An authenticated user is required for hosted execution.",
      ),
    );
  }

  const allowedUserIds = context.allowedUserIds;
  if (!allowedUserIds || allowedUserIds.length === 0) {
    reasons.push(
      denial(
        "allowlist_required",
        "A non-empty server-side allowlist is required.",
      ),
    );
  } else if (userId && !allowedUserIds.includes(userId)) {
    reasons.push(
      denial("user_not_allowed", "The authenticated user is not allowlisted."),
    );
  }

  let quotaKeys: ReturnType<typeof utcQuotaKeys> | null = null;
  if (Number.isFinite(nowMs)) quotaKeys = utcQuotaKeys(context.now);

  const quota = context.quota;
  if (!quota) {
    reasons.push(
      denial("quota_required", "A durable per-user quota snapshot is required."),
    );
  } else if (
    !userId ||
    quota.userId !== userId ||
    !isNonNegativeSafeInteger(quota.runsToday) ||
    !isNonNegativeSafeInteger(quota.runsThisMonth)
  ) {
    reasons.push(
      denial(
        "quota_invalid",
        "The quota snapshot must belong to the authenticated user and contain valid counters.",
      ),
    );
  } else {
    if (
      !quotaKeys ||
      quota.utcDay !== quotaKeys.utcDay ||
      quota.utcMonth !== quotaKeys.utcMonth
    ) {
      reasons.push(
        denial("quota_stale", "The quota snapshot is not for the current UTC period."),
      );
    }
    if (quota.grantActive !== true) {
      reasons.push(
        denial(
          "quota_grant_required",
          "An active hosted-execution quota grant is required.",
        ),
      );
    }
    if (quota.runsToday >= profile.limits.maxRunsPerUserPerUtcDay) {
      reasons.push(
        denial(
          "daily_quota_exhausted",
          "The per-user daily run quota is exhausted.",
        ),
      );
    }
    if (quota.runsThisMonth >= profile.limits.maxRunsPerUserPerUtcMonth) {
      reasons.push(
        denial(
          "monthly_quota_exhausted",
          "The per-user monthly run quota is exhausted.",
        ),
      );
    }
  }

  if (!isNonNegativeSafeInteger(context.activeRuns)) {
    reasons.push(
      denial(
        "capacity_snapshot_required",
        "A valid global active-run snapshot is required.",
      ),
    );
  } else if (context.activeRuns >= profile.maxConcurrency) {
    reasons.push(
      denial(
        "concurrency_exhausted",
        "The single free-preview execution slot is already reserved.",
      ),
    );
  }

  const r2Usage = context.r2Usage;
  let storageByteHours: number | null = null;
  if (!r2Usage) {
    reasons.push(
      denial("r2_usage_required", "A durable R2 usage snapshot is required."),
    );
  } else if (
    !isNonNegativeSafeInteger(r2Usage.storedBytes) ||
    !isNonNegativeSafeInteger(r2Usage.storageByteHoursThisMonth) ||
    !isNonNegativeSafeInteger(r2Usage.classAOperationsThisMonth) ||
    !isNonNegativeSafeInteger(r2Usage.classBOperationsThisMonth)
  ) {
    reasons.push(
      denial(
        "r2_usage_invalid",
        "R2 usage counters must be non-negative safe integers.",
      ),
    );
  } else {
    if (r2Usage.policyReady !== true) {
      reasons.push(
        denial(
          "r2_policy_not_ready",
          "The temporary bucket lifecycle and CORS policy are not verified.",
        ),
      );
    }
    if (!quotaKeys || r2Usage.utcMonth !== quotaKeys.utcMonth) {
      reasons.push(
        denial(
          "r2_usage_stale",
          "The R2 usage snapshot is not for the current UTC month.",
        ),
      );
    }

    const projectedStoredBytes = isPositiveSafeInteger(request.sourceBytes)
      ? safeProjectedSum(
          r2Usage.storedBytes,
          request.sourceBytes,
          profile.limits.maxResultBytes,
        )
      : null;
    if (
      projectedStoredBytes === null ||
      projectedStoredBytes > profile.r2.maxStoredBytes
    ) {
      reasons.push(
        denial(
          "r2_stored_bytes_exhausted",
          "The source and reserved result would exceed the R2 stored-byte guard.",
        ),
      );
    }

    if (isPositiveSafeInteger(request.sourceBytes)) {
      storageByteHours = projectedStorageByteHours(
        request.sourceBytes,
        profile.limits.maxResultBytes,
        profile.r2.retentionSeconds,
      );
    }
    const projectedMonthlyByteHours =
      storageByteHours === null
        ? null
        : safeProjectedSum(
            r2Usage.storageByteHoursThisMonth,
            storageByteHours,
          );
    if (
      projectedMonthlyByteHours === null ||
      projectedMonthlyByteHours > profile.r2.maxStorageByteHoursPerUtcMonth
    ) {
      reasons.push(
        denial(
          "r2_storage_byte_hours_exhausted",
          "The retention reservation would exceed the R2 monthly storage guard.",
        ),
      );
    }

    const projectedClassA = safeProjectedSum(
      r2Usage.classAOperationsThisMonth,
      profile.r2.classAOperationsPerRun,
    );
    if (
      projectedClassA === null ||
      projectedClassA > profile.r2.maxClassAOperationsPerUtcMonth
    ) {
      reasons.push(
        denial(
          "r2_class_a_exhausted",
          "The run would exceed the R2 monthly Class A operation guard.",
        ),
      );
    }

    const projectedClassB = safeProjectedSum(
      r2Usage.classBOperationsThisMonth,
      profile.r2.classBOperationsPerRun,
    );
    if (
      projectedClassB === null ||
      projectedClassB > profile.r2.maxClassBOperationsPerUtcMonth
    ) {
      reasons.push(
        denial(
          "r2_class_b_exhausted",
          "The run would exceed the R2 monthly Class B operation guard.",
        ),
      );
    }
  }

  if (reasons.length > 0 || !userId || !quotaKeys || storageByteHours === null) {
    return Object.freeze({
      allowed: false,
      reasons: Object.freeze(reasons),
    });
  }

  return Object.freeze({
    allowed: true,
    reasons: Object.freeze([] as []),
    constraints: Object.freeze({
      gpu: false,
      timeoutSeconds: request.timeoutSeconds,
      maxResultBytes: profile.limits.maxResultBytes,
      maxConcurrency: 1,
    }),
    reservation: Object.freeze({
      profileId: profile.id,
      userId,
      utcDay: quotaKeys.utcDay,
      utcMonth: quotaKeys.utcMonth,
      runs: 1,
      sourceBytes: request.sourceBytes,
      resultBytes: profile.limits.maxResultBytes,
      storageByteHours,
      classAOperations: profile.r2.classAOperationsPerRun,
      classBOperations: profile.r2.classBOperationsPerRun,
    }),
  });
}

/** Enforces the same immutable result cap when the worker output is ingested. */
export function assertFreePreviewResultSize(
  profile: FreePreviewProfile,
  resultBytes: number,
): void {
  const error = profileConfigurationError(profile);
  if (error) throw new TypeError(error);
  if (!isNonNegativeSafeInteger(resultBytes)) {
    throw new TypeError(
      "Result size must be a non-negative safe integer number of bytes.",
    );
  }
  if (resultBytes > profile.limits.maxResultBytes) {
    throw new RangeError("Result bytes exceed the free-preview profile limit.");
  }
}
