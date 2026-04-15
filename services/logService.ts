import { poolPromise, sql } from '../config/db.js';

export interface InsertLogActionParams {
    employeeId: string;
    actionId: number;
    subjectId?: number | null;
    userRole?: string | null;
    note?: string | null;
    adminFlag?: number | null;
}

const executeLogActionProcedure = async (
    procedureName: string,
    fromDate: Date,
    toDate: Date
): Promise<Record<string, unknown>[]> => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('FromDate', sql.DateTime, fromDate);
        request.input('ToDate', sql.DateTime, toDate);

        const result = await request.execute(procedureName);
        return result.recordset || [];
    } catch (error) {
        console.error(`Error executing ${procedureName}:`, error);
        throw error;
    }
};

export const getLogActionService = async (fromDate: Date, toDate: Date): Promise<Record<string, unknown>[]> => {
    return executeLogActionProcedure('mp_LogActionUserGet', fromDate, toDate);
};

export const exportLogActionService = async (fromDate: Date, toDate: Date): Promise<Record<string, unknown>[]> => {
    return executeLogActionProcedure('mp_LogActionExportExcel', fromDate, toDate);
};

export const getMenuNameByIdService = async (menuId: number): Promise<string | null> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('MenuID', sql.Int, menuId);

    const result = await request.query(`
        SELECT TOP 1 MenuName
        FROM dbo.MP_Menu
        WHERE MenuID = @MenuID
    `);

    const menuName = result.recordset?.[0]?.MenuName;
    if (menuName === null || menuName === undefined) return null;
    return String(menuName).trim();
};

export const insertLogActionService = async (params: InsertLogActionParams): Promise<void> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);

    const normalizedSubjectId = Number.isFinite(params.subjectId) ? Number(params.subjectId) : 0;
    const normalizedRole = String(params.userRole || '').trim();
    const normalizedNote = String(params.note || '').trim();
    const normalizedAdminFlag = Number.isFinite(params.adminFlag) ? Number(params.adminFlag) : 0;

    request.input('EmployeeID', sql.NVarChar(50), params.employeeId);
    request.input('ActionID', sql.Int, params.actionId);
    request.input('SubjectID', sql.Int, normalizedSubjectId);
    request.input('UserRole', sql.NVarChar(50), normalizedRole);
    request.input('Note', sql.NVarChar(sql.MAX), normalizedNote);
    request.input('AdminFlag', sql.Int, normalizedAdminFlag);

    await request.execute('mp_LogActionUserInsert');
};
