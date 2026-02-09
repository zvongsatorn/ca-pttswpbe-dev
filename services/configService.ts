import { sql, poolPromise } from '../config/db.js';

class ConfigService {
    ADConnect: boolean;
    configCache: Record<string, string>;

    constructor() {
        this.ADConnect = false;
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
                const rawValue = result.recordset[0].Value1;
                this.ADConnect = String(rawValue).toLowerCase() === 'true';
            }
        } catch (error) {
            console.error("Error refreshing ADConnect config:", error);
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
        if (!this.ADConnect) {
            console.log("Mock Mode: Returning mock token");
            return "mock-token-xyz";
        }

        try {
            // Retrieve config keys
            const [url, username, password] = await Promise.all([
                this.getConfig('API_TOKEN'),
                this.getConfig('API_USER'),
                this.getConfig('API_PASS')
            ]);

            if (!url || !username || !password) {
                console.warn("Missing PTT API Config (API_TOKEN=url, API_USER, API_PASS)");
                return "";
            }

            // Encode User:Pass to Base64
            const credentials = Buffer.from(`${username}:${password}`).toString('base64');

            // Auth Header
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`
                },
                body: new URLSearchParams({
                    'grant_type': 'client_credentials'
                })
            });

            if (!response.ok) {
                console.error(`Failed to fetch token. Status: ${response.status} ${response.statusText}`);
                const text = await response.text();

                try {
                    const jsonError = JSON.parse(text);
                    console.error("Response JSON:", jsonError);
                } catch {
                    console.error("Response Text:", text);
                }
                return "";
            }

            const data: any = await response.json();
            return data.access_token || "";

        } catch (error) {
            console.error("Error in getToken:", error);
            return "";
        }
    }

    async getPosCode(employeeId: string): Promise<any> {
        if (!this.ADConnect) {
            return {
                POSNAME: 'Position',
                POSCODE: '999999',
                FULLNAMETH: 'User Thai',
                FULLNAMEENG: 'User Eng',
                CODE: employeeId
            };
        }
        try {
            // 1. Get employeeId
            const formattedEmpID = employeeId.replace(/^0+/, '');

            // 2. Get Token
            const token = await this.getToken();
            if (!token) {
                console.error("getPosCode: Failed to retrieve token");
                return "";
            }

            // 3. Get URL
            const url = await this.getConfig('REQUEST_ADDRESS2');
            if (!url) {
                console.warn("REQUEST_ADDRESS2 is missing in config");
                return "";
            }

            // 4. Fetch (GET)
            const response = await fetch(`${url}?Search_EmployeeCode=${formattedEmpID}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                console.error(`Failed to fetch PosCode. Status: ${response.status}`);
                const text = await response.text();
                console.error("Response:", text);
                return "";
            }

            const data: any = await response.json();

            if (!data['Entries'] || !data['Entries']['Entry']) {
                console.warn(`User ${formattedEmpID} not found in PTT System.`);
                return null;
            }

            const entry = data['Entries']['Entry'];

            if (Array.isArray(entry) && entry.length > 0) {
                return entry[0];
            }
            if (typeof entry === 'object') {
                return entry;
            }
            return null;

        } catch (error) {
            console.error("Error in getPosCode:", error);
            return null;
        }
    }

}

export default new ConfigService();
