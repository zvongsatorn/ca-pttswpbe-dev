import { sql, poolPromise } from '../config/db.js';

const toSqlDateOnly = (value: Date | string): Date => {
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        const now = new Date();
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    }
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0));
};

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
        
        const monthNo = Number.parseInt(String(month), 10);
        const yearNo = Number.parseInt(String(year), 10);
        const checkDate = new Date(yearNo, monthNo - 1, 1, 0, 0, 0, 0);

        request.input('p_CheckDate', sql.Date, toSqlDateOnly(checkDate));
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
        
        const result = await request.execute('mp_InterfaceUnitSearch');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing searchUnitsService:', error);
        throw error;
    }
};
