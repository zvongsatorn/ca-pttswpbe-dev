import { sql, poolPromise } from '../config/db.js';
import configService from './configService.js';
import { nanoid } from 'nanoid';

class UserService {
    async syncUserFromPIS(employeeID: string) {
        if (!employeeID) return null;

        try {
            const pool = await poolPromise;

            // 1. Fetch from PIS first
            const pisData = await configService.getPosCode(employeeID);

            if (!pisData) {
                console.warn(`User ${employeeID} not found in PIS.`);
                return null;
            }

            // 2. Map PIS Data
            const newUserId = nanoid();
            const fullName = pisData.FULLNAMETH || '';
            const orgUnit = pisData.UNITCODE || '';
            const position = pisData.POSCODE || '';
            const email = pisData.EMAIL || '';

            let beginDate = new Date();
            const potentialDateFields = ['STARTDATE', 'ENTRYDATE', 'BEGINDATE', 'BeginDate', 'StartDate'];
            for (const field of potentialDateFields) {
                if (pisData[field]) {
                    const parsedDate = new Date(pisData[field]);
                    if (!isNaN(parsedDate.getTime())) {
                        beginDate = parsedDate;
                        break;
                    }
                }
            }

            // 3. Execute mp_AddUser (Stored Procedure handles Check & Insert & Select)
            const result = await pool.request()
                .input('UserID', sql.VarChar(21), newUserId)
                .input('EmployeeID', sql.VarChar(20), employeeID)
                .input('BeginDate', sql.DateTime, beginDate)
                .input('FullName', sql.NVarChar(200), fullName)
                .input('OrgUnit', sql.VarChar(8), orgUnit)
                .input('Position', sql.VarChar(8), position)
                .input('Email', sql.NVarChar(200), email)
                .execute('mp_AddUser');

            // 4. Return User Data from SP Result
            if (result.recordset && result.recordset.length > 0) {
                const row = result.recordset[0];
                return {
                    UserID: row.UserID,
                    EmployeeID: row.EmployeeID,
                    Name: row.FullName || row.Name,
                    OrgUnit: row.OrgUnit,
                    Position: row.Position,
                    Email: row.Email
                };
            }
            return null;

        } catch (error) {
            console.error("Error in syncUserFromPIS:", error);
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

}

export default new UserService();
