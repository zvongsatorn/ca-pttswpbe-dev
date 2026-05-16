import { sql, poolPromise } from '../config/db.js';
import {
    parseReport7FormulaConfig,
    report7FormulaConfig,
    type Report7FormulaConfig
} from '../config/report7FormulaConfig.js';

export const REPORT7_FORMULA_KEY = 'REPORT7_SHAPE_GAP';
export const DEFAULT_END_DATE = '9999-12-31';

export class LandscapeFormulaTableMissingError extends Error {
    constructor() {
        super('MP_LandscapeFormula table not found. Please run SQL migration first.');
        this.name = 'LandscapeFormulaTableMissingError';
    }
}

export interface LandscapeFormulaPayload {
    formulaKey: string;
    formulaName: string | null;
    beginDate: string;
    endDate: string;
    formulaJson: string;
    isActive: boolean;
}

export interface LandscapeFormulaRecord {
    LandscapeFormulaID: number;
    FormulaKey: string;
    FormulaName: string | null;
    BeginDate: string;
    EndDate: string;
    FormulaJson: string;
    IsActive: boolean;
    CreateBy: string | null;
    CreateDate: string | null;
    UpdateBy: string | null;
    UpdateDate: string | null;
}

const toBool = (value: unknown): boolean =>
    value === true || value === 1 || value === '1';

const mapFormulaRow = (row: Record<string, unknown>): LandscapeFormulaRecord => ({
    LandscapeFormulaID: Number(row.LandscapeFormulaID ?? 0),
    FormulaKey: String(row.FormulaKey ?? '').trim(),
    FormulaName: row.FormulaName ? String(row.FormulaName).trim() : null,
    BeginDate: String(row.BeginDate ?? ''),
    EndDate: String(row.EndDate ?? ''),
    FormulaJson: String(row.FormulaJson ?? '{}'),
    IsActive: toBool(row.IsActive),
    CreateBy: row.CreateBy ? String(row.CreateBy).trim() : null,
    CreateDate: row.CreateDate ? String(row.CreateDate) : null,
    UpdateBy: row.UpdateBy ? String(row.UpdateBy).trim() : null,
    UpdateDate: row.UpdateDate ? String(row.UpdateDate) : null
});

const ensureFormulaTableExists = async () => {
    const pool = await poolPromise;
    const result = await pool.request().execute('MP_LandscapeFormulaIsReady');
    const isReady = Number(result.recordset?.[0]?.IsReady ?? 0) === 1;
    if (!isReady) {
        throw new LandscapeFormulaTableMissingError();
    }
};

export const isLandscapeFormulaTableReadyService = async (): Promise<boolean> => {
    try {
        await ensureFormulaTableExists();
        return true;
    } catch (error) {
        if (error instanceof LandscapeFormulaTableMissingError) return false;
        throw error;
    }
};

const bindFormulaPayload = (request: sql.Request, payload: LandscapeFormulaPayload) => {
    request.input('FormulaKey', sql.VarChar(100), payload.formulaKey);
    request.input('FormulaName', sql.NVarChar(255), payload.formulaName);
    request.input('BeginDate', sql.Date, payload.beginDate);
    request.input('EndDate', sql.Date, payload.endDate);
    request.input('FormulaJson', sql.NVarChar(sql.MAX), payload.formulaJson);
    request.input('IsActive', sql.Bit, payload.isActive ? 1 : 0);
};

export const getLandscapeFormulaListService = async (): Promise<LandscapeFormulaRecord[]> => {
    await ensureFormulaTableExists();
    const pool = await poolPromise;
    const result = await pool.request().execute('MP_LandscapeFormulaList');

    return (result.recordset || []).map((item) => mapFormulaRow(item as Record<string, unknown>));
};

export const hasLandscapeFormulaPeriodOverlapService = async (
    payload: LandscapeFormulaPayload,
    excludeFormulaId?: number
): Promise<boolean> => {
    await ensureFormulaTableExists();
    if (!payload.isActive) return false;

    const pool = await poolPromise;
    const request = pool.request();
    request.input('FormulaKey', sql.VarChar(100), payload.formulaKey);
    request.input('BeginDate', sql.Date, payload.beginDate);
    request.input('EndDate', sql.Date, payload.endDate);

    if (typeof excludeFormulaId === 'number' && Number.isFinite(excludeFormulaId)) {
        request.input('ExcludeFormulaId', sql.BigInt, Math.trunc(excludeFormulaId));
        const result = await request.execute('MP_LandscapeFormulaPeriodOverlap');
        return (result.recordset?.length || 0) > 0;
    }

    request.input('ExcludeFormulaId', sql.BigInt, null);
    const result = await request.execute('MP_LandscapeFormulaPeriodOverlap');
    return (result.recordset?.length || 0) > 0;
};

export const insertLandscapeFormulaService = async (
    payload: LandscapeFormulaPayload,
    createBy: string
) => {
    await ensureFormulaTableExists();
    const pool = await poolPromise;
    const request = pool.request();
    bindFormulaPayload(request, payload);
    request.input('CreateBy', sql.VarChar(32), createBy);

    await request.execute('MP_LandscapeFormulaInsert');

    return { success: true };
};

export const updateLandscapeFormulaService = async (
    formulaId: number,
    payload: LandscapeFormulaPayload,
    updateBy: string
): Promise<boolean> => {
    await ensureFormulaTableExists();
    const pool = await poolPromise;
    const request = pool.request();
    request.input('LandscapeFormulaID', sql.BigInt, Math.trunc(formulaId));
    bindFormulaPayload(request, payload);
    request.input('UpdateBy', sql.VarChar(32), updateBy);

    const result = await request
        .output('RowsAffected', sql.Int)
        .execute('MP_LandscapeFormulaUpdate');

    return Number(result.output.RowsAffected || 0) > 0;
};

export const deleteLandscapeFormulaService = async (formulaId: number): Promise<boolean> => {
    await ensureFormulaTableExists();
    const pool = await poolPromise;
    const request = pool.request();
    request.input('LandscapeFormulaID', sql.BigInt, Math.trunc(formulaId));

    const result = await request
        .output('RowsAffected', sql.Int)
        .execute('MP_LandscapeFormulaDelete');

    return Number(result.output.RowsAffected || 0) > 0;
};

export const parseLandscapeFormulaJson = (formulaJson: string): Report7FormulaConfig | null => {
    try {
        const parsed = JSON.parse(formulaJson);
        return parseReport7FormulaConfig(parsed);
    } catch {
        return null;
    }
};

export const getReport7FormulaConfigByEffectiveDateService = async (
    effectiveDateStr: string
): Promise<Report7FormulaConfig | null> => {
    let parsedDate = effectiveDateStr;
    if (!parsedDate || Number.isNaN(new Date(parsedDate).getTime())) {
        parsedDate = new Date().toISOString().slice(0, 10);
    }

    try {
        await ensureFormulaTableExists();
    } catch (error) {
        if (error instanceof LandscapeFormulaTableMissingError) return null;
        throw error;
    }

    const pool = await poolPromise;
    const request = pool.request();
    request.input('FormulaKey', sql.VarChar(100), REPORT7_FORMULA_KEY);
    request.input('EffectiveDate', sql.Date, parsedDate);

    const result = await request.execute('MP_Report7FormulaByEffectiveDate');

    const formulaJson = String(result.recordset?.[0]?.FormulaJson || '').trim();
    if (!formulaJson) return null;

    const parsed = parseLandscapeFormulaJson(formulaJson);
    return parsed || null;
};

export const getReport7DefaultFormulaConfigService = () => report7FormulaConfig;
