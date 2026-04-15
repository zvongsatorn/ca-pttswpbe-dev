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

const targetWhereClause = `
    (
        (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') IS NULL AND @OriginalOrgUnitNo IS NULL)
        OR (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') = @OriginalOrgUnitNo)
    )
    AND [BeginDate] = @OriginalBeginDate
    AND [EndDate] = @OriginalEndDate
    AND CAST(vp AS decimal(18,2)) = @OriginalVp
    AND CAST(dm AS decimal(18,2)) = @OriginalDm
    AND CAST(sr AS decimal(18,2)) = @OriginalSr
    AND CAST(jr AS decimal(18,2)) = @OriginalJr
`;

const sameOrgClause = `
    (
        (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') IS NULL AND @OrgUnitNo IS NULL)
        OR (NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') = @OrgUnitNo)
    )
`;

export const getLandscapeService = async (): Promise<LandscapeRecord[]> => {
    const pool = await poolPromise;
    const result = await pool.request().query(`
        SELECT
            NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') AS OrgUnitNo,
            CONVERT(varchar(10), [BeginDate], 23) AS BeginDate,
            CONVERT(varchar(10), [EndDate], 23) AS EndDate,
            CAST(vp AS decimal(18,2)) AS vp,
            CAST(dm AS decimal(18,2)) AS dm,
            CAST(sr AS decimal(18,2)) AS sr,
            CAST(jr AS decimal(18,2)) AS jr
        FROM MP_Landscape
        ORDER BY
            CASE WHEN NULLIF(LTRIM(RTRIM(OrgUnitNo)), '') IS NULL THEN 0 ELSE 1 END,
            NULLIF(LTRIM(RTRIM(OrgUnitNo)), ''),
            [BeginDate] DESC,
            [EndDate] DESC
    `);

    return (result.recordset || []).map((row) => mapLandscapeRow(row as Record<string, unknown>));
};

export const insertLandscapeService = async (payload: LandscapePayload) => {
    const pool = await poolPromise;
    const request = pool.request();
    bindLandscapePayload(request, payload);

    await request.query(`
        INSERT INTO MP_Landscape (
            OrgUnitNo,
            [BeginDate],
            [EndDate],
            vp,
            dm,
            sr,
            jr
        )
        VALUES (
            @OrgUnitNo,
            @BeginDate,
            @EndDate,
            @vp,
            @dm,
            @sr,
            @jr
        )
    `);

    return { success: true };
};

export const hasLandscapePeriodOverlapService = async (
    payload: LandscapePayload,
    original?: LandscapePayload
) => {
    const pool = await poolPromise;
    const request = pool.request();
    bindPeriodPayload(request, payload);

    let excludeClause = '';
    if (original) {
        bindOriginalLandscapePayload(request, original);
        excludeClause = `
            AND NOT (
                ${targetWhereClause}
            )
        `;
    }

    const result = await request.query(`
        SELECT TOP (1) 1 AS HasOverlap
        FROM MP_Landscape
        WHERE
            ${sameOrgClause}
            AND [BeginDate] <= @EndDate
            AND [EndDate] >= @BeginDate
            ${excludeClause}
    `);

    return (result.recordset?.length || 0) > 0;
};

export const updateLandscapeService = async (original: LandscapePayload, next: LandscapePayload) => {
    const pool = await poolPromise;
    const request = pool.request();
    bindOriginalLandscapePayload(request, original);
    bindLandscapePayload(request, next);

    const result = await request.query(`
        ;WITH target AS (
            SELECT TOP (1) *
            FROM MP_Landscape
            WHERE ${targetWhereClause}
            ORDER BY [BeginDate] DESC, [EndDate] DESC
        )
        UPDATE target
        SET
            OrgUnitNo = @OrgUnitNo,
            [BeginDate] = @BeginDate,
            [EndDate] = @EndDate,
            vp = @vp,
            dm = @dm,
            sr = @sr,
            jr = @jr
    `);

    return (result.rowsAffected?.[0] || 0) > 0;
};

export const deleteLandscapeService = async (original: LandscapePayload) => {
    const pool = await poolPromise;
    const request = pool.request();
    bindOriginalLandscapePayload(request, original);

    const result = await request.query(`
        ;WITH target AS (
            SELECT TOP (1) *
            FROM MP_Landscape
            WHERE ${targetWhereClause}
            ORDER BY [BeginDate] DESC, [EndDate] DESC
        )
        DELETE FROM target
    `);

    return (result.rowsAffected?.[0] || 0) > 0;
};
