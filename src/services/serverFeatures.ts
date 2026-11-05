/**
 * Backend capability flags from GET /health → `features`.
 *
 * A new app build may talk to an older backend (e.g. after a backend
 * rollback), so features that need server support check here before
 * sending anything the server wouldn't understand. Until the first fetch
 * completes everything reads as unsupported — the safe, old behaviour.
 */
import { buildHealthUrl } from './api';

export type ServerFeature = 'video' | 'presence' | 'direct_upload' | 'media_urls' | 'groups';

let features = new Set<string>();
let inflight: Promise<void> | null = null;

export function serverHasFeature(name: ServerFeature): boolean {
  return features.has(name);
}

/** Fetch once (deduplicated); call again later to refresh. Never throws. */
export function loadServerFeatures(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(buildHealthUrl());
      if (!res.ok) return;
      const body = (await res.json()) as { features?: unknown };
      if (Array.isArray(body.features)) {
        features = new Set(body.features.filter((f): f is string => typeof f === 'string'));
      }
    } catch {
      /* offline / old backend — keep the previous (or empty) set */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test hook. */
export function __setServerFeaturesForTest(list: string[]): void {
  features = new Set(list);
}
