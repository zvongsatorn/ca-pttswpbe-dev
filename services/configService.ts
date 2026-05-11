import { sql, poolPromise } from '../config/db.js';
import https from 'https';

class ConfigService {
    configCache: Record<string, string> = {};
    private tokenCache: string = "";
    private tokenExpiry: number = 0; // Timestamp in ms

    async loadConfig() {
        await this.getConfigs(['StartYear']);
    }

    async getConfig(key: string): Promise<string> {
        const details = await this.getConfigDetails(key);
        return details.Value1;
    }

    async getConfigDetails(key: string, forceRefresh: boolean = false): Promise<{ Value1: string; Value2: string }> {
        if (!forceRefresh && this.configCache[key]) {
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
            keys.forEach(k => {
                const cachedVal = this.configCache[k];
                results[k] = cachedVal.includes('|') ? cachedVal.split('|')[0] : cachedVal;
            });
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
                const val1 = row.Value1 || "";
                const val2 = row.Value2 || "";
                this.configCache[row.KeyName] = `${val1}|${val2}`;
            });
            
            keys.forEach(k => {
                const cachedVal = this.configCache[k] || "";
                results[k] = cachedVal.includes('|') ? cachedVal.split('|')[0] : cachedVal;
            });
            return results;
        } catch (err) {
            console.error(`Error fetching configs:`, err);
        }
        return results;
    }

    private buildRequestHeaders(headers: Record<string, string>, bodyStr?: string): Record<string, string> {
        const requestHeaders: Record<string, string> = { ...headers };
        if (bodyStr && !requestHeaders["Content-Type"]) {
            requestHeaders["Content-Type"] = "application/json";
        }
        if (bodyStr) {
            requestHeaders["Content-Length"] = Buffer.byteLength(bodyStr).toString();
        }
        return requestHeaders;
    }

    private parseNativeResponse(data: string): any {
        if (!data) {
            console.warn("[configService] Response returned empty body");
            return {};
        }

        try {
            return JSON.parse(data);
        } catch {
            console.warn("[configService] Failed to parse response as JSON, returning raw string");
            return data;
        }
    }

    private resolveNativeResponse(data: string, statusCode: number | undefined, resolve: (value: any) => void, reject: (reason?: any) => void) {
        console.log("[configService] Native Response status: " + statusCode);

        if (statusCode && statusCode >= 400) {
            console.error("[configService] Request failed with status " + statusCode + ": " + data);
            reject(new Error("HTTP " + statusCode + ": " + (data || "Request failed")));
            return;
        }

        resolve(this.parseNativeResponse(data));
    }

    private handleNativeResponse(res: any, resolve: (value: any) => void, reject: (reason?: any) => void) {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => this.resolveNativeResponse(data, res.statusCode, resolve, reject));
    }

    private assertSafeOutboundUrl(url: string): URL {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname.toLowerCase();

        if (parsedUrl.protocol !== "https:") {
            throw new Error("Outbound CAA URL must use HTTPS");
        }

        if (parsedUrl.username || parsedUrl.password) {
            throw new Error("Outbound CAA URL must not include credentials");
        }

        if (
            hostname === "localhost" ||
            hostname === "::1" ||
            hostname.startsWith("127.") ||
            hostname.startsWith("10.") ||
            hostname.startsWith("192.168.") ||
            hostname.startsWith("169.254.") ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
        ) {
            throw new Error("Outbound CAA URL host is not allowed");
        }

        return parsedUrl;
    }

    private buildCaaUrl(baseUrl: string, path: string): string {
        const parsedBaseUrl = this.assertSafeOutboundUrl(baseUrl);
        const normalizedBaseUrl = parsedBaseUrl.toString().replace(/\/?$/, "/");
        return new URL(path.replace(/^\/+/, ""), normalizedBaseUrl).toString();
    }

    private hasValidToken(now: number): boolean {
        return Boolean(this.tokenCache && this.tokenExpiry > now + 30000);
    }

    private decodeTokenObject(encodedData: string): any {
        console.log("[configService] Data snippet: " + encodedData.substring(0, 20) + "...");
        const decodedString = Buffer.from(encodedData, "base64").toString("utf-8");
        console.log("[configService] Decoded Data length: " + decodedString.length);
        console.log("[configService] Decoded snippet: " + decodedString.substring(0, 50) + "...");

        let tokenObject = JSON.parse(decodedString);
        if (typeof tokenObject === "string") tokenObject = JSON.parse(tokenObject);
        return tokenObject;
    }

    private extractAccessToken(data: any): string {
        if (!data || !data.Data) return "";

        try {
            const tokenObject = this.decodeTokenObject(data.Data);
            return tokenObject.access_token || "";
        } catch (e: any) {
            console.error("[configService] Initial JSON parse failed:", e.message);
            console.error("Error decoding CAA token data:", e);
            return "";
        }
    }

    private cacheAccessToken(accessToken: string, now: number): string {
        this.tokenCache = accessToken;
        this.tokenExpiry = now + (50 * 60 * 1000);
        return this.tokenCache;
    }

    /**
     * HTTP request helper using native Node.js https module.
     * Replaces the previous curl-based approach to avoid external binary dependencies.
     */
    public async curlRequest(url: string, method: string, headers: Record<string, string>, payload?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            console.log("[configService] Fetching (NATIVE): " + method + " " + url);

            const bodyStr = payload ? JSON.stringify(payload) : undefined;
            const parsedUrl = this.assertSafeOutboundUrl(url);
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 443,
                path: parsedUrl.pathname + parsedUrl.search,
                method,
                headers: this.buildRequestHeaders(headers, bodyStr),
                rejectUnauthorized: true,
                timeout: 120000,
            };

            const req = https.request(options, (res: any) => this.handleNativeResponse(res, resolve, reject));

            req.on("error", (err: any) => {
                console.error("[configService] Native API request failed:", err.message);
                reject(err);
            });

            req.on("timeout", () => {
                req.destroy();
                reject(new Error("Native request timed out after 120 seconds"));
            });

            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    }

    async getToken(): Promise<string> {
        try {
            const now = Date.now();
            if (this.hasValidToken(now)) {
                console.log("[configService] Using cached CA&A token.");
                return this.tokenCache;
            }

            const configs = await this.getConfigs(["CAA_URL", "CAA_USER", "CAA_PASS"]);
            const baseUrl = configs["CAA_URL"];
            const username = configs["CAA_USER"];
            const password = configs["CAA_PASS"];

            if (!baseUrl || !username || !password) {
                console.warn("Missing CAA API Config (CAA_URL, CAA_USER, CAA_PASS)");
                return "";
            }

            const tokenUrl = this.buildCaaUrl(baseUrl, "auth/getJWT");
            const authHeader = "Basic " + Buffer.from(username + ":" + password).toString("base64");
            console.log("[configService] Fetching token from: " + tokenUrl + " with user: " + username);

            const data: any = await this.curlRequest(tokenUrl, "POST", { "Authorization": authHeader });
            console.log("[configService] Token response keys:", Object.keys(data || {}));
            console.log("[configService] RespCode: " + data?.RespCode + ", RespMessage: " + data?.RespMessage);

            const accessToken = this.extractAccessToken(data);
            return accessToken ? this.cacheAccessToken(accessToken, now) : "";
        } catch (error) {
            console.error("Error in getToken:", error);
            return "";
        }
    }

    private normalizeCaaEmployeeId(rawEmployeeId: string): string {
        if (!rawEmployeeId || rawEmployeeId.length <= 20) return rawEmployeeId;
        return rawEmployeeId.includes("-CL") ? rawEmployeeId.split("-CL")[0] : rawEmployeeId.substring(0, 20);
    }

    private buildCaaUserFilter(formattedEmpID: string): string {
        const quote = String.fromCharCode(39);
        const filterStr = "?$filter=startswith(userPrincipalName, " + quote + formattedEmpID + quote + ") or startsWith(mail, " + quote + formattedEmpID + quote + ")";
        return Buffer.from(filterStr).toString("base64");
    }

    private decodeCaaUserData(data: any, formattedEmpID: string): any {
        if (!data || !data.Data) return null;

        try {
            const decodedString = Buffer.from(data.Data, "base64").toString("utf-8");
            const parsed = JSON.parse(decodedString);

            if (!parsed.value || !Array.isArray(parsed.value) || parsed.value.length === 0) {
                console.warn("User " + formattedEmpID + " not found in CA&A.");
                return null;
            }

            const user = parsed.value[0];
            return {
                FULLNAMETH: user.displayName || user.givenName,
                FULLNAMEENG: user.displayName || user.givenName,
                CODE: formattedEmpID,
                EMAIL: user.mail || user.userPrincipalName || "",
                ...user
            };
        } catch (e) {
            console.error("Error decoding CA&A user data:", e);
            return null;
        }
    }

    async getUserAD(rawEmployeeId: string): Promise<any> {
        try {
            const formattedEmpID = this.normalizeCaaEmployeeId(rawEmployeeId).replace(/^0+/, "");
            const token = await this.getToken();
            if (!token) {
                console.error("getUserAD: Failed to retrieve token");
                return null;
            }

            const baseUrl = await this.getConfig("CAA_URL");
            const clientId = await this.getConfig("CAA_CLIENT_ID");
            const tenantId = await this.getConfig("CAA_TENANT_ID");

            if (!baseUrl || !clientId) {
                console.warn("CAA_URL or CAA_CLIENT_ID is missing in config");
                return null;
            }

            const data: any = await this.curlRequest(this.buildCaaUrl(baseUrl, "user/listuser"), "POST", {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            }, {
                tenant_id: tenantId,
                client_id: clientId,
                filter: this.buildCaaUserFilter(formattedEmpID)
            });

            return this.decodeCaaUserData(data, formattedEmpID);
        } catch (error) {
            console.error("Error in getUserAD:", error);
            return null;
        }
    }
}

export default new ConfigService();
