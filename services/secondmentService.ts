import { sql, poolPromise } from '../config/db.js';

export const getSecondmentPoolsService = async (orgUnitNo: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('OrgUnitNo', sql.VarChar(50), orgUnitNo);
        const result = await request.execute('mp_SecmentpoolsetupGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_SecmentpoolsetupGet:', error);
        throw error;
    }
};

export const insertSecondmentPoolService = async (params: {
    orgUnitNo: string;
    parentOrgUnitNo: string;
    createBy: string;
}) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('OrgUnitNo', sql.VarChar(50), params.orgUnitNo);
        request.input('ParentOrgUnitNo', sql.VarChar(50), params.parentOrgUnitNo);
        request.input('CreateBy', sql.VarChar(50), params.createBy);
        request.input('CreateDate', sql.DateTime, new Date());
        
        await request.execute('mp_SecMentInsert');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_SecMentInsert:', error);
        throw error;
    }
};

export const updateSecondmentPoolService = async (params: {
    orgUnitNo: string;
    parentOrgUnitNo: string;
    updateBy: string;
}) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('OrgUnitNo', sql.VarChar(50), params.orgUnitNo);
        request.input('ParentOrgUnitNo', sql.VarChar(50), params.parentOrgUnitNo);
        request.input('UpdateBy', sql.VarChar(50), params.updateBy);
        request.input('UpdateDate', sql.DateTime, new Date());

        await request.execute('mp_SecMentUpdate');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_SecMentUpdate:', error);
        throw error;
    }
};

export const getParentUnitsService = async () => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('mp_SecmentpoolOrgGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_SecmentpoolOrgGet:', error);
        throw error;
    }
};

export const getUnitComboService = async (month: string | number, year: string | number) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        
        // Match legacy parsing: dd/MM/yyyy with 01 as day
        const m = String(month).padStart(2, '0');
        const checkDate = new Date(`${year}-${m}-01`);

        request.input('p_CheckDate', sql.DateTime, checkDate);
        const result = await request.execute('mp_UnitGetByEffectivePeriod');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_UnitGetByEffectivePeriod:', error);
        throw error;
    }
};

export const searchUnitsService = async (keyword: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('Keyword', sql.NVarChar(200), `%${keyword}%`);
        
        const query = `
            SELECT TOP 100 
                OrgUnitNo, 
                OrgUnitNo + '  ' + UnitName + ' (' + UnitAbbr + ')' as UnitText
            FROM InterfaceUnit
            WHERE (OrgUnitNo LIKE @Keyword OR UnitName LIKE @Keyword OR UnitAbbr LIKE @Keyword)
            AND GETDATE() BETWEEN BeginDate AND EndDate
            ORDER BY OrgUnitNo
        `;
        
        const result = await request.query(query);
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing searchUnitsService:', error);
        throw error;
    }
};
