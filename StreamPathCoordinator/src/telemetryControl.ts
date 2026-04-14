import type { AppConfig } from './config.js';

const APP_INSIGHTS_HOST_FRAGMENT = 'in.applicationinsights.azure.com';
const APP_INSIGHTS_TRACK_PATH = '/v2/track';

let initialized = false;

function isUiPathSdkTelemetryUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl === 'string') {
    return rawUrl.includes(APP_INSIGHTS_HOST_FRAGMENT) || rawUrl.includes(APP_INSIGHTS_TRACK_PATH);
  }

  if (rawUrl instanceof URL) {
    return rawUrl.hostname.includes(APP_INSIGHTS_HOST_FRAGMENT);
  }

  if (typeof Request !== 'undefined' && rawUrl instanceof Request) {
    return isUiPathSdkTelemetryUrl(rawUrl.url);
  }

  return false;
}

export function configureTelemetryControls(config: AppConfig): void {
  if (initialized) {
    return;
  }

  initialized = true;

  if (config.suppressUiPathSdkTelemetryLogs) {
    const originalDebug = console.debug.bind(console);
    console.debug = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string') {
        if (
          first.includes('Error sending event telemetry to Application Insights') ||
          first.includes('Failed to send event telemetry')
        ) {
          return;
        }
      }

      originalDebug(...args);
    };
  }

  if (config.disableUiPathSdkTelemetry && typeof fetch === 'function') {
    const originalFetch = fetch.bind(globalThis);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isUiPathSdkTelemetryUrl(input)) {
        return new Response(null, { status: 204, statusText: 'No Content' });
      }

      return originalFetch(input, init);
    }) as typeof fetch;
  }
}

