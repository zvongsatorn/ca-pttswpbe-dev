import { sql, poolPromise } from '../config/db.js';
import https from 'https';

class ConfigService {
    configCache: Record<string, string> = {};
    private tokenCache: string = "";
    private tokenExpiry: number = 0; // Timestamp in ms

    async loadConfig() {
          }

    async getConfig(key: string): Promise<string> {
        const details = await this.getConfigDetails(key);
        return details.Value1;
    }

    async getConfigDetails(key: string): Promise<{ Value1: string; Value2: string }> {
        if (this.configCache[key]) {
            // Check if we already have Value2 cached (using a simple delimiter or separate cache)
            const cachedValue = this.configCache[key];
            if (cachedValue.includes('|')) {
                const parts = cachedValue.split('|');
                return { Value1: parts[0], Value2: parts[1] };
            }
            return { Value1: cachedValue, Value2: "" };
        }

        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('KeyName', sql.NVarChar, key)
                .execute('MP_ConfigGetByKeyName');

            const row = result.recordset[0];
            const val1 = row?.Value1 || "";
            const val2 = row?.Value2 || "";
            
            this.configCache[key] = `${val1}|${val2}`;
            return { Value1: val1, Value2: val2 };
        } catch (err) {
            console.error(`Error fetching config details ${key}:`, err);
        }
        return { Value1: "", Value2: "" };
    }

    async getConfigs(keys: string[]): Promise<Record<string, string>> {
        const results: Record<string, string> = {};
        const missingKeys = keys.filter(k => !this.configCache[k]);
        
        if (missingKeys.length === 0) {
            keys.forEach(k => results[k] = this.configCache[k]);
            return results;
        }

        console.log(`[configService] ${missingKeys.length} configs missing from cache, fetching from DB...`);

        try {
            const pool = await poolPromise;
            const request = pool.request();
            // Pass comma-separated keys to SP (no string interpolation risk)
            request.input('KeyNames', sql.NVarChar(sql.MAX), missingKeys.join(','));
            const result = await request.execute('mp_ConfigMultiGet');
            
            result.recordset.forEach((row: any) => {
                this.configCache[row.KeyName] = row.Value1;
            });
            
            keys.forEach(k => results[k] = this.configCache[k] || "");
            return results;
        } catch (err) {
            console.error(`Error fetching configs:`, err);
        }
        return results;
    }

    /**
     * HTTP request helper using native Node.js https module.
     * Replaces the previous curl-based approach to avoid external binary dependencies.
     */
    public async curlRequest(url: string, method: string, headers: Record<string, string>, payload?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            console.log(`[configService] Fetching (NATIVE): ${method} ${url}`);

            const bodyStr = payload ? JSON.stringify(payload) : undefined;

            const requestHeaders: Record<string, string> = { ...headers };
            if (bodyStr && !requestHeaders['Content-Type']) {
                requestHeaders['Content-Type'] = 'application/json';
            }
            if (bodyStr) {
                requestHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
            }

            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const httpModule = isHttps ? https : require('node:http');

            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method,
                headers: requestHeaders,
                rejectUnauthorized: false, // equivalent to curl -k
                timeout: 120000, // --max-time 120
            };

            const req = httpModule.request(options, (res: any) => {
                let data = '';
                res.on('data', (chunk: string) => { data += chunk; });
                res.on('end', () => {
                    console.log(`[configService] Native Response status: ${res.statusCode}`);

                    if (res.statusCode && res.statusCode >= 400) {
                        console.error(`[configService] Request failed with status ${res.statusCode}: ${data}`);
                        reject(new Error(`HTTP ${res.statusCode}: ${data || 'Request failed'}`));
                        return;
                    }

                    if (!data) {
                        console.warn("[configService] Response returned empty body");
                        resolve({});
                        return;
                    }

                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        console.warn("[configService] Failed to parse response as JSON, returning raw string");
                        resolve(data);
                    }
                });
            });

            req.on('error', (err: any) => {
                console.error('[configService] Native API request failed:', err.message);
                reject(err);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Native request timed out after 120 seconds'));
            });

            if (bodyStr) {
                req.write(bodyStr);
            }
            req.end();
        });
    }

    async getToken(): Promise<string> {
        try {
            // 1. Check Cache
            const now = Date.now();
            if (this.tokenCache && this.tokenExpiry > now + 30000) { // 30s buffer
                console.log("[configService] Using cached CA&A token.");
                return this.tokenCache;
            }

            // 2. Fetch All CAA Configs in one go
            const configs = await this.getConfigs(['CAA_URL', 'CAA_USER', 'CAA_PASS']);
            const baseUrl = configs['CAA_URL'];
            const username = configs['CAA_USER'];
            const password = configs['CAA_PASS'];

            if (!baseUrl || !username || !password) {
                console.warn("Missing CAA API Config (CAA_URL, CAA_USER, CAA_PASS)");
                return "";
            }

            const tokenUrl = baseUrl.endsWith('/') ? `${baseUrl}auth/getJWT` : `${baseUrl}/auth/getJWT`;
            const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
            
            console.log(`[configService] Fetching token from: ${tokenUrl} with user: ${username}`);

            const data: any = await this.curlRequest(tokenUrl, 'POST', { 'Authorization': authHeader });
            
            console.log(`[configService] Token response keys:`, Object.keys(data || {}));
            console.log(`[configService] RespCode: ${data?.RespCode}, RespMessage: ${data?.RespMessage}`);

            if (data && data.Data) {
                try {
                    console.log(`[configService] Data snippet: ${data.Data.substring(0, 20)}...`);
                    const decodedString = Buffer.from(data.Data, 'base64').toString('utf-8');
                    console.log(`[configService] Decoded Data length: ${decodedString.length}`);
                    console.log(`[configService] Decoded snippet: ${decodedString.substring(0, 50)}...`);
                    
                    let tokenObject;
                    try {
                        tokenObject = JSON.parse(decodedString);
                        if (typeof tokenObject === 'string') tokenObject = JSON.parse(tokenObject);
                    } catch (e: any) {
                        console.error("[configService] Initial JSON parse failed:", e.message);
                        throw e;
                    }
                    
                    if (tokenObject.access_token) {
                        this.tokenCache = tokenObject.access_token;
                        // MSAL tokens usually last 1h, let's play safe with 50m
                        this.tokenExpiry = now + (50 * 60 * 1000); 
                        return this.tokenCache;
                    }
                } catch (e) {
                    console.error("Error decoding CAA token data:", e);
                    return "";
                }
            }
            return "";
        } catch (error) {
            console.error("Error in getToken:", error);
            return "";
        }
    }

    async getUserAD(rawEmployeeId: string): Promise<any> {
        let employeeId = rawEmployeeId;
        if (employeeId && employeeId.length > 20) {
            if (employeeId.includes('-CL')) {
                employeeId = employeeId.split('-CL')[0];
            } else {
                employeeId = employeeId.substring(0, 20);
            }
        }

        try {
            const formattedEmpID = employeeId.replace(/^0+/, '');
            const token = await this.getToken();
            if (!token) {
                console.error("getUserAD: Failed to retrieve token");
                return null;
            }

            const baseUrl = await this.getConfig('CAA_URL');
            const clientId = await this.getConfig('CAA_CLIENT_ID');
            const tenantId = await this.getConfig('CAA_TENANT_ID'); 

            if (!baseUrl || !clientId) {
                console.warn("CAA_URL or CAA_CLIENT_ID is missing in config");
                return null;
            }

            const listUserUrl = baseUrl.endsWith('/') ? `${baseUrl}user/listuser` : `${baseUrl}/user/listuser`;
            const filterStr = `?$filter=startswith(userPrincipalName, '${formattedEmpID}') or startsWith(mail, '${formattedEmpID}')`;

            const data: any = await this.curlRequest(listUserUrl, 'POST', {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }, {
                tenant_id: tenantId,
                client_id: clientId,
                filter: Buffer.from(filterStr).toString('base64')
            });

            if (data && data.Data) {
                try {
                    const decodedString = Buffer.from(data.Data, 'base64').toString('utf-8');
                    const parsed = JSON.parse(decodedString);
                    
                    if (parsed.value && Array.isArray(parsed.value) && parsed.value.length > 0) {
                        const user = parsed.value[0];
                        return {
                            FULLNAMETH: user.displayName || user.givenName,
                            FULLNAMEENG: user.displayName || user.givenName,
                            CODE: formattedEmpID,
                            EMAIL: user.mail || user.userPrincipalName || '',
                            ...user
                        };
                    } else {
                        console.warn(`User ${formattedEmpID} not found in CA&A.`);
                        return null;
                    }
                } catch (e) {
                    console.error("Error decoding CA&A user data:", e);
                    return null;
                }
            }
            return null;
        } catch (error) {
            console.error("Error in getUserAD:", error);
            return null;
        }
    }
}

export default new ConfigService();
