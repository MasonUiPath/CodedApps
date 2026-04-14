import type { AppConfig } from './config.js';

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export type UiPathAuthProvider = {
  getSecret(): Promise<string>;
};

export function createUiPathAuthProvider(config: AppConfig): UiPathAuthProvider {
  if (config.uipathAuthMode === 'pat') {
    return {
      async getSecret(): Promise<string> {
        return config.uipathPat!;
      },
    };
  }

  return new ExternalAppAuthProvider(config);
}

class ExternalAppAuthProvider implements UiPathAuthProvider {
  private accessToken: string | null = null;
  private expiresAtMs = 0;
  private inFlightRefresh: Promise<string> | null = null;

  public constructor(private readonly config: AppConfig) {}

  public async getSecret(): Promise<string> {
    const now = Date.now();
    const refreshBufferMs = 60_000;

    if (this.accessToken && now < this.expiresAtMs - refreshBufferMs) {
      return this.accessToken;
    }

    if (!this.inFlightRefresh) {
      this.inFlightRefresh = this.refreshAccessToken();
    }

    try {
      return await this.inFlightRefresh;
    } finally {
      this.inFlightRefresh = null;
    }
  }

  private async refreshAccessToken(): Promise<string> {
    const payload = new URLSearchParams();
    payload.set('grant_type', 'client_credentials');
    payload.set('client_id', this.config.uipathClientId!);
    payload.set('client_secret', this.config.uipathClientSecret!);

    if (this.config.uipathScope) {
      payload.set('scope', this.config.uipathScope);
    }

    const response = await fetch(this.config.uipathTokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload,
    });

    const text = await response.text();
    let data: TokenResponse = {};

    if (text) {
      try {
        data = JSON.parse(text) as TokenResponse;
      } catch {
        throw new Error(`UiPath token request failed (${response.status}): non-JSON response body`);
      }
    }

    if (!response.ok || !data.access_token) {
      const details =
        data.error_description ??
        data.error ??
        `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

      throw new Error(
        `UiPath token request failed (${response.status}) at ${this.config.uipathTokenUrl}: ${details}`,
      );
    }

    const expiresInSeconds =
      typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
        ? data.expires_in
        : 3600;

    this.accessToken = data.access_token;
    this.expiresAtMs = Date.now() + expiresInSeconds * 1000;
    return this.accessToken;
  }
}
