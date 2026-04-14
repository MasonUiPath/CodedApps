import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  WS_PATH: z.string().min(1).default('/ws'),
  JSON_BODY_LIMIT: z.string().min(1).default('1mb'),
  UIPATH_BASE_URL: z.string().url().default('https://cloud.uipath.com'),
  UIPATH_ORG_NAME: z.string().min(1),
  UIPATH_TENANT_NAME: z.string().min(1),
  UIPATH_AUTH_MODE: z.enum(['pat', 'external_app']).optional(),
  UIPATH_PAT: z.string().min(1).optional(),
  UIPATH_SECRET: z.string().min(1).optional(),
  UIPATH_CLIENT_ID: z.string().min(1).optional(),
  UIPATH_CLIENT_SECRET: z.string().min(1).optional(),
  UIPATH_SCOPE: z.string().min(1).optional(),
  UIPATH_TOKEN_URL: z.string().url().optional(),
  DISABLE_UIPATH_SDK_TELEMETRY: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .default('true'),
  SUPPRESS_UIPATH_SDK_TELEMETRY_LOGS: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .default('true'),
});

export type UiPathAuthMode = 'pat' | 'external_app';

export type AppConfig = {
  port: number;
  wsPath: string;
  jsonBodyLimit: string;
  uipathBaseUrl: string;
  uipathOrgName: string;
  uipathTenantName: string;
  uipathAuthMode: UiPathAuthMode;
  uipathPat?: string;
  uipathClientId?: string;
  uipathClientSecret?: string;
  uipathScope?: string;
  uipathTokenUrl: string;
  disableUiPathSdkTelemetry: boolean;
  suppressUiPathSdkTelemetryLogs: boolean;
};

export function loadConfig(): AppConfig {
  const parsed = configSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid configuration: ${details}`);
  }

  const uipathPat = parsed.data.UIPATH_PAT ?? parsed.data.UIPATH_SECRET;
  const hasPatAuth = Boolean(uipathPat);
  const hasExternalAppAuth = Boolean(parsed.data.UIPATH_CLIENT_ID && parsed.data.UIPATH_CLIENT_SECRET);
  const requestedAuthMode = parsed.data.UIPATH_AUTH_MODE;
  const resolvedAuthMode: UiPathAuthMode =
    requestedAuthMode ?? (hasExternalAppAuth ? 'external_app' : 'pat');

  if (resolvedAuthMode === 'pat' && !hasPatAuth) {
    throw new Error('Invalid configuration: UIPATH_PAT or UIPATH_SECRET is required for pat auth');
  }

  if (resolvedAuthMode === 'external_app' && !hasExternalAppAuth) {
    throw new Error(
      'Invalid configuration: UIPATH_CLIENT_ID and UIPATH_CLIENT_SECRET are required for external_app auth',
    );
  }

  const uipathTokenUrl =
    parsed.data.UIPATH_TOKEN_URL ??
    `${parsed.data.UIPATH_BASE_URL.replace(/\/+$/, '')}/identity_/connect/token`;

  return {
    port: parsed.data.PORT,
    wsPath: parsed.data.WS_PATH,
    jsonBodyLimit: parsed.data.JSON_BODY_LIMIT,
    uipathBaseUrl: parsed.data.UIPATH_BASE_URL,
    uipathOrgName: parsed.data.UIPATH_ORG_NAME,
    uipathTenantName: parsed.data.UIPATH_TENANT_NAME,
    uipathAuthMode: resolvedAuthMode,
    uipathPat,
    uipathClientId: parsed.data.UIPATH_CLIENT_ID,
    uipathClientSecret: parsed.data.UIPATH_CLIENT_SECRET,
    uipathScope: parsed.data.UIPATH_SCOPE,
    uipathTokenUrl,
    disableUiPathSdkTelemetry: parsed.data.DISABLE_UIPATH_SDK_TELEMETRY === 'true',
    suppressUiPathSdkTelemetryLogs: parsed.data.SUPPRESS_UIPATH_SDK_TELEMETRY_LOGS === 'true',
  };
}
