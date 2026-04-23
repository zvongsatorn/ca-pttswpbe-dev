import configService from './configService.js';

let selfPingTimer: NodeJS.Timeout | null = null;
let selfPingInFlight = false;

const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const SELF_PING_CONFIG_KEYS = [
    'SELF_PING_ENABLED',
    'SELF_PING_INTERVAL_MS',
    'SELF_PING_TIMEOUT_MS'
] as const;

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off']);

const parseBoolean = (value: string | null | undefined): boolean | null => {
    if (!value) return null;

    const normalized = value.trim().toLowerCase();
    if (TRUTHY_VALUES.has(normalized)) return true;
    if (FALSY_VALUES.has(normalized)) return false;
    return null;
};

const parsePositiveNumber = (value: string | null | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readDbOrEnvConfig = async (): Promise<Record<(typeof SELF_PING_CONFIG_KEYS)[number], string>> => {
    try {
        const dbConfigs = await configService.getConfigs([...SELF_PING_CONFIG_KEYS]);
        return {
            SELF_PING_ENABLED: dbConfigs.SELF_PING_ENABLED || process.env.SELF_PING_ENABLED || '',
            SELF_PING_INTERVAL_MS: dbConfigs.SELF_PING_INTERVAL_MS || process.env.SELF_PING_INTERVAL_MS || '',
            SELF_PING_TIMEOUT_MS: dbConfigs.SELF_PING_TIMEOUT_MS || process.env.SELF_PING_TIMEOUT_MS || ''
        };
    } catch (error) {
        console.error('[SelfPing] Failed to load MP_Config values, falling back to .env:', error);
        return {
            SELF_PING_ENABLED: process.env.SELF_PING_ENABLED || '',
            SELF_PING_INTERVAL_MS: process.env.SELF_PING_INTERVAL_MS || '',
            SELF_PING_TIMEOUT_MS: process.env.SELF_PING_TIMEOUT_MS || ''
        };
    }
};

const resolveSelfPingUrl = (): string | null => {
    const configuredUrl = process.env.SELF_PING_URL?.trim();
    if (configuredUrl) return configuredUrl;

    const azureHostname = process.env.WEBSITE_HOSTNAME?.trim();
    if (azureHostname) {
        return `https://${azureHostname}/api/system/healthz?source=self-ping`;
    }

    const port = Number(process.env.PORT || 5000);
    return `http://127.0.0.1:${port}/api/system/healthz?source=self-ping`;
};

const shouldEnableSelfPing = (configuredValue?: string | null): boolean => {
    const configured = parseBoolean(configuredValue);
    if (configured !== null) return configured;

    return Boolean(process.env.WEBSITE_HOSTNAME);
};

const runSelfPingTick = async (selfPingUrl: string, timeoutMs: number) => {
    if (selfPingInFlight) return;
    selfPingInFlight = true;

    try {
        const response = await fetch(selfPingUrl, {
            method: 'GET',
            headers: {
                'user-agent': 'pttswp-self-ping/1.0',
                'x-self-ping': '1'
            },
            signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok) {
            console.warn(`[SelfPing] Request returned status ${response.status} for ${selfPingUrl}`);
        }
    } catch (error) {
        console.error('[SelfPing] Request failed:', error);
    } finally {
        selfPingInFlight = false;
    }
};

export const initializeSelfPingScheduler = async () => {
    if (selfPingTimer) return;

    const config = await readDbOrEnvConfig();

    if (!shouldEnableSelfPing(config.SELF_PING_ENABLED)) {
        console.log('[SelfPing] Disabled.');
        return;
    }

    const selfPingUrl = resolveSelfPingUrl();
    if (!selfPingUrl) {
        console.warn('[SelfPing] Skipped because no URL could be resolved.');
        return;
    }

    const intervalMs = parsePositiveNumber(config.SELF_PING_INTERVAL_MS, DEFAULT_INTERVAL_MS);
    const timeoutMs = parsePositiveNumber(config.SELF_PING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

    console.log(`[SelfPing] Enabled. Target=${selfPingUrl} interval=${intervalMs}ms timeout=${timeoutMs}ms`);

    runSelfPingTick(selfPingUrl, timeoutMs).catch((error) => {
        console.error('[SelfPing] Initial run failed:', error);
    });

    selfPingTimer = setInterval(() => {
        runSelfPingTick(selfPingUrl, timeoutMs).catch((error) => {
            console.error('[SelfPing] Scheduled run failed:', error);
        });
    }, intervalMs);
};

export default {
    initializeSelfPingScheduler
};
