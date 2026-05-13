import configService from './configService.js';

const DEFAULT_ALLOWED_PIS_HOST_SUFFIXES = ['pttplc.com', 'pttdigital.com'];

const getAllowedPisHostSuffixes = (): string[] => {
    const configured = String(process.env.PIS_ALLOWED_HOST_SUFFIXES || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    return configured.length ? configured : DEFAULT_ALLOWED_PIS_HOST_SUFFIXES;
};

const isAllowedPisHostname = (hostname: string): boolean => {
    const normalizedHost = hostname.toLowerCase();
    return getAllowedPisHostSuffixes().some((suffix) => (
        normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`)
    ));
};

const resolveHttpsConfigUrl = (value: string, searchParams?: Record<string, string>): string => {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:') {
        throw new Error('PIS endpoint must use HTTPS');
    }
    if (parsed.username || parsed.password || parsed.hash) {
        throw new Error('PIS endpoint contains unsupported URL parts');
    }
    if (parsed.port && parsed.port !== '443') {
        throw new Error('PIS endpoint uses unsupported port');
    }
    if (!isAllowedPisHostname(parsed.hostname)) {
        throw new Error('PIS endpoint host is not allowed');
    }

    Object.entries(searchParams || {}).forEach(([key, val]) => {
        parsed.searchParams.set(key, val);
    });

    return parsed.toString();
};

const safeHeaderValue = (value: unknown, name: string): string => {
    const text = String(value || '').trim();
    if (!text || /[\r\n]/.test(text)) {
        throw new Error(`Invalid ${name}`);
    }
    return text;
};

const safePisIdentifier = (value: unknown): string => {
    return String(value || '').trim().replace(/^0+/, '').replace(/[^A-Za-z0-9_-]/g, '');
};

class PisService {
    token: string | null = null;
    tokenExpiry: number = 0;

    async getPisToken(): Promise<string> {
        // Cache token for 50 minutes (standard is 1 hour)
        if (this.token && Date.now() < this.tokenExpiry) {
            return this.token;
        }

        const [tokenUrl, username, password] = await Promise.all([
            configService.getConfig('API_TOKEN'),
            configService.getConfig('API_USER'),
            configService.getConfig('API_PASS')
        ]);

        if (!tokenUrl || !username || !password) {
            console.warn("Missing PIS API Config (API_TOKEN, API_USER, API_PASS)");
            return "";
        }

        const credentials = Buffer.from(`${safeHeaderValue(username, 'PIS username')}:${safeHeaderValue(password, 'PIS password')}`).toString('base64');

        try {
            const response = await fetch(resolveHttpsConfigUrl(tokenUrl), {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    'grant_type': 'client_credentials'
                })
            });

            if (!response.ok) {
                console.error(`Failed to fetch PIS token. Status: ${response.status}`);
                return "";
            }

            const data: any = await response.json();
            this.token = safeHeaderValue(data.access_token, 'PIS access token');
            this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000 - 60000; // Subtract 1 min for safety
            return this.token || "";
        } catch (error) {
            console.error("Error in getPisToken:", error);
            return "";
        }
    }

    async getEmployeeInfo(employeeId: string): Promise<any> {
        try {
            const token = await this.getPisToken();
            if (!token) return null;

            const baseUrl = await configService.getConfig('REQUEST_ADDRESS2');
            if (!baseUrl) return null;

            const formattedEmpID = safePisIdentifier(employeeId);
            const url = resolveHttpsConfigUrl(baseUrl, { Search_EmployeeCode: formattedEmpID });

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${safeHeaderValue(token, 'PIS access token')}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.error(`Failed to fetch PIS employee info. Status: ${response.status}`);
                return null;
            }

            const data: any = await response.json();
            // PIS usually returns Entries: { Entry: [...] } or entries: { entry: [...] }
            const entries = data.Entries?.Entry || data.entries?.entry || [];
            return entries.length > 0 ? entries[0] : null;
        } catch (error) {
            console.error("Error in getPisEmployeeInfo:", error);
            return null;
        }
    }

    async getApprovalFlow(employeeId: string, posCode: string): Promise<any[]> {
        try {
            const token = await this.getPisToken();
            if (!token) return [];

            const baseUrl = await configService.getConfig('REQUEST_ADDRESS1');
            if (!baseUrl) return [];

            const formattedEmpID = safePisIdentifier(employeeId);
            const url = resolveHttpsConfigUrl(baseUrl, { in_empid: formattedEmpID, in_poscode: safePisIdentifier(posCode) });

            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${safeHeaderValue(token, 'PIS access token')}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.error(`Failed to fetch PIS approval flow. Status: ${response.status}`);
                return [];
            }

            const data: any = await response.json();
            const entries = data.entries?.entry || data.Entries?.Entry || [];
            return Array.isArray(entries) ? entries : [entries].filter(e => e);
        } catch (error) {
            console.error("Error in getPisApprovalFlow:", error);
            return [];
        }
    }
}

export default new PisService();
