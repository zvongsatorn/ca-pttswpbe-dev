export type SafeHttpUrl = string & { readonly __safeHttpUrl: unique symbol };
export type SafeHeaderValue = string & { readonly __safeHeaderValue: unique symbol };

const DEFAULT_ALLOWED_HTTPS_PORTS = new Set(['', '443']);

export const toSafeHeaderValue = (value: unknown, name: string): SafeHeaderValue => {
    const text = String(value || '').trim();
    if (!text || /[\r\n]/.test(text)) {
        throw new Error(`Invalid ${name}`);
    }
    return text as SafeHeaderValue;
};

export const toSafeHttpsUrl = (
    value: string,
    isAllowedHostname: (hostname: string) => boolean,
    searchParams?: Record<string, string>
): SafeHttpUrl => {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:') {
        throw new Error('Endpoint must use HTTPS');
    }
    if (parsed.username || parsed.password || parsed.hash) {
        throw new Error('Endpoint contains unsupported URL parts');
    }
    if (!DEFAULT_ALLOWED_HTTPS_PORTS.has(parsed.port)) {
        throw new Error('Endpoint uses unsupported port');
    }
    if (!isAllowedHostname(parsed.hostname)) {
        throw new Error('Endpoint host is not allowed');
    }

    Object.entries(searchParams || {}).forEach(([key, val]) => {
        if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
            throw new Error('Unsupported query parameter name');
        }
        parsed.searchParams.set(key, val);
    });

    return parsed.toString() as SafeHttpUrl;
};

export const fetchSafeHttpUrl = (url: SafeHttpUrl, init?: RequestInit): Promise<Response> => {
    return fetch(url, init);
};
