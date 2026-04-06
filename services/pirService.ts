import { sql, poolPromise } from '../config/db.js';

export const getPIRService = async (effectiveYear: string, orgUnitNo: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('EffectiveYear', sql.VarChar, effectiveYear || null);
        request.input('OrgUnitNo', sql.VarChar, orgUnitNo || null);
        const result = await request.execute('mp_ImproveRateGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_ImproveRateGet:', error);
        throw error;
    }
};

export const insertPIRService = async (
    effectiveYear: string,
    year: string,
    rate: number,
    orgUnitNo: string,
    createBy: string,
    isImport: number = 0
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('EffectiveYear', sql.VarChar, effectiveYear);
        request.input('Year', sql.VarChar, year);
        request.input('Rate', sql.Decimal(18, 2), rate);
        request.input('OrgUnitNo', sql.VarChar, orgUnitNo || null);
        request.input('CreateBy', sql.VarChar, createBy || 'SYSTEM');
        request.input('CreateDate', sql.DateTime, new Date());
        request.input('Import', sql.Int, isImport);
        
        const result = await request.execute('mp_ImproveRateInsert');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_ImproveRateInsert:', error);
        throw error;
    }
};

export const deletePIRService = async (improveRateID: string | number, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ImproveRateID', sql.Decimal, improveRateID);
        request.input('UpdateBy', sql.VarChar, updateBy || 'SYSTEM');
        request.input('UpdateDate', sql.DateTime, new Date());
        
        await request.execute('mp_ImproveRateUpdate');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_ImproveRateUpdate:', error);
        throw error;
    }
};

export const copyPIRService = async (effectiveYear: string, orgUnitNo: string, createBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('OrgUnitNo', sql.VarChar, orgUnitNo || null);
        request.input('EffectiveYear', sql.VarChar, effectiveYear);
        request.input('CreateBy', sql.VarChar, createBy || 'SYSTEM');
        request.input('CreateDate', sql.DateTime, new Date());
        
        // This copies from previous year
        await request.execute('mp_ImproveRateInsertYear');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_ImproveRateInsertYear:', error);
        throw error;
    }
};

export const getPIROrgService = async (effectiveYear: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('EffectiveYear', sql.VarChar, effectiveYear);
        
        const result = await request.execute('mp_ImproveRateOrgGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_ImproveRateOrgGet:', error);
        throw error;
    }
};

// --- FILE ATTACH ---
export const getFileAttachService = async (effectiveYear: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('EffectiveYear', sql.VarChar, effectiveYear);
        
        const result = await request.execute('mp_ImproveRateUploadget');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_ImproveRateUploadget:', error);
        throw error;
    }
};

export const insertFileAttachService = async (effYear: string, fileName: string, fileUpload: string, createBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('EffectiveYear', sql.VarChar, effYear);
        request.input('FileName', sql.VarChar, fileName);
        request.input('FileUpload', sql.VarChar, fileUpload);
        request.input('CreateBy', sql.VarChar, createBy || 'SYSTEM');
        
        await request.execute('mp_ImproveRatefilesInsert');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_ImproveRatefilesInsert:', error);
        throw error;
    }
};

export const deleteFileAttachService = async (improveRateUploadID: string | number, fileUpload: string, effYear: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ImproveRateUploadID', sql.Decimal, improveRateUploadID);
        request.input('FileUpload', sql.VarChar, fileUpload || null);
        request.input('EffectiveYear', sql.VarChar, effYear || null);
        
        await request.execute('mp_ImproveRatefilesDelete');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_ImproveRatefilesDelete:', error);
        throw error;
    }
};

// --- REMARK ---
export const getRemarkService = async (effectiveYear: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('EffectiveYear', sql.VarChar, effectiveYear);
        
        const result = await request.execute('mp_ImproveRateRemarkGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_ImproveRateRemarkGet:', error);
        throw error;
    }
};

export const insertRemarkService = async (effYear: string, remark: string, createBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('EffectiveYear', sql.VarChar, effYear);
        request.input('Remark', sql.VarChar(300), remark);
        request.input('CreateBy', sql.VarChar, createBy || 'SYSTEM');
        
        await request.execute('mp_ImproveRateRemarkInsert');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_ImproveRateRemarkInsert:', error);
        throw error;
    }
};

export const deleteRemarkService = async (improveRateRemarkID: string | number, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('ImproveRateRemarkID', sql.Decimal, improveRateRemarkID);
        request.input('UpdateBy', sql.VarChar, updateBy || 'SYSTEM');
        
        await request.execute('mp_ImproveRateRemarkDelete');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_ImproveRateRemarkDelete:', error);
        throw error;
    }
};

// --- EXPORT ---
export const getExportExcelService = async (
    effectiveDateStr: string,
    userGroupNo: string,
    employeeId: string,
    effectiveYear: string,
    bgNo: string,
    divisionNo: string,
    orgUnitNo: string
) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        // --- NEW: Auto-resolve to latest available date if specific date is empty ---
        const dateCheck = await pool.request().query(`SELECT TOP 1 EffectiveDate FROM MP_QuotaN WHERE EffectiveDate <= '${effectiveDateStr}' ORDER BY EffectiveDate DESC`);
        let finalDate = effectiveDateStr;
        if (dateCheck.recordset.length > 0) {
            finalDate = new Date(dateCheck.recordset[0].EffectiveDate).toISOString().split('T')[0];
            console.log(`Auto-resolved EffectiveDate from ${effectiveDateStr} to ${finalDate}`);
        }

        request.input('Effectivedate', sql.Date, finalDate);
        request.input('UserGroupNo', sql.VarChar, userGroupNo || null);
        request.input('EmployeeID', sql.VarChar, employeeId || null);
        request.input('EffectiveYear', sql.Int, parseInt(effectiveYear) || null);
        request.input('BGNo', sql.VarChar, bgNo || null);
        request.input('DivisionNo', sql.VarChar, divisionNo || null);
        request.input('OrgUnitNo', sql.VarChar, orgUnitNo || null);
        
        const result = await request.execute('mp_ImproveRateExportExcel');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_ImproveRateExportExcel:', error);
        throw error;
    }
};
