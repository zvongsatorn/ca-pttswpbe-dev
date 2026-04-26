import { sql, poolPromise } from '../config/db.js';

const toSqlDateOnly = (value: Date | string): Date => {
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        const now = new Date();
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    }
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0));
};

const getMonthStartDate = (value = new Date()): Date =>
    new Date(value.getFullYear(), value.getMonth(), 1);

const formatCompactDate = (value: Date): string => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
};

class UserRightService {
    // 1. mp_OrgUnitInGroupGet (Reconstructed logic)
    async getOrgUnitInGroup(userGroupNo: string) {
        const pool = await poolPromise;
        try {
            // Use SP for dynamic filter (pass NULL for 'all')
            const request = pool.request();
            request.input('UserGroupNo', sql.NVarChar, userGroupNo !== 'all' ? userGroupNo : null);
            const result = await request.execute('mp_OrgUnitInGroupGet');
            
            // Group by OrgUnitID and dedupe users by EmployeeID (case-insensitive).
            const groupedMap = new Map<string, { OrgUnitID: string; users: { EmployeeID: string; NameAll: string }[] }>();
            const userIdSets = new Map<string, Set<string>>();

            for (const current of result.recordset || []) {
                const orgUnitId = String(current?.OrgUnitID ?? '').trim();
                if (!orgUnitId) continue;

                if (!groupedMap.has(orgUnitId)) {
                    groupedMap.set(orgUnitId, { OrgUnitID: orgUnitId, users: [] });
                    userIdSets.set(orgUnitId, new Set<string>());
                }

                const rawEmployeeId = String(current?.EmployeeID ?? '').trim();
                if (!rawEmployeeId) continue;

                const employeeKey = rawEmployeeId.toLowerCase();
                const set = userIdSets.get(orgUnitId)!;
                if (set.has(employeeKey)) continue;

                set.add(employeeKey);
                groupedMap.get(orgUnitId)!.users.push({
                    EmployeeID: rawEmployeeId,
                    NameAll: String(current?.NameAll ?? rawEmployeeId)
                });
            }

            return Array.from(groupedMap.values());
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
            .input('BeginDate', sql.Date, toSqlDateOnly(getMonthStartDate()))
            .input('EndDate', sql.Date, toSqlDateOnly(new Date('9999-12-31')))
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
            .input('EndDate', sql.Date, toSqlDateOnly(yesterday))
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
            .input('EndDate', sql.Date, toSqlDateOnly(yesterday))
            .input('UpdateBy', sql.NVarChar, updateBy)
            .input('UpdateDate', sql.DateTime, new Date())
            .execute('mp_UserInOrgUnitUpdateAll');
        
        return { success: true };
    }

    // Advanced Inserts
    async addUserInAllUnit(userGroupNo: string, employeeId: string, createBy: string) {
        const pool = await poolPromise;
        const now = new Date();
        const bdate = formatCompactDate(getMonthStartDate(now));
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
        const bdate = formatCompactDate(getMonthStartDate(now));
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
        const bdate = formatCompactDate(getMonthStartDate(now));
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
            .input('p_CheckDate', sql.Date, toSqlDateOnly(checkDate))
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
            .input('p_CheckDate', sql.Date, toSqlDateOnly(checkDate))
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
            .input('EffectiveDate', sql.Date, toSqlDateOnly(checkDate))
            .execute('mp_GetUnitLineCombo');
        return result.recordset;
    }
}

export default new UserRightService();
