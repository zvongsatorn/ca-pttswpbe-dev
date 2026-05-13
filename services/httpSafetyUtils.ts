export type SafeHttpUrl = {
    readonly url: URL;
    readonly hostname: string;
    readonly __safeHttpUrl: unique symbol;
};
export type SafeHeaderValue = string & { readonly __safeHeaderValue: unique symbol };

const DEFAULT_ALLOWED_HTTPS_PORTS = new Set(['', '443']);
const SAFE_QUERY_PARAM_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const toSafeHeaderValue = (value: unknown, name: string): SafeHeaderValue => {
    const text = String(value ?? '').trim();
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
    const parsed = new URL(String(value ?? '').trim());
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

    Object.entries(searchParams ?? {}).forEach(([key, val]) => {
        if (!SAFE_QUERY_PARAM_NAME_PATTERN.test(key)) {
            throw new Error('Unsupported query parameter name');
        }
        parsed.searchParams.set(key, val);
    });

    return {
        url: parsed,
        hostname: parsed.hostname.toLowerCase()
    } as SafeHttpUrl;
};

export const fetchSafeHttpUrl = (url: SafeHttpUrl, init?: RequestInit): Promise<Response> => {
    const parsed = url.url;
    if (
        parsed.protocol !== 'https:' ||
        !DEFAULT_ALLOWED_HTTPS_PORTS.has(parsed.port) ||
        parsed.hostname.toLowerCase() !== url.hostname
    ) {
        throw new Error('Unsafe URL');
    }
    return fetch(new Request(parsed.toString(), init));
};
