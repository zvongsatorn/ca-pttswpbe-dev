import { sql, poolPromise } from '../config/db.js';

/**
 * Service to execute the mp_UserTracking stored procedure
 * @param effectiveDate Date string in 'YYYY-MM-DD' format
 * @param userGroupNo User Group No (e.g. '04')
 * @param employeeId Employee ID
 */
export const getTrackingUserLogService = async (effectiveDate: string, userGroupNo: string, employeeId: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('EffectiveDate', sql.DateTime, new Date(effectiveDate));
        request.input('UserGroupNo', sql.VarChar(2), userGroupNo);
        request.input('EmployeeID', sql.VarChar(10), employeeId);

        const result = await request.execute('mp_UserTracking');
        
        if (result && result.recordset) {
            return result.recordset;
        }
        
        return [];
    } catch (error) {
        console.error('Error executing mp_UserTracking:', error);
        throw error;
    }
};

/**
 * Service to execute the mp_UserTrackingUnit stored procedure
 * @param effectiveDate Date string in 'YYYY-MM-DD' format
 * @param userGroupNo User Group No (e.g. '04')
 * @param employeeId Employee ID
 */
export const getTrackingUnitLogService = async (effectiveDate: string, userGroupNo: string, employeeId: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('EffectiveDate', sql.DateTime, new Date(effectiveDate));
        request.input('UserGroupNo', sql.VarChar(2), userGroupNo);
        request.input('EmployeeID', sql.VarChar(10), employeeId);

        const result = await request.execute('mp_UserTrackingUnit');
        
        if (result && result.recordset) {
            return result.recordset;
        }
        
        return [];
    } catch (error) {
        console.error('Error executing mp_UserTrackingUnit:', error);
        throw error;
    }
};
