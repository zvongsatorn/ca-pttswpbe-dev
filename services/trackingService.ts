import { sql, poolPromise } from '../config/db.js';

/**
 * Service to execute the mp_UserTracking stored procedure
 * @param effectiveDate Date value
 * @param userGroupNo User Group No (e.g. '04')
 * @param employeeId Employee ID
 */
export const getTrackingUserLogService = async (effectiveDate: Date, userGroupNo: string, employeeId: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        (request as sql.Request & { timeout: number }).timeout = 5 * 60 * 1000;
        request.input('EffectiveDate', sql.DateTime, effectiveDate);
        request.input('UserGroupNo', sql.VarChar(2), userGroupNo);
        request.input('EmployeeID', sql.VarChar(20), employeeId);

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
 * @param effectiveDate Date value
 * @param userGroupNo User Group No (e.g. '04')
 * @param employeeId Employee ID
 */
export const getTrackingUnitLogService = async (effectiveDate: Date, userGroupNo: string, employeeId: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        (request as sql.Request & { timeout: number }).timeout = 5 * 60 * 1000;
        request.input('EffectiveDate', sql.DateTime, effectiveDate);
        request.input('UserGroupNo', sql.VarChar(2), userGroupNo);
        request.input('EmployeeID', sql.VarChar(20), employeeId);

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
