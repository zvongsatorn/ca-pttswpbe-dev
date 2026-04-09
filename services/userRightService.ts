import { sql, poolPromise } from '../config/db.js';

class UserRightService {
    // 1. mp_OrgUnitInGroupGet (Reconstructed logic)
    async getOrgUnitInGroup(userGroupNo: string) {
        const pool = await poolPromise;
        try {
            // Use SP for dynamic filter (pass NULL for 'all')
            const request = pool.request();
            request.input('UserGroupNo', sql.NVarChar, userGroupNo !== 'all' ? userGroupNo : null);
            const result = await request.execute('mp_OrgUnitInGroupGet');
            
            // Group by OrgUnitID for frontend expectations
            const grouped = result.recordset.reduce((acc: any[], current: any) => {
                let unit = acc.find(item => item.OrgUnitID === current.OrgUnitID);
                if (!unit) {
                    unit = { OrgUnitID: current.OrgUnitID, users: [] };
                    acc.push(unit);
                }
                if (current.EmployeeID) {
                    unit.users.push({
                        EmployeeID: current.EmployeeID,
                        NameAll: current.NameAll || current.EmployeeID
                    });
                }
                return acc;
            }, []);

            return grouped;
        } catch (err) {
            console.error('Error in Service.getOrgUnitInGroup:', err);
            throw err;
        }
    }

