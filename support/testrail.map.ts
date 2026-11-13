/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * OpenCRVS is also distributed under the terms of the Civil Registration
 * & Healthcare Disclaimer located at http://opencrvs.org/license.
 *
 * Copyright (C) The OpenCRVS Authors located at https://github.com/opencrvs/opencrvs-core/blob/master/AUTHORS.
 */

/*
 * The TestRail suites and sections. Each suite key is a folder in `tests/`.
 * Each section key is a folder in its suite folder. A test is in
 * `tests/<suite>/<section>/<name>.spec.ts`. A folder that is not in this map
 * is not permitted.
 */
export const SUITES = {
  'admin-structure-versioning': {
    suiteId: 75,
    sections: {
      'search-locations': 662,
      'jurisdiction-routing': 664,
      'form-selector-anchoring': 665,
      'client-side-resolution': 666,
      'inactive-office-overlay': 667,
      'organisation-sync': 668
    }
  },
  'assign-unassign': { suiteId: 52, sections: { 'test-cases': 456 } },
  'birth-death-forms': {
    suiteId: 49,
    sections: {
      'birth-form': 423,
      'birth-form-features': 428,
      'death-form': 432,
      'death-form-features': 433,
      'birth-test-data': 846,
      'death-test-data': 847
    }
  },
  'configuration-communications': {
    suiteId: 40,
    sections: { configuration: 371, communications: 373 }
  },
  correction: {
    suiteId: 48,
    sections: {
      'record-correction': 418,
      'correction-request': 419,
      'review-correction': 420,
      general: 422
    }
  },
  'custom-actions': {
    suiteId: 51,
    sections: {
      validate: 449,
      escalate: 450,
      'escalation-feedback': 451,
      'late-registration-approval': 452,
      revoke: 453,
      'issue-certificates': 454,
      attestation: 455,
      reinstate: 457,
      'issue-vc': 458,
      'seal-unseal': 663
    }
  },
  deduplication: {
    suiteId: 43,
    sections: { 'duplicate-detection': 386, 'duplicate-review': 387 }
  },
  'event-configuration-versioning': {
    suiteId: 113,
    sections: {
      'version-at-creation': 843,
      'older-records': 844,
      'search-duplicates': 845
    }
  },
  'event-lifecycle': {
    suiteId: 50,
    sections: {
      notify: 429,
      declare: 430,
      edit: 431,
      reject: 434,
      archive: 435,
      register: 436,
      unarchive: 448,
      'revoke-reinstate': 677,
      create: 842
    }
  },
  'farajaland-configuration-workflows': {
    suiteId: 18,
    sections: {
      registration: 131,
      issue: 132,
      deduplication: 133,
      escalate: 134,
      comment: 135,
      archive: 136,
      'record-correction': 137,
      'revoke-reinstate': 138
    }
  },
  login: {
    suiteId: 36,
    sections: {
      'valid-invalid-credentials': 352,
      'reset-credentials-pin': 353,
      misc: 354
    }
  },
  metabase: { suiteId: 41, sections: { dashboards: 375 } },
  mosip: { suiteId: 46, sections: { mosip: 395 } },
  navigation: {
    suiteId: 38,
    sections: { 'side-navigation': 357, 'top-navigation': 358 }
  },
  'new-user-onboard': { suiteId: 10, sections: { 'test-cases': 63 } },
  'office-user-role-change': {
    suiteId: 45,
    sections: {
      'office-change': 390,
      'user-role-change': 391,
      'admin-role-office-change': 392
    }
  },
  'organisation-team': {
    suiteId: 42,
    sections: { organisation: 377, team: 381 }
  },
  'print-certificate': {
    suiteId: 3,
    sections: { 'print-flow': 461, certificates: 462 }
  },
  search: { suiteId: 44, sections: { functionality: 388, jurisdiction: 389 } },
  settings: {
    suiteId: 37,
    sections: { 'settings-page': 355, 'change-information': 356 }
  },
  'user-management': {
    suiteId: 39,
    sections: {
      'national-administrator': 363,
      administrator: 364,
      'team-page': 369
    }
  },
  'workqueues-event-overview': {
    suiteId: 47,
    sections: { 'event-overview': 464, workqueues: 673 }
  }
} as const satisfies Record<
  string,
  { suiteId: number; sections: Record<string, number> }
>
