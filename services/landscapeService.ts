import { sql, poolPromise } from '../config/db.js';

export interface LandscapePayload {
    orgUnitNo: string | null;
    beginDate: string;
    endDate: string;
    vp: number;
    dm: number;
    sr: number;
    jr: number;
}

export interface LandscapeRecord {
    OrgUnitNo: string | null;
    BeginDate: string;
    EndDate: string;
    vp: number;
    dm: number;
    sr: number;
    jr: number;
}

const mapLandscapeRow = (row: Record<string, unknown>): LandscapeRecord => ({
    OrgUnitNo: row.OrgUnitNo ? String(row.OrgUnitNo).trim() : null,
    BeginDate: String(row.BeginDate ?? ''),
    EndDate: String(row.EndDate ?? ''),
    vp: Number(row.vp ?? 0),
    dm: Number(row.dm ?? 0),
    sr: Number(row.sr ?? 0),
    jr: Number(row.jr ?? 0)
});

const bindLandscapePayload = (request: sql.Request, payload: LandscapePayload) => {
    request.input('OrgUnitNo', sql.VarChar(8), payload.orgUnitNo);
    request.input('BeginDate', sql.Date, payload.beginDate);
    request.input('EndDate', sql.Date, payload.endDate);
    request.input('vp', sql.Decimal(18, 2), payload.vp);
    request.input('dm', sql.Decimal(18, 2), payload.dm);
    request.input('sr', sql.Decimal(18, 2), payload.sr);
    request.input('jr', sql.Decimal(18, 2), payload.jr);
};

const bindOriginalLandscapePayload = (request: sql.Request, payload: LandscapePayload) => {
    request.input('OriginalOrgUnitNo', sql.VarChar(8), payload.orgUnitNo);
    request.input('OriginalBeginDate', sql.Date, payload.beginDate);
    request.input('OriginalEndDate', sql.Date, payload.endDate);
    request.input('OriginalVp', sql.Decimal(18, 2), payload.vp);
    request.input('OriginalDm', sql.Decimal(18, 2), payload.dm);
    request.input('OriginalSr', sql.Decimal(18, 2), payload.sr);
    request.input('OriginalJr', sql.Decimal(18, 2), payload.jr);
};

const bindPeriodPayload = (request: sql.Request, payload: LandscapePayload) => {
    request.input('OrgUnitNo', sql.VarChar(8), payload.orgUnitNo);
    request.input('BeginDate', sql.Date, payload.beginDate);
    request.input('EndDate', sql.Date, payload.endDate);
};

export const getLandscapeService = async (): Promise<LandscapeRecord[]> => {
    const pool = await poolPromise;
    const result = await pool.request().execute('MP_LandscapeList');

    return (result.recordset || []).map((row) => mapLandscapeRow(row as Record<string, unknown>));
};

export const insertLandscapeService = async (payload: LandscapePayload) => {
    const pool = await poolPromise;
    const request = pool.request();
    bindLandscapePayload(request, payload);

    await request.execute('MP_LandscapeInsert');

    return { success: true };
};

export const hasLandscapePeriodOverlapService = async (
    payload: LandscapePayload,
    original?: LandscapePayload
) => {
    const pool = await poolPromise;
    const request = pool.request();
    bindPeriodPayload(request, payload);

    if (original) {
        bindOriginalLandscapePayload(request, original);
        request.input('HasOriginal', sql.Bit, 1);
        const result = await request.execute('MP_LandscapePeriodOverlap');
        return (result.recordset?.length || 0) > 0;
    }

    request.input('HasOriginal', sql.Bit, 0);
    const result = await request.execute('MP_LandscapePeriodOverlap');

    return (result.recordset?.length || 0) > 0;
};

export const updateLandscapeService = async (original: LandscapePayload, next: LandscapePayload) => {
    const pool = await poolPromise;
    const request = pool.request();
    bindOriginalLandscapePayload(request, original);
    bindLandscapePayload(request, next);

    const result = await request
        .output('RowsAffected', sql.Int)
        .execute('MP_LandscapeUpdateOriginal');

    return Number(result.output.RowsAffected || 0) > 0;
};

export const deleteLandscapeService = async (original: LandscapePayload) => {
    const pool = await poolPromise;
    const request = pool.request();
    bindOriginalLandscapePayload(request, original);

    const result = await request
        .output('RowsAffected', sql.Int)
        .execute('MP_LandscapeDeleteOriginal');

    return Number(result.output.RowsAffected || 0) > 0;
};