    // 2. mp_OrgUnitInUserGet
    async getOrgUnitInUser(userGroupNo: string, employeeId: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeId)
            .execute('mp_OrgUnitInUserGet');
        return result.recordset;
    }

    // 3. mp_UserInOrgCheckExist and mp_UserInOrgUnitInsert
    async insertOrgUnitUser(userGroupNo: string, employeeId: string, orgUnitNo: string, createBy: string) {
        const pool = await poolPromise;

        // Check exist
        const checkResult = await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeId)
            .input('OrgUnitNo', sql.NVarChar, orgUnitNo)
            .execute('mp_UserInOrgCheckExist');

        if (checkResult.recordset.length > 0 && checkResult.recordset[0].CountExist > 0) {
            return { success: false, message: 'Data already exists.' };
        }

        // Insert
        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeId)
            .input('OrgUnitNo', sql.NVarChar, orgUnitNo)
            .input('BeginDate', sql.Date, new Date())
            .input('EndDate', sql.Date, new Date('9999-12-31'))
            .input('CreateBy', sql.NVarChar, createBy)
            .input('CreateDate', sql.DateTime, new Date())
            .execute('mp_UserInOrgUnitInsert');

        return { success: true };
    }

    // 4. mp_UserInOrgUnitUpdate (Delete)
    async deleteOrgUnitUser(userGroupNo: string, employeeId: string, orgUnitNo: string, updateBy: string) {
        const pool = await poolPromise;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeId)
            .input('OrgUnitNo', sql.NVarChar, orgUnitNo)
            .input('EndDate', sql.Date, yesterday)
            .input('UpdateBy', sql.NVarChar, updateBy)
            .input('UpdateDate', sql.DateTime, new Date())
            .execute('mp_UserInOrgUnitUpdate');
        
        return { success: true };
    }

    // 5. mp_UserInOrgUnitUpdateAll
    async deleteAllOrgUnitUser(userGroupNo: string, employeeId: string, updateBy: string) {
        const pool = await poolPromise;
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeId)
            .input('EndDate', sql.Date, yesterday)
            .input('UpdateBy', sql.NVarChar, updateBy)
            .input('UpdateDate', sql.DateTime, new Date())
            .execute('mp_UserInOrgUnitUpdateAll');
        
        return { success: true };
    }

    // Advanced Inserts
    async addUserInAllUnit(userGroupNo: string, employeeId: string, createBy: string) {
        const pool = await poolPromise;
        const now = new Date();
        const bdate = now.toISOString().split('T')[0].replace(/-/g, '');
        const edate = '99991231';

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeId)
            .input('BeginDate', sql.NVarChar, bdate)
            .input('EndDate', sql.NVarChar, edate)
            .input('CreateBy', sql.NVarChar, createBy)
            .input('CreateDate', sql.DateTime, now)
            .execute('mp_AddUserInAll');
        return { success: true };
    }

    async addUserInBUAll(userGroupNo: string, employeeId: string, bgNo: string, createBy: string) {
        const pool = await poolPromise;
        const now = new Date();
        const bdate = now.toISOString().split('T')[0].replace(/-/g, '');
        const edate = '99991231';

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeId)
            .input('BGNo', sql.NVarChar, bgNo)
            .input('BeginDate', sql.NVarChar, bdate)
            .input('EndDate', sql.NVarChar, edate)
            .input('CreateBy', sql.NVarChar, createBy)
            .input('CreateDate', sql.DateTime, now)
            .execute('mp_AddUserInBUAll');
        return { success: true };
    }

    async addUserInBelongAll(userGroupNo: string, employeeId: string, orgUnitNo: string, createBy: string) {
        const pool = await poolPromise;
        const now = new Date();
        const bdate = now.toISOString().split('T')[0].replace(/-/g, '');
        const edate = '99991231';

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeId)
            .input('OrgUnitNo', sql.NVarChar, orgUnitNo)
            .input('BeginDate', sql.NVarChar, bdate)
            .input('EndDate', sql.NVarChar, edate)
            .input('CreateBy', sql.NVarChar, createBy)
            .input('CreateDate', sql.DateTime, now)
            .execute('mp_AddUserInBelongAll');
        return { success: true };
    }

    // Combos
    async getBGCombo(effectiveMonth: string, effectiveYear: string) {
        const pool = await poolPromise;
        // Construct date: 01/MM/YYYY
        const checkDate = new Date(parseInt(effectiveYear), parseInt(effectiveMonth) - 1, 1);
        
        const result = await pool.request()
            .input('p_CheckDate', sql.DateTime, checkDate)
            .execute('mp_BGGetByEffectivePeriod');
        return result.recordset;
    }

    async getOrgUnitInBelong(employeeId: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            // Legacy mp_OrgUnitInBelongGet has no parameters
            .execute('mp_OrgUnitInBelongGet');
        return result.recordset;
    }

    async getUnitAllCombo(effectiveMonth: string, effectiveYear: string) {
        const pool = await poolPromise;
        // Construct date: 01/MM/YYYY
        const checkDate = new Date(parseInt(effectiveYear), parseInt(effectiveMonth) - 1, 1);

        const result = await pool.request()
            .input('p_CheckDate', sql.DateTime, checkDate)
            .execute('mp_UnitGetByEffectivePeriod');
        return result.recordset;
    }

    async getUsersByOrgUnit(orgUnitNo: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('OrgUnitNo', sql.NVarChar, orgUnitNo)
            .execute('mp_UsersByOrgUnitGet');
        return result.recordset;
    }

    // copyOrg
    async copyOrg(userGroupNo: string, employeeIdFrom: string, employeeIdTo: string, createBy: string) {
        const pool = await poolPromise;
        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeIDFrom', sql.NVarChar, employeeIdFrom)
            .input('EmployeeIDTo', sql.NVarChar, employeeIdTo)
            .input('CreateBy', sql.NVarChar, createBy)
            .execute('mp_UserInOrgCopy');
        return { success: true };
    }

    // 6. mp_GetUnitLineCombo
    async getUnitLineAsst(effectiveMonth: string, effectiveYear: string) {
        const pool = await poolPromise;
        // Construct date: 01/MM/YYYY
        const checkDate = new Date(parseInt(effectiveYear), parseInt(effectiveMonth) - 1, 1);
        
        const result = await pool.request()
            .input('EffectiveDate', sql.DateTime, checkDate)
            .execute('mp_GetUnitLineCombo');
        return result.recordset;
    }
}

export default new UserRightService();
