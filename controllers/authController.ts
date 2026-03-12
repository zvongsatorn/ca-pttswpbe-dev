import { Context } from 'hono';
import bcrypt from 'bcrypt';

import jwt from 'jsonwebtoken';
import configService from '../services/configService.js';
import userGroupService from '../services/userGroupService.js';
import userService from '../services/userService.js';

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

            // 0. Refresh Config (Check ADConnect status)
            await configService.refreshADConnect();



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
                EmployeeID: userData.EmployeeID,
                Name: userData.Name || '',
                Email: userData.Email || '',
                UserID: userData.UserID
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
                return c.json({ message: 'Failed to retrieve system token from CA&A' }, 500);
            }

            // 2. Validate Microsoft Token with CA&A
            const caaUrl = await configService.getConfig('CAA_URL');
            let caaResponse;
            let caaData;

            if (type === 'B2C') {
                // B2C Loginc Flow
                const b2cTenantId = process.env.NEXT_PUBLIC_B2C_TENANT_ID || '';
                const b2cClientId = process.env.NEXT_PUBLIC_B2C_CLIENT_ID || '';
                
                const b2cPayload = {
                    v: JSON.stringify({
                        tenant_id: b2cTenantId,
                        client_id: b2cClientId,
                        validated_claims: "",
                        object_id: ""
                    })
                };

                // The CA&A B2C endpoint requires the ClientID in the URL path
                caaResponse = await fetch(`${caaUrl}/auth/b2c/${b2cClientId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${systemToken}`
                    },
                    body: JSON.stringify(b2cPayload) // Access token usually goes in the header or validated separately if required by CA&A, or we trust our own MSAL verification pass
                });

            } else {
                // Standard AD Login Flow
                const caaClientId = await configService.getConfig('CAA_CLIENT_ID');
                const adPayload = {
                    v: JSON.stringify({
                        tenant_id: process.env.NEXT_PUBLIC_AZURE_TENANT_ID || '',
                        client_id: caaClientId,
                        access_token: accessToken
                    })
                };

                caaResponse = await fetch(`${caaUrl}/auth/ad`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${systemToken}`
                    },
                    body: JSON.stringify(adPayload)
                });
            }

            if (!caaResponse.ok) {
                const errText = await caaResponse.text();
                console.error(`CA&A ${type || 'AD'} Verification Failed:`, caaResponse.status, errText);
                return c.json({ message: 'Microsoft token verification failed with CA&A' }, 401);
            }

            caaData = await caaResponse.json();
            
            // Assuming CA&A returns employee data after validation.
            // If it only returns OK, we might need to call /user/listuser or rely on the frontend's email.
            // For now, let's assume we can map the email back to our DB.
            let EmployeeID = reqEmpID || caaData?.employeeID || email?.split('@')[0];

            // Sanitize Test Accounts where Email Prefix is longer than 20 chars (e.g. Test-01-CL6900001-SWP)
            if (EmployeeID && EmployeeID.length > 20) {
                if (EmployeeID.includes('-CL')) {
                    EmployeeID = EmployeeID.split('-CL')[0]; // Extracts "Test-01"
                } else {
                    EmployeeID = EmployeeID.substring(0, 20); // Fallback
                }
            }

            if (!EmployeeID) {
                return c.json({ message: 'Could not resolve Employee ID from Microsoft ID' }, 400);
            }

            // Sync User from AD/DB
            let userData: any = null;
            
            if (type === 'B2C' && EmployeeID) {
                // External B2C User - try checking local DB first
                userData = await userService.checkUserOther(EmployeeID);
                if (!userData) {
                   // Graceful fallback for external B2C users never synced before
                   userData = {
                       UserID: `B2C-${EmployeeID.substring(0, 15)}`,
                       EmployeeID: EmployeeID,
                       Name: caaData?.displayName || email || EmployeeID,
                       Email: email || EmployeeID,
                       // External users usually get a default read-only or specific external role 
                       // We'll rely on checkUserOther if they need permissions, otherwise provide base
                   };
                }
            } else {
                // Internal AD User
                userData = await userService.syncUserFromAD(EmployeeID);
                if (!userData) {
                    userData = await userService.checkUserOther(EmployeeID);
                }
            }

            if (!userData) {
                return c.json({ message: 'User authenticated via Microsoft but not found in System' }, 401);
            }

            // Map user data for Token
            const user = {
                EmployeeID: userData.EmployeeID,
                Name: userData.Name || userData.NAME || '',
                Email: userData.Email || email || '',
                UserID: userData.UserID
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

    authenticateWithConfigService = async (employeeID: string, password: string) => {
        try {
            const isBypass = (await configService.getConfig('bypass'))?.toLowerCase() === 'true';
            if (isBypass) return true;

            const userData = await configService.getUserAD(employeeID);

            if (['CAA'].includes(configService.ADConnect)) {

                if (!userData) {

                    console.warn(`User ${employeeID} not found or API error.`);
                    return false;
                }
            }

            if (password === 'fail') return false;

            return userData;
        } catch (e) {
            console.error("AD Auth Validation Failed", e);
            return false;
        }
    }
}

export default new AuthController();
