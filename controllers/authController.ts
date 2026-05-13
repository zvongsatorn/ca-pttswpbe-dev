import { Context } from 'hono';
import bcrypt from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import jwt from 'jsonwebtoken';
import configService from '../services/configService.js';
import userGroupService from '../services/userGroupService.js';
import * as userService from '../services/userService.js';
import { insertLogActionService } from '../services/logService.js';

const getJwtAccessTokenExpiresIn = (): number => {
    const configured = String(process.env.JWT_ACCESS_TOKEN_EXPIRES_IN || '').trim();
    const configuredSeconds = Number.parseInt(configured, 10);
    return Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 30 * 60;
};

const createTemporaryPassword = () => {
    const suffix = randomBytes(12).toString('base64url');
    return `Tmp-${suffix}9!`;
};

const constantTimeEquals = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const scorePasswordKey = (key: string): number => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "password") return 100;
    if (normalizedKey === "passwordhash") return 95;
    if (normalizedKey === "userpassword") return 90;
    if (normalizedKey === "pwd") return 85;
    if (normalizedKey.includes("password")) return 80;
    if (normalizedKey.includes("pwd")) return 75;
    return 0;
};

const stringifyPasswordValue = (value: unknown): string => {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
    return "";
};

const extractPassword = (record: Record<string, unknown>): string => {
    const candidates = Object.entries(record || {})
        .map(([key, value]) => ({ value, score: scorePasswordKey(key) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

    for (const item of candidates) {
        const passwordValue = stringifyPasswordValue(item.value);
        if (passwordValue) return passwordValue;
    }

    return "";
};

const verifyStoredPassword = async (input: string, stored: string): Promise<boolean> => {
    if (/^\$2[aby]\$\d{2}\$/.test(stored)) {
        return bcrypt.compare(input, stored);
    }

    const sha256Hex = createHash("sha256").update(input).digest("hex");
    const sha256Base64 = createHash("sha256").update(input).digest("base64");
    return [sha256Hex, sha256Hex.toUpperCase(), sha256Base64]
        .some((candidate) => constantTimeEquals(candidate, stored));
};

const parseLoginCredentials = (body: Record<string, unknown>): { employeeId: string; password: string } => {
    let employeeId = String(body.EmployeeID || body.employeeID || '').trim();
    if (employeeId && /^\d+$/.test(employeeId)) {
        employeeId = employeeId.padStart(8, '0');
    }
    return {
        employeeId,
        password: String(body.Password || body.password || '')
    };
};

const mapLoginUser = (userData: any, employeeId: string) => ({
    EmployeeID: userData.EmployeeID || userData.employeeID || userData.CODE || employeeId,
    Name: userData.FullName || userData.fullName || userData.Name || userData.NAME || userData.FULLNAMETH || userData.FULLNAMEENG || userData.name || employeeId,
    Email: userData.Email || userData.EMAIL || '',
    UserID: userData.UserID || userData.UserId || ''
});

const ensureLoginUserGroups = async (employeeId: string) => {
    let userGroups = await userGroupService.getGroupsForUser(employeeId);
    if (userGroups.length === 0) {
        console.log('[Login] User has no groups, auto-assigning to group 08 (OTHER)');
        await userGroupService.insertUserInGroup('08', employeeId, 'SYSTEM');
        userGroups = await userGroupService.getGroupsForUser(employeeId);
    }
    return userGroups;
};

const signLoginToken = (user: { EmployeeID: string; Name: string; Email: string }, userData: any, userGroups: unknown[]) => {
    const secretKey = process.env.JWT_SECRET;
    if (!secretKey) {
        throw new Error('JWT_SECRET is not defined in environment variables.');
    }
    return jwt.sign(
        {
            id: user.EmployeeID,
            role: 'user',
            groups: userGroups,
            name: user.Name,
            email: user.Email,
            position: userData.Position || '',
            orgUnit: userData.OrgUnit || '',
            profilePicture: userData.ProfilePicture || '',
        },
        secretKey,
        { expiresIn: getJwtAccessTokenExpiresIn() }
    );
};
const getSsoCaaData = async (type: string, accessToken: string, systemToken: string) => {
    const caaUrl = await configService.getConfig('CAA_URL');
    const authHeaders = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + systemToken
    };

    if (type === 'B2C') {
        const b2cClientId = process.env.NEXT_PUBLIC_B2C_CLIENT_ID || '';
        const b2cTenantId = process.env.NEXT_PUBLIC_B2C_TENANT_ID || '';
        const targetUrl = caaUrl + '/auth/b2c/' + b2cClientId;
        const b2cPayload = {
            v: JSON.stringify({
                tenant_id: b2cTenantId,
                client_id: b2cClientId,
                validated_claims: "",
                object_id: ""
            })
        };

        return configService.curlRequest(targetUrl, 'POST', authHeaders, b2cPayload);
    }

    const caaClientId = await configService.getConfig('CAA_CLIENT_ID');
    // The Postman collection confirms the AD endpoint is just /auth/ad (no ID in path)
    const targetUrl = caaUrl.endsWith('/') ? caaUrl + 'auth/ad' : caaUrl + '/auth/ad';
    const adPayload = {
        v: JSON.stringify({
            tenant_id: process.env.NEXT_PUBLIC_AZURE_TENANT_ID || '',
            client_id: caaClientId,
            access_token: accessToken,
            validated_claims: "",
            object_id: ""
        })
    };

    return configService.curlRequest(targetUrl, 'POST', authHeaders, adPayload);
};

const decodeSsoCaaData = (caaData: any) => {
    if (!caaData?.Data) {
        return caaData;
    }

    try {
        const decodedString = Buffer.from(caaData.Data, 'base64').toString('utf-8');
        const decodedData = JSON.parse(decodedString);
        console.log('[SSO] Decoded CA&A data successfully.');
        return decodedData;
    } catch {
        console.warn("[SSO] Failed to decode CA&A Data field, using raw response");
        return caaData;
    }
};

const findSsoUserByEmail = async (email: string) => {
    if (!email) {
        return { employeeId: '', userData: null as any };
    }

    const userData: any = await userService.getUserByEmail(email);
    const employeeId = String(userData?.EmployeeID || '');
    if (employeeId) {
        console.log('[SSO] Identified user by email lookup.');
    }

    return { employeeId, userData };
};

const enrichSsoUserData = async (type: string, employeeId: string, userData: any) => {
    if (type !== 'B2C') return userData;

    const otherData = await userService.checkUserOther(employeeId);
    return otherData ? { ...userData, ...otherData } : userData;
};

const mapSsoUser = (userData: any, employeeId: string, email: string) => ({
    EmployeeID: userData.EmployeeID || userData.employeeID || userData.CODE || employeeId,
    Name: userData.FullName || userData.fullname || userData.Name || userData.NAME || userData.FULLNAMETH || userData.FULLNAMEENG || userData.name || 'Guest User',
    Email: userData.Email || userData.EMAIL || email || '',
    UserID: userData.UserID || userData.UserId || ''
});

const ensureSsoUserGroups = async (employeeId: string) => {
    let userGroups = await userGroupService.getGroupsForUser(employeeId);
    if (userGroups.length === 0) {
        console.log('[SSO] User has no groups, auto-assigning to group 08 (OTHER)');
        await userGroupService.insertUserInGroup('08', employeeId, 'SYSTEM');
        userGroups = await userGroupService.getGroupsForUser(employeeId);
    }
    return userGroups;
};

const writeSsoLoginActionLog = async (employeeId: string, userGroups: any[]) => {
    const defaultUserGroupNo = String(userGroups?.[0]?.userGroupNo || '').trim();
    try {
        await insertLogActionService({
            employeeId,
            actionId: 1,
            subjectId: 0,
            userRole: defaultUserGroupNo,
            note: 'SSO Login successful',
            adminFlag: defaultUserGroupNo === '01' ? 1 : 0
        });
    } catch (logError) {
        console.error('[SSO Login] Failed to write action log:', logError);
    }
};

class AuthController {
    login = async (c: Context) => {
        try {
            const body = await c.req.json();
            const { employeeId: EmployeeID, password: Password } = parseLoginCredentials(body);

            if (!EmployeeID || !Password) {
                return c.json({ message: 'EmployeeID and Password are required' }, 400);
            }

            // Admin mode: validate by existence in MP_User only.
            const userData: any = await userService.getUserWithPassword(EmployeeID);
            if (!userData) {
                return c.json({ message: 'User not found in MP_User' }, 404);
            }

            const storedPassword = extractPassword(userData as Record<string, unknown>);

            if (!storedPassword) {
                console.warn('[Login] Local password is not configured for requested user.');
                return c.json({ message: "User does not have a local password set" }, 401);
            }

            const isPasswordValid = await verifyStoredPassword(Password, storedPassword);

            if (!isPasswordValid) {
                return c.json({ message: 'Invalid Admin credentials' }, 401);
            }


            // Map user data for Token validation completion
            const user = mapLoginUser(userData, EmployeeID);

            // 3. Get User Groups
            const userGroups = await ensureLoginUserGroups(EmployeeID);

            // 3.1 Get StartYear Config
            let startYear = await configService.getConfig('StartYear');
            if (!startYear) startYear = '2562'; // Default fallback

            // 4. Generate Token
            const token = signLoginToken(user, userData, userGroups);

            const defaultUserGroupNo = String(userGroups?.[0]?.userGroupNo || '').trim();
            try {
                await insertLogActionService({
                    employeeId: user.EmployeeID,
                    actionId: 1,
                    subjectId: 0,
                    userRole: defaultUserGroupNo,
                    note: 'Login successful',
                    adminFlag: defaultUserGroupNo === '01' ? 1 : 0
                });
            } catch (logError) {
                console.error('[Login] Failed to write action log:', logError);
            }

            // 5. Return Response
            return c.json({
                message: 'Login successful',
                token,
                user: {
                    employeeID: user.EmployeeID,
                    name: user.Name,
                    email: user.Email,
                    userGroups: userGroups,
                    profilePicture: userData.ProfilePicture || '',
                },
                config: {
                    startYear
                }
            });

        } catch (error: any) {
            console.error('Login error:', error);
            return c.json({ message: 'Internal server error', error: error.message }, 500);
        }
    }

    ssoLogin = async (c: Context) => {
        try {
            const body = await c.req.json();
            const { accessToken, email = '', type = '' } = body;

            if (!accessToken) {
                return c.json({ message: 'Microsoft Access Token is required for SSO' }, 400);
            }

            const systemToken = await configService.getToken();
            if (!systemToken) {
                console.error("[SSO] Failed to retrieve system token from CA&A");
                return c.json({ 
                    message: 'Failed to retrieve system token from CA&A. Check backend logs for native request errors.', 
                    error: 'CAA_TOKEN_FAILURE' 
                }, 500);
            }

            const caaData = await getSsoCaaData(type, accessToken, systemToken);
            if (!caaData) {
                return c.json({ message: 'Microsoft token verification failed with CA&A' }, 401);
            }
            decodeSsoCaaData(caaData);

            const ssoUser = await findSsoUserByEmail(email);
            if (!ssoUser.employeeId) {
                console.warn('[SSO] Microsoft-authenticated user was not found in MP_User table.');
                return c.json({ 
                    message: 'User (' + email + ') is not registered in the Manpower Planning system. Please contact admin.',
                    error: 'USER_NOT_FOUND'
                }, 403);
            }

            const userData = await enrichSsoUserData(type, ssoUser.employeeId, ssoUser.userData);
            if (!userData) {
                return c.json({ message: 'User authenticated via Microsoft but not found in System' }, 401);
            }

            console.log('[SSO] User data retrieved for authenticated employee.');

            const user = mapSsoUser(userData, ssoUser.employeeId, email);
            const userGroups = await ensureSsoUserGroups(ssoUser.employeeId);
            const startYear = await configService.getConfig('StartYear') || "2562";
            const token = signLoginToken(user, userData, userGroups);

            await writeSsoLoginActionLog(user.EmployeeID, userGroups);

            return c.json({
                message: 'SSO Login successful',
                token,
                user: {
                    employeeID: user.EmployeeID,
                    name: user.Name,
                    email: user.Email,
                    userGroups: userGroups,
                    profilePicture: userData.ProfilePicture || '',
                },
                config: {
                    startYear
                }
            });

        } catch (error: any) {
            console.error('SSO Login error:', error);
            return c.json({ message: 'Internal server error during SSO', error: error.message }, 500);
        }
    }

    getPublicConfig = async (c: Context) => {
        try {
            const key = c.req.param('key') ?? '';
            // Whitelist for public config keys
            const allowedKeys = ['LoginAdmin', 'SignupB2C'];
            
            if (!allowedKeys.includes(key)) {
                return c.json({ message: 'Access denied to this configuration' }, 403);
            }

            const value = await configService.getConfig(key);
            return c.json({ key, value });
        } catch (error: any) {
            console.error('getPublicConfig error:', error);
            return c.json({ message: 'Internal server error', error: error.message }, 500);
        }
    }

    registerVerifyEmail = async (c: Context) => {
        try {
            const body = await c.req.json();
            const { email } = body;
            console.log('[Registration] Verify email request received.');

            if (!email) {
                return c.json({ message: 'Email is required' }, 400);
            }

            const token = await configService.getToken();
            const caaUrl = await configService.getConfig('CAA_URL');
            const appUser = await configService.getConfig('CAA_USER');
            const targetUrl = `${caaUrl.endsWith('/') ? caaUrl : caaUrl + '/'}azt/doservice`;

            console.log('[Registration] CA&A app user resolved.');

            const b2cTenantId = await configService.getConfig('CAA_TENANT_ID');
            const b2cClientId = await configService.getConfig('CAA_CLIENT_ID');
            const b2cDomain = await configService.getConfig('CAA_B2C_DOMAIN') || "pttplcb2ctest01.onmicrosoft.com";

            const dataPayload = {
                tenant_id: b2cTenantId,
                client_id: b2cClientId,
                accountEnabled: true,
                url_redirect: "http://localhost:3000/register?step=3",
                email_template: "<div style='font-size:18.0pt;font-family:\"CordiaNew\",sans-serif'><p>Dear User,</p><br><p>Please verify email to register your account:<a href='##url_redirect##'>click here to verify</a></p><br><p>Yours sincerely,<br/>CA&ATeam</p></div>",
                project_code: appUser,
                displayName: "SWP Registration",
                givenName: "New",
                surname: "User",
                mail: email,
                identities: [{
                    issuer: b2cDomain,
                    signInType: "emailAddress",
                    issuerAssignedId: email
                }],
                passwordProfile: {
                    forceChangePasswordNextSignIn: true,
                    password: createTemporaryPassword()
                },
                userPrincipalName: `${Date.now()}_${email.split('@')[0]}@${b2cDomain}`,
                created_by: "SWP System"
            };

            const payload = {
                function_id: "F100045",
                app_user: appUser,
                req_transaction_id: `REG-${Date.now()}`,
                req_parameters: [
                    { k: "by", v: Buffer.from(email).toString('base64') },
                    { k: "data", v: Buffer.from(JSON.stringify(dataPayload)).toString('base64') }
                ]
            };

            if (!token) {
                return c.json({ message: 'Unable to retrieve CA&A token' }, 502);
            }

            console.log('[Registration] CA&A token retrieved.');

            // Use Python workaround for stability on corporate networks
            // Send payload as ROOT JSON (no 'v' wrapping)
            const data: any = await configService.curlRequest(targetUrl, 'POST', {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }, payload);

            return c.json(data);
        } catch (error: any) {
            console.error('registerVerifyEmail error:', error);
            return c.json({ message: 'Internal server error', error: error.message }, 500);
        }
    }

    registerCreateAccount = async (c: Context) => {
        try {
            const body = await c.req.json();
            const { email } = body;
            console.log('[Registration] Create account request received.');

            if (!email) {
                return c.json({ message: 'Email is required' }, 400);
            }

            const token = await configService.getToken();
            const caaUrl = await configService.getConfig('CAA_URL');
            const appUser = await configService.getConfig('CAA_USER');
            const targetUrl = `${caaUrl.endsWith('/') ? caaUrl : caaUrl + '/'}azt/doservice`;

            // Correct structure for F100047 based on PDF guidance
            // Usually needs the token from the email
            const { token: verifyToken } = body;

            const payload = {
                function_id: "F100047",
                app_user: appUser,
                req_transaction_id: `CRE-${Date.now()}`,
                req_parameters: [
                    { k: "token", v: Buffer.from(verifyToken || '').toString('base64') },
                    { k: "password", v: Buffer.from(body.password || '').toString('base64') }
                ]
            };

            console.log('[Registration] Create account payload prepared.');

            // Use Python workaround for stability on corporate networks
            // Send payload as ROOT JSON (no 'v' wrapping)
            const data: any = await configService.curlRequest(targetUrl, 'POST', {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }, payload);

            return c.json(data);
        } catch (error: any) {
            console.error('registerCreateAccount error:', error);
            return c.json({ message: 'Internal server error', error: error.message }, 500);
        }
    }

}

export default new AuthController();
