import { sql, poolPromise } from '../config/db.js';
import configService from './configService.js';
import { nanoid } from 'nanoid';

class UserService {
    async getUserWithPassword(employeeID: string) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('EmployeeID', sql.VarChar(20), employeeID)
                .query(`
                    SELECT UserID, EmployeeID, Password, FullName Name, Email
                    FROM mp_User 
                    WHERE EmployeeID = @EmployeeID
                `);

            if (result.recordset && result.recordset.length > 0) {
                return result.recordset[0];
            }
            return null;
        } catch (error) {
            console.error('Error fetching user with password:', error);
            throw error;
        }
    }

    async syncUserFromAD(rawEmployeeID: string) {
        if (!rawEmployeeID) return null;
        
        // Sanitize Test Accounts where Email Prefix is longer than 20 chars (e.g. Test-01-CL6900001-SWP)
        let employeeID = rawEmployeeID;
        if (employeeID.length > 20) {
            if (employeeID.includes('-CL')) {
                employeeID = employeeID.split('-CL')[0];
            } else {
                employeeID = employeeID.substring(0, 20);
            }
        }

        try {
            const pool = await poolPromise;

            // 1. Fetch from AD (CA&A)
            const adData = await configService.getUserAD(employeeID);

            if (!adData) {
                console.warn(`User ${employeeID} not found in AD.`);
                return null;
            }

            // 2. Map AD Data
            const newUserId = nanoid();
            const fullName = adData.FULLNAMETH || '';
            const email = adData.EMAIL || '';
            

            let beginDate = new Date();
            const potentialDateFields = ['STARTDATE', 'ENTRYDATE', 'BEGINDATE', 'BeginDate', 'StartDate'];
            for (const field of potentialDateFields) {
                if (adData[field]) {
                    const parsedDate = new Date(adData[field]);
                    if (!isNaN(parsedDate.getTime())) {
                        beginDate = parsedDate;
                        break;
                    }
                }
            }

            // 3. Execute SP mp_AddUser
            const result = await pool.request()
                .input('UserID', sql.VarChar(21), newUserId)
                .input('EmployeeID', sql.VarChar(20), employeeID)
                .input('BeginDate', sql.DateTime, beginDate)
                .input('FullName', sql.NVarChar(200), fullName)
                .input('Email', sql.NVarChar(200), email)
                .execute('mp_AddUser');

            // 4. Return User Data
            if (result.recordset && result.recordset.length > 0) {
                const row = result.recordset[0];
                return {
                    UserID: row.UserID,
                    EmployeeID: row.EmployeeID,
                    Name: row.FullName || row.Name,
                    Email: row.Email
                };
            }
            return null;

        } catch (error) {
            console.error("Error in syncUserFromAD:", error);
            throw error;
        }
    }

    async checkUserOther(employeeID: string) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('EmployeeID', sql.NVarChar, employeeID)
                .query(`
                    SELECT * 
                    FROM MP_UserOther 
                    WHERE EmployeeID = @EmployeeID
                    AND EndDate >= CONVERT(date, GETDATE())
                `);

            if (result.recordset.length > 0) {
                const row = result.recordset[0];
                return {
                    UserID: row.UserOtherID,
                    EmployeeID: row.EmployeeID,
                    Name: row.FullName,
                    Email: '',
                    OrgUnit: '',
                    Position: ''
                };
            }
            return null;
        } catch (error) {
            console.error("Error in checkUserOther:", error);
            return null;
        }
    }

    async getUserByEmployeeID(employeeID: string) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('EmployeeID', sql.VarChar(20), employeeID)
                .execute('mp_UserGetByEmployeeID'); 

            if (result.recordset && result.recordset.length > 0) {
                const row = result.recordset[0];
                return {
                    UserID: row.UserID,
                    EmployeeID: row.EmployeeID,
                    Name: row.FullName || row.Name,
                    Email: row.Email
                };
            }
            return null;
        } catch (error) {
            console.error("Error in getUserByEmployeeID:", error);
            return null;
        }
    }

}

export default new UserService();
