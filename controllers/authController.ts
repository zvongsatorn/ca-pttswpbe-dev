import { Context } from 'hono';
import { poolPromise } from '../config/db.js';
import jwt from 'jsonwebtoken';
import configService from '../services/configService.js';
import userGroupService from '../services/userGroupService.js';
import userService from '../services/userService.js';

class AuthController {
    login = async (c: Context) => {
        try {
            const body = await c.req.json();
            const EmployeeID = body.EmployeeID || body.employeeID;
            const Password = body.Password || body.password;

            if (!EmployeeID || !Password) {
                return c.json({ message: 'EmployeeID and Password are required' }, 400);
            }

            // 0. Refresh Config (Check ADConnect status)
            await configService.refreshADConnect();

            const pool = await poolPromise;

            // 1. Authenticate / Check Existence
            let userData: any = null;
            let checkSource = '';
            let pisData: any = null;

            // ----------------------------------------------------
            // CASE: Mock Mode (ADConnect = false) -> Bypass All Validation
            // ----------------------------------------------------
            if (!configService.ADConnect) {
                console.log("Mock Mode: Using Mock User Data");
                userData = {
                    EmployeeID: EmployeeID,
                    Name: 'Mock User',
                    Email: 'mock@example.com',
                    UserID: 'mock-user-id-' + EmployeeID,
                    Position: 'Mock Position',
                    OrgUnit: 'Mock Org'
                };
                checkSource = 'MOCK';
            }
            // ----------------------------------------------------
            // CASE: Normal Mode (ADConnect = true) -> Check PIS / DB
            // ----------------------------------------------------
            else {
                // Step 1: Check PIS
                pisData = await configService.getPosCode(EmployeeID);

                if (pisData) {
                    // Found in PIS -> Sync to MP_User
                    userData = await userService.syncUserFromPIS(EmployeeID);
                    checkSource = 'PIS';
                } else {
                    // Step 2: Check MP_UserOther
                    userData = await userService.checkUserOther(EmployeeID);
                    checkSource = 'UserOther';
                }

                if (!userData) {
                    return c.json({ message: 'Invalid credentials or User not found in System' }, 401);
                }
            }

            // Map user data for Token
            const user = {
                EmployeeID: userData.EmployeeID,
                Name: userData.Name || userData.NAME || '',
                Email: userData.Email || userData.EMAIL || '',
                UserID: userData.UserID
            };

            // 3. Get User Groups
            const userGroups = await userGroupService.getGroupsForUser(EmployeeID);

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
                    position: checkSource === 'MOCK' ? userData.Position : (checkSource === 'PIS' ? (pisData?.POSNAME || 'Employee') : ''),
                    orgUnit: checkSource === 'MOCK' ? userData.OrgUnit : (checkSource === 'PIS' ? (pisData?.CODE || pisData?.POSCODE || '') : ''),
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
                }
            });

        } catch (error: any) {
            console.error('Login error:', error);
            return c.json({ message: 'Internal server error', error: error.message }, 500);
        }
    }

    authenticateWithConfigService = async (employeeID: string, password: string) => {
        try {
            const posCode = await configService.getPosCode(employeeID);

            if (configService.ADConnect) {

                if (!posCode) {

                    console.warn(`User ${employeeID} not found or API error.`);
                    return false;
                }
            }

            if (password === 'fail') return false;

            return posCode;
        } catch (e) {
            console.error("AD Auth Validation Failed", e);
            return false;
        }
    }
}

export default new AuthController();
