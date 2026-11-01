import {
  RayfinClient,
  resolveRayfinConfig,
  type RayfinRuntimeConfig,
} from '@microsoft/rayfin-client';

import type { GrantsAppSchema } from '../../rayfin/data/schema';
import type { AppFunctionsSchema } from '../../rayfin/functions/src/types';
import browserProcess from 'process';
import { enableLosslessText } from '../../rayfin/functions/src/grantFields';

if (typeof globalThis.process === 'undefined') globalThis.process = browserProcess;
enableLosslessText(globalThis.process.env);

export interface RayfinClientConfig {
  baseUrl: string;
  publishableKey: string;
  /** True when the API URL points at localhost. Exposed via {@link isLocalBackend}. */
  localDev: boolean;
  /** Absolute same-origin URL for local Functions calls when the Vite adapter is active. */
  functionsBaseUrl?: string;
  /** Fabric coordinates fallback for local dev, where no runtime config is emitted. */
  runtimeConfig?: RayfinRuntimeConfig;
}

let client: RayfinClient<GrantsAppSchema, AppFunctionsSchema> | null = null;
let localDev = false;

export async function initRayfinClient(
  config: RayfinClientConfig
): Promise<RayfinClient<GrantsAppSchema, AppFunctionsSchema>> {
  if (client) {
    throw new Error('Rayfin client is already initialized.');
  }
  const resolved = await resolveRayfinConfig({
    apiUrl: config.baseUrl,
    publishableKey: config.publishableKey,
    ...config.runtimeConfig,
  });
  client = new RayfinClient<GrantsAppSchema, AppFunctionsSchema>({
    // resolved.baseUrl/publishableKey are always set: config.baseUrl/publishableKey
    // are non-optional defaults, so the resolve step can only overlay on top of them.
    baseUrl: resolved.baseUrl!,
    publishableKey: resolved.publishableKey!,
    authStorage: true,
    functionsBaseUrl: config.functionsBaseUrl,
    runtimeConfig: resolved.runtimeConfig,
  });
  localDev = config.localDev;
  return client;
}

export function getRayfinClient(): RayfinClient<GrantsAppSchema, AppFunctionsSchema> {
  if (!client) {
    throw new Error(
      'Rayfin client not initialized. Call bootstrapAuth() first.'
    );
  }
  return client;
}

/** True when the app was bootstrapped against a localhost backend. */
export function isLocalBackend(): boolean {
  return localDev;
}
