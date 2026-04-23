let selfPingTimer: NodeJS.Timeout | null = null;
let selfPingInFlight = false;

const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off']);

const parseBoolean = (value: string | undefined): boolean | null => {
    if (!value) return null;

    const normalized = value.trim().toLowerCase();
    if (TRUTHY_VALUES.has(normalized)) return true;
    if (FALSY_VALUES.has(normalized)) return false;
    return null;
};

const parsePositiveNumber = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

const shouldEnableSelfPing = (): boolean => {
    const configured = parseBoolean(process.env.SELF_PING_ENABLED);
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

export const initializeSelfPingScheduler = () => {
    if (selfPingTimer) return;

    if (!shouldEnableSelfPing()) {
        console.log('[SelfPing] Disabled.');
        return;
    }

    const selfPingUrl = resolveSelfPingUrl();
    if (!selfPingUrl) {
        console.warn('[SelfPing] Skipped because no URL could be resolved.');
        return;
    }

    const intervalMs = parsePositiveNumber(process.env.SELF_PING_INTERVAL_MS, DEFAULT_INTERVAL_MS);
    const timeoutMs = parsePositiveNumber(process.env.SELF_PING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

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
