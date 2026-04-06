import { sql, poolPromise } from '../config/db.js';


/**
 * Service to execute the mp_UserInUnitAndGroupByEmployeeID stored procedure
 * @param empId Employee ID (e.g. 10471192)
 * @param roleId User Group No (e.g. 05)
 * @returns List of units/departments mapped to frontend structure ({ id, name, unitText })
 */
export const getUnitsByRoleService = async (empId: string, roleId: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        // Bind parameters matching the SP exactly: @EmployeeID, @UserGroupNo
        request.input('EmployeeID', empId);
        request.input('UserGroupNo', roleId);

        // Execute the SP
        const result = await request.execute('mp_UserInUnitAndGroupByEmployeeID');
        
        // Map the structure so Frontend can easily consume it in Select Dropdowns
        if (result && result.recordset) {
            return result.recordset.map(row => ({
                id: row.OrgUnitNo,
                name: row.UnitName,
                unitText: row.UnitText, // e.g. "OrgUnitNo UnitName (Abbr)"
                IsAssistant: row.IsAssistant ?? 0,
                IsUnder: row.IsUnder ?? 0,
                IsSecondment: row.IsSecondment ?? 0
            }));
        }
        
        return [];
    } catch (error) {
        console.error('Error executing mp_UserInUnitAndGroupByEmployeeID:', error);
        throw error;
    }
};

/**
 * Service to execute the mp_LevelGroupGetByUnit stored procedure
 * @param checkDate Effective Date or current Date
 * @param unit Unit Code (e.g. 80000032)
 * @param userGroupNo User Group No (e.g. '04')
 */
export const getLevelsByUnitService = async (checkDate: string, unit: string, userGroupNo: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        // Required parameters for mp_LevelGroupGetByUnit
        // declare @p_CheckDate as datetime = '20260301'
        // declare @p_Unit as varchar(8) = '80000032'
        // request.input('p_CheckDate', sql.DateTime, new Date(checkDate));
        
        // Convert 'YYYYMMDD01' format from frontend to valid 'YYYY-MM-DD' for Date constructor
        const year = checkDate.substring(0, 4);
        const month = checkDate.substring(4, 6);
        const day = checkDate.substring(6, 8);
        const formattedDate = `${year}-${month}-${day}`;

        request.input('p_CheckDate', sql.DateTime, new Date(formattedDate));
        request.input('p_Unit', sql.VarChar(8), unit);
        request.input('p_UserGroupNo', sql.VarChar(2), userGroupNo);

        const result = await request.execute('mp_LevelGroupGetByUnit');
        
        // Map the structure for Frontend
        if (result && result.recordset) {
            return result.recordset.map(row => ({
                id: row.LevelGroupNo,
                name: row.LevelGroupName,
                nameEN: row.LevelGroupNameEN,
                order: row.LevelGroupOrder,
                top: row.UnitLevelGroupTop
            }));
        }
        
        return [];
    } catch (error) {
        console.error('Error executing mp_LevelGroupGetByUnit:', error);
        throw error;
    }
};

/**
 * Service to execute the mp_UnitGetByEffectiveDate stored procedure
 * Returns all units active on a given effective date
 * @param effectiveDate Date in 'YYYY-MM-DD' format
 */
export const getAllUnitsByEffectiveDateService = async (effectiveDate: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('EffectiveDate', sql.DateTime, new Date(effectiveDate));

        const result = await request.execute('mp_UnitGetByEffectiveDate');

        if (result && result.recordset) {
            return result.recordset.map(row => ({
                id: row.OrgUnitNo,
                name: row.UnitName || row.OrgUnitNo,
                shortName: row.UnitAbbr || row.OrgUnitNo,
                parentOrgUnitNo: row.ParentOrgUnitNo || null,
                unitText: row.UnitText || `${row.OrgUnitNo} ${row.UnitName || ''}`.trim(),
                BGNo: row.BGNo ? String(row.BGNo).trim() : null,
                // Legacy support for frontend tree building
                OrgUnitNo: row.OrgUnitNo,
                UnitName: row.UnitName || row.OrgUnitNo,
                UnitAbbr: row.UnitAbbr || row.OrgUnitNo,
                ParentOrgUnitNo: row.ParentOrgUnitNo || null,
            }));
        }

        return [];
    } catch (error) {
        console.error('Error executing mp_UnitGetByEffectiveDate:', error);
        throw error;
    }
};
