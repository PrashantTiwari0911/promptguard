export type Tier = "block" | "warn" | "allow";

/** Category numbers follow the brief (1 = API keys … 10 = trade secrets). */
export type Category = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Finding {
  category: Category;
  detector: string;
  /** Human name shown to the user, e.g. "Tax file number". */
  what: string;
  /** Why it was flagged (or allowed), in plain language. */
  why: string;
  tier: Tier;
  /** Offsets in the ORIGINAL text, end exclusive. */
  start: number;
  end: number;
  /** Replacement tag used by Redact, e.g. "TFN". Empty for record-level findings. */
  label: string;
  /** Lower runs first and wins overlaps. */
  priority: number;
}

export interface Policy {
  /** Exact values (after whitespace removal) that are always allowed, e.g. the company's own ABN. */
  allowValues: string[];
  /** Extra words that mark text as confidential (category 10), e.g. project codenames. */
  confidentialMarkers: string[];
  /** Internal hostnames or package prefixes whose presence marks proprietary code. */
  orgFingerprints: string[];
}

export const DEFAULT_POLICY: Policy = { allowValues: [], confidentialMarkers: [], orgFingerprints: [] };

export interface ScanResult {
  findings: Finding[];
  tier: Tier;
}
