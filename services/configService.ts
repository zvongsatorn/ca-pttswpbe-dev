import { sql, poolPromise } from '../config/db.js';

class ConfigService {
    ADConnect: string;
    configCache: Record<string, string>;

    constructor() {
        this.ADConnect = 'LOCAL';
        this.configCache = {};
    }

    async loadConfig() {
        await this.refreshADConnect();
        console.log(`Config Loaded. ADConnect: ${this.ADConnect}`);
    }

    async refreshADConnect() {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('KeyName', sql.NVarChar, 'ADConnect')
                .execute('mp_ConfigGetByKeyName');

            if (result.recordset.length > 0) {
                const rawValue = String(result.recordset[0].Value1).toUpperCase();
                if (['LOCAL', 'PIS', 'CAA'].includes(rawValue)) {
                    this.ADConnect = rawValue;
                } else if (rawValue === 'TRUE') {
                    this.ADConnect = 'PIS';
                } else {
                    this.ADConnect = 'LOCAL';
                }
            } else {
                this.ADConnect = 'LOCAL';
            }
        } catch (error) {
            console.error("Error refreshing ADConnect config:", error);
            this.ADConnect = 'LOCAL';
        }
    }

    async getConfig(key: string): Promise<string> {
        if (this.configCache[key]) return this.configCache[key];

        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('KeyName', sql.NVarChar, key)
                .execute('mp_ConfigGetByKeyName');

            if (result.recordset.length > 0) {
                const value = result.recordset[0].Value1;
                this.configCache[key] = value;
                return value;
            }
        } catch (err) {
            console.error(`Error fetching config ${key}:`, err);
        }
        return "";
    }

    async getToken(): Promise<string> {
        if (this.ADConnect === 'LOCAL') {
            console.log("Mock Mode: Returning mock token");
            return "mock-token-xyz";
        }

        try {
            if (this.ADConnect === 'CAA') {
                // Fetch CAA Configs for CA&A basic auth
                const [baseUrl, username, password] = await Promise.all([
                    this.getConfig('CAA_URL'),
                    this.getConfig('CAA_USER'),
                    this.getConfig('CAA_PASS')
                ]);

                if (!baseUrl || !username || !password) {
                    console.warn("Missing CAA API Config (CAA_URL, CAA_USER, CAA_PASS)");
                    return "";
                }

                // Append endpoint to base URL
                const tokenUrl = baseUrl.endsWith('/') ? `${baseUrl}auth/getJWT` : `${baseUrl}/auth/getJWT`;

                // Encode username:password to Base64 (from Postman basic auth config)
                const credentials = Buffer.from(`${username}:${password}`).toString('base64');

                // Call CA&A getJWT Endpoint
                const response = await fetch(tokenUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${credentials}`
                    }
                });

                if (!response.ok) {
                    console.error(`Failed to fetch CAA token. Status: ${response.status} ${response.statusText}`);
                    const text = await response.text();
                    console.error("Response:", text);
                    return "";
                }

                const data: any = await response.json();
                
                if (data && data.Data) {
                    try {
                        const decodedString = Buffer.from(data.Data, 'base64').toString('utf-8');
                        const tokenObject = JSON.parse(JSON.parse(decodedString));
                        return tokenObject.access_token || "";
                    } catch (e) {
                        console.error("Error decoding CAA token data:", e);
                        return "";
                    }
                }
                return "";
            }
        } catch (error) {
            console.error("Error in getToken:", error);
        }
        return "";
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

        if (this.ADConnect === 'LOCAL') {
            return {
                FULLNAMETH: 'User Thai',
                FULLNAMEENG: 'User Eng',
                CODE: employeeId,
                EMAIL: `${employeeId}@mock.pttplc.com`
            };
        }
        try {
            // 1. Get employeeId
            const formattedEmpID = employeeId.replace(/^0+/, '');

            // 2. Get Token
            const token = await this.getToken();
            if (!token) {
                console.error("getUserAD: Failed to retrieve token");
                return "";
            }

            // 3. Fetch Data based on mode
            if (this.ADConnect === 'CAA') {
                const baseUrl = await this.getConfig('CAA_URL');
                const clientId = await this.getConfig('CAA_CLIENT_ID');
                const tenantId = await this.getConfig('CAA_TENANT_ID'); 

                if (!baseUrl || !clientId) {
                    console.warn("CAA_URL or CAA_CLIENT_ID is missing in config");
                    return null;
                }

                const listUserUrl = baseUrl.endsWith('/') ? `${baseUrl}user/listuser` : `${baseUrl}/user/listuser`;
                
                // Allow searching by UserPrincipalName or mail starting with the employee ID
                const filterStr = `?$filter=startswith(userPrincipalName, '${formattedEmpID}') or startsWith(mail, '${formattedEmpID}')`;

                const response = await fetch(listUserUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        tenant_id: tenantId,
                        client_id: clientId,
                        filter: Buffer.from(filterStr).toString('base64')
                    })
                });

                if (!response.ok) {
                    console.error(`Failed to fetch CAA user/listuser. Status: ${response.status}`);
                    return null;
                }

                const data: any = await response.json();
                if (data && data.Data) {
                    try {
                        const decodedString = Buffer.from(data.Data, 'base64').toString('utf-8');
                        const parsed = JSON.parse(decodedString);
                        
                        if (parsed.value && Array.isArray(parsed.value) && parsed.value.length > 0) {
                            const user = parsed.value[0];
                            console.log(user);
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
            }
        } catch (error) {
            console.error("Error in getUserAD:", error);
            return null;
        }
    }

}

export default new ConfigService();
