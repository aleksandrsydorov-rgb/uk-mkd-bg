/**
 * EML-3 — Three-level notification eligibility (pure, testable).
 * A) System safety gates (caller responsibility for transport)
 * B) Complex-wide admin module/event toggles
 * C) Individual recipient preferences / mode
 *
 * Security mandatory events cannot be disabled by B or C.
 * User prefs cannot grant events complex disabled or unauthorized.
 */

import {
  DEFAULT_OWNER_STAFF_NOTIFICATION_MODE,
  getEmailEvent,
  type NotificationMode,
} from '@/lib/email/eventCatalog';

export type ComplexNotificationState = {
  /** module_key → enabled (missing = default true) */
  modules: Record<string, boolean>;
  /** event_key → enabled (missing = catalog defaultEnabled) */
  events: Record<string, boolean>;
};

export type PersonalNotificationState = {
  mode: NotificationMode;
  /** CUSTOM per-event overrides (missing = inherit mode rules) */
  eventOverrides: Record<string, boolean>;
  /** Suggested role for default mode hints only */
  role?: 'admin' | 'staff' | 'owner' | null;
};

export type PolicyDecision =
  | {
      allow: true;
      channel: 'immediate' | 'digest';
      reason: string;
    }
  | {
      allow: false;
      channel: 'none';
      reason: string;
      suppressed: true;
    };

export type PolicyEvalInput = {
  eventKey: string;
  complex: ComplexNotificationState;
  personal: PersonalNotificationState | null;
  /** Transport/system gates already OK for enqueue intent (not send). */
  systemAllowsEnqueue?: boolean;
  /** Phase: queue-time vs send-time recheck */
  phase?: 'enqueue' | 'dispatch';
  /** Optional high-frequency throttle trip (recipient-level). */
  throttled?: boolean;
  /** Admin-controlled test bypasses INFORMATIONAL_OFF personal mode only when true. */
  isAdminControlledTest?: boolean;
};

export function defaultPersonalState(): PersonalNotificationState {
  return {
    mode: DEFAULT_OWNER_STAFF_NOTIFICATION_MODE,
    eventOverrides: {},
    role: null,
  };
}

function moduleEnabled(complex: ComplexNotificationState, moduleKey: string): boolean {
  if (Object.prototype.hasOwnProperty.call(complex.modules, moduleKey)) {
    return complex.modules[moduleKey] !== false;
  }
  return true;
}

function complexEventEnabled(
  complex: ComplexNotificationState,
  eventKey: string,
  defaultEnabled: boolean
): boolean {
  if (Object.prototype.hasOwnProperty.call(complex.events, eventKey)) {
    return complex.events[eventKey] !== false;
  }
  return defaultEnabled !== false;
}

/**
 * Effective eligibility for a catalog event under complex + personal policy.
 * Does NOT bypass dual sending gates — caller must still respect transport readiness.
 */
export function evaluateNotificationPolicy(input: PolicyEvalInput): PolicyDecision {
  const ev = getEmailEvent(input.eventKey);
  if (!ev) {
    return {
      allow: false,
      channel: 'none',
      reason: 'unknown_event',
      suppressed: true,
    };
  }

  if (ev.producerStatus === 'excluded') {
    return {
      allow: false,
      channel: 'none',
      reason: 'excluded',
      suppressed: true,
    };
  }

  // NEEDS_DECISION: catalog/prefs exist, but queue producers must stay off
  // until product approves. Admins may still preview & toggle.
  if (ev.producerStatus === 'needs_decision' && input.phase !== 'enqueue') {
    // At dispatch, still respect prefs if somehow queued historically.
  }

  const security = ev.importance === 'security_mandatory';

  if (!security) {
    if (!moduleEnabled(input.complex, ev.moduleKey)) {
      return {
        allow: false,
        channel: 'none',
        reason: 'complex_module_disabled',
        suppressed: true,
      };
    }
    if (!complexEventEnabled(input.complex, ev.eventKey, ev.defaultEnabled)) {
      return {
        allow: false,
        channel: 'none',
        reason: 'complex_event_disabled',
        suppressed: true,
      };
    }
  }

  const personal = input.personal ?? defaultPersonalState();
  const mode = personal.mode || DEFAULT_OWNER_STAFF_NOTIFICATION_MODE;

  if (!security) {
    if (mode === 'INFORMATIONAL_OFF' && ev.importance === 'informational') {
      if (!(input.isAdminControlledTest && ev.eventKey === 'email_test')) {
        return {
          allow: false,
          channel: 'none',
          reason: 'personal_informational_off',
          suppressed: true,
        };
      }
    }

    if (mode === 'IMPORTANT_ONLY' && ev.importance === 'informational') {
      return {
        allow: false,
        channel: 'none',
        reason: 'personal_important_only',
        suppressed: true,
      };
    }

    if (mode === 'CUSTOM') {
      const override = personal.eventOverrides[ev.eventKey];
      if (override === false) {
        return {
          allow: false,
          channel: 'none',
          reason: 'personal_custom_disabled',
          suppressed: true,
        };
      }
    }

    if (input.throttled && ev.highFrequency && ev.importance === 'informational') {
      return {
        allow: false,
        channel: 'none',
        reason: 'recipient_throttled',
        suppressed: true,
      };
    }
  }

  // Digest routing for eligible informational events
  if (
    !security &&
    mode === 'DAILY_DIGEST' &&
    (ev.delivery === 'digest_eligible' || ev.delivery === 'immediate_or_digest') &&
    ev.importance === 'informational'
  ) {
    return { allow: true, channel: 'digest', reason: 'personal_daily_digest' };
  }

  // Important / security / ALL / CUSTOM enabled → immediate
  return { allow: true, channel: 'immediate', reason: security ? 'security_mandatory' : 'allowed' };
}

/** Preview rows for UI: complex lock vs personal effect. */
export function previewEffectiveEvent(opts: {
  eventKey: string;
  complex: ComplexNotificationState;
  personal: PersonalNotificationState | null;
}): {
  eventKey: string;
  complexAllows: boolean;
  personalAllows: boolean;
  effective: 'immediate' | 'digest' | 'blocked';
  lockedSecurity: boolean;
  blockedByComplex: boolean;
  reason: string;
} {
  const ev = getEmailEvent(opts.eventKey);
  const lockedSecurity = ev?.importance === 'security_mandatory';
  const complexOk =
    lockedSecurity ||
    (ev
      ? moduleEnabled(opts.complex, ev.moduleKey) &&
        complexEventEnabled(opts.complex, ev.eventKey, ev.defaultEnabled)
      : false);
  const decision = evaluateNotificationPolicy({
    eventKey: opts.eventKey,
    complex: opts.complex,
    personal: opts.personal,
    phase: 'enqueue',
  });
  return {
    eventKey: opts.eventKey,
    complexAllows: complexOk,
    personalAllows: decision.allow,
    effective: !decision.allow
      ? 'blocked'
      : decision.channel === 'digest'
        ? 'digest'
        : 'immediate',
    lockedSecurity: Boolean(lockedSecurity),
    blockedByComplex: !complexOk && !lockedSecurity,
    reason: decision.reason,
  };
}
