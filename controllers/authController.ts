import { Context } from 'hono';
import bcrypt from 'bcrypt';

import jwt from 'jsonwebtoken';
import configService from '../services/configService.js';
import userGroupService from '../services/userGroupService.js';
import * as userService from '../services/userService.js';

class AuthController {
    login = async (c: Context) => {
        try {
            const body = await c.req.json();
            let EmployeeID: string = body.EmployeeID || body.employeeID;
            const Password = body.Password || body.password;

            if (EmployeeID && /^\d+$/.test(EmployeeID)) {
                EmployeeID = EmployeeID.padStart(8, '0');
            }

            if (!EmployeeID || !Password) {
                return c.json({ message: 'EmployeeID and Password are required' }, 400);
            }




            // 1. Authenticate / Check Existence
            const userData: any = await userService.getUserWithPassword(EmployeeID);

            if (!userData) {
                return c.json({ message: 'User not found' }, 404);
            }

            // 2. Validate Password
            if (!userData.Password) {
                return c.json({ message: 'User does not have a local password set' }, 401);
            }

            const isPasswordValid = await bcrypt.compare(Password, userData.Password);
            if (!isPasswordValid) {
                return c.json({ message: 'Invalid Admin credentials' }, 401);
            }


            // Map user data for Token validation completion
            const user = {
                EmployeeID: userData.EmployeeID || userData.employeeID || userData.CODE || EmployeeID,
                Name: userData.Name || userData.NAME || userData.FULLNAMETH || userData.FULLNAMEENG || userData.name || 'Admin User',
                Email: userData.Email || userData.EMAIL || '',
                UserID: userData.UserID || userData.UserId || ''
            };

            // 3. Get User Groups
            const userGroups = await userGroupService.getGroupsForUser(EmployeeID);

            // 3.1 Get StartYear Config
            let startYear = await configService.getConfig('StartYear');
            if (!startYear) startYear = "2562"; // Default fallback

            // 4. Generate Token
            const SECRET_KEY = process.env.JWT_SECRET;
            if (!SECRET_KEY) {
                throw new Error("JWT_SECRET is not defined in environment variables.");
            }

            const token = jwt.sign(
                {
                    id: user.EmployeeID,
                    role: 'user',
                    groups: userGroups,
                    name: user.Name,
                    email: user.Email,
                    position: userData.Position || '',
                    orgUnit: userData.OrgUnit || '',
                },
                SECRET_KEY,
                { expiresIn: '1d' }
            );

            // 5. Return Response
            return c.json({
                message: 'Login successful',
                token,
                user: {
                    employeeID: user.EmployeeID,
                    name: user.Name,
                    email: user.Email,
                    userGroups: userGroups
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
            const { accessToken, email, employeeID: reqEmpID, type } = body;

            if (!accessToken) {
                return c.json({ message: 'Microsoft Access Token is required for SSO' }, 400);
            }

            // 1. Get CA&A System Token
            const systemToken = await configService.getToken();
            if (!systemToken) {
                console.error("[SSO] Failed to retrieve system token from CA&A");
                return c.json({ 
                    message: 'Failed to retrieve system token from CA&A. Check backend logs for native request errors.', 
                    error: 'CAA_TOKEN_FAILURE' 
                }, 500);
            }

            // 2. Validate Microsoft Token with CA&A
            const caaUrl = await configService.getConfig('CAA_URL');
            let caaData;

            if (type === 'B2C') {
                const b2cClientId = process.env.NEXT_PUBLIC_B2C_CLIENT_ID || '';
                const b2cTenantId = process.env.NEXT_PUBLIC_B2C_TENANT_ID || '';
                const targetUrl = `${caaUrl}/auth/b2c/${b2cClientId}`;
                
                const b2cPayload = {
                    v: JSON.stringify({
                        tenant_id: b2cTenantId,
                        client_id: b2cClientId,
                        validated_claims: "",
                        object_id: ""
                    })
                };

                caaData = await configService.curlRequest(targetUrl, 'POST', {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${systemToken}`
                }, b2cPayload);
            } else {
                const caaClientId = await configService.getConfig('CAA_CLIENT_ID');
                const targetUrl = `${caaUrl}/auth/ad/${caaClientId}`;
                
                const adPayload = {
                    v: JSON.stringify({
                        tenant_id: process.env.NEXT_PUBLIC_AZURE_TENANT_ID || '',
                        client_id: caaClientId,
                        validated_claims: "",
                        object_id: ""
                    })
                };

                caaData = await configService.curlRequest(targetUrl, 'POST', {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${systemToken}`
                }, adPayload);
            }

            if (!caaData) {
                return c.json({ message: 'Microsoft token verification failed with CA&A' }, 401);
            }

            // 3. Decode CA&A Response Data (if encoded)
            let decodedData = caaData;
            if (caaData.Data) {
                try {
                    const decodedString = Buffer.from(caaData.Data, 'base64').toString('utf-8');
                    decodedData = JSON.parse(decodedString);
                    console.log(`[SSO] Decoded CA&A Data:`, JSON.stringify(decodedData));
                } catch (e) {
                    console.warn("[SSO] Failed to decode CA&A Data field, using raw response");
                }
            }
            
            // Priority 1: Mandatory Email Lookup in our DB (as per user instruction)
            let EmployeeID = "";
            let userData: any = null;

            if (email) {
                userData = await userService.getUserByEmail(email);
                if (userData && userData.EmployeeID) {
                    EmployeeID = userData.EmployeeID;
                    console.log(`[SSO] Identified user by email: ${email} -> EmployeeID: ${EmployeeID}`);
                }
            }

            if (!EmployeeID) {
                console.warn(`[SSO] User with email ${email} authenticated via Microsoft but NOT FOUND in MP_User table.`);
                return c.json({ 
                    message: `User (${email}) is not registered in the Manpower Planning system. Please contact admin.`,
                    error: 'USER_NOT_FOUND'
                }, 403);
            }

            // Sync/Verify User Data
            if (type === 'B2C') {
                // For B2C, check if they are in other users table if not in main sync
                const otherData = await userService.checkUserOther(EmployeeID);
                if (otherData) userData = { ...userData, ...otherData };
            }

            if (!userData) {
                return c.json({ message: 'User authenticated via Microsoft but not found in System' }, 401);
            }

            console.log(`[SSO] User Data retrieved:`, JSON.stringify(userData));

            // Map user data for Token
            const user = {
                EmployeeID: userData.EmployeeID || userData.employeeID || userData.CODE || EmployeeID,
                Name: userData.FullName || userData.fullname || userData.Name || userData.NAME || userData.FULLNAMETH || userData.FULLNAMEENG || userData.name || 'Guest User',
                Email: userData.Email || userData.EMAIL || email || '',
                UserID: userData.UserID || userData.UserId || ''
            };

            const userGroups = await userGroupService.getGroupsForUser(EmployeeID);
            let startYear = await configService.getConfig('StartYear');
            if (!startYear) startYear = "2562";

            const SECRET_KEY = process.env.JWT_SECRET;
            if (!SECRET_KEY) {
                throw new Error("JWT_SECRET is not defined in environment variables.");
            }

            const token = jwt.sign(
                {
                    id: user.EmployeeID,
                    role: 'user',
                    groups: userGroups,
                    name: user.Name,
                    email: user.Email,
                    position: userData.Position || '',
                    orgUnit: userData.OrgUnit || '',
                },
                SECRET_KEY,
                { expiresIn: '1d' }
            );

            return c.json({
                message: 'SSO Login successful',
                token,
                user: {
                    employeeID: user.EmployeeID,
                    name: user.Name,
                    email: user.Email,
                    userGroups: userGroups
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
            const key = c.req.param('key');
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
            console.log(`[Registration] Verify Email Request for: ${email}`);

            if (!email) {
                return c.json({ message: 'Email is required' }, 400);
            }

            const token = await configService.getToken();
            const caaUrl = await configService.getConfig('CAA_URL');
            const appUser = await configService.getConfig('CAA_USER');
            const tenantId = await configService.getConfig('CAA_TENANT_ID');
            const clientId = await configService.getConfig('CAA_CLIENT_ID');
            const targetUrl = `${caaUrl.endsWith('/') ? caaUrl : caaUrl + '/'}azt/doservice`;

            console.log(`[Registration] Using appUser: ${appUser}, token prefix: ${token?.substring(0, 10)}...`);

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
                    password: "Password@123" // Placeholder, user will change it
                },
                passwordPolicies: "None",
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

            console.log(`[Registration] Verify Email Payload (Encoded Params):`, JSON.stringify(payload, null, 2));
            console.log(`[Registration] Using token prefix: ${token.substring(0, 20)}...`);

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
            const { email, firstName, lastName } = body;
            console.log(`[Registration] Create Account Request for: ${email} (${firstName} ${lastName})`);

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

            console.log(`[Registration] Create Account Payload (Encoded Params):`, JSON.stringify(payload, null, 2));

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
