import { poolPromise, sql } from '../config/db.js';

export interface CostPayload {
    orgUnitNo: string;
    levelGroupNo: string;
    effectiveDate: string;
    cost: number;
    note?: string;
}

export interface CostRecord {
    OrgUnitNo: string;
    LevelGroupNo: string;
    EffectiveDate: string;
    Note?: string;
    Cost: number;
    LevelGroupName?: string;
}

export interface LevelGroupOption {
    LevelGroupNo: string;
    LevelGroupName: string;
    LevelGroupOrder: number | null;
}

const BASE_TEMPLATE_HEADERS = ['OrgUnitNo', 'LevelGroupNo', 'EffectiveDate'];

const toDateString = (value: unknown): string => {
    if (!value) return '';

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
};

const toText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
};

const toNumber = (value: unknown): number => {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const mapCostRow = (row: Record<string, unknown>): CostRecord => ({
    OrgUnitNo: toText(row.OrgUnitNo ?? row.org_unit_no),
    LevelGroupNo: toText(row.LevelGroupNo ?? row.level_group_no),
    EffectiveDate: toDateString(row.EffectiveDate ?? row.effective_date),
    Note: toText(row.Note ?? row.note),
    Cost: Number(toNumber(row.Cost ?? row.cost)),
    LevelGroupName: toText(row.LevelGroupName ?? row.level_group_name)
});

const getLevelGroupNameMap = async (
    pool: sql.ConnectionPool,
    levelGroupNos: string[]
): Promise<Map<string, string>> => {
    const uniqueLevels = Array.from(new Set(levelGroupNos.map((lv) => toText(lv)).filter(Boolean)));
    const resultMap = new Map<string, string>();

    await Promise.all(
        uniqueLevels.map(async (levelGroupNo) => {
            try {
                const response = await pool.request()
                    .input('LevelGroupNo', sql.VarChar(20), levelGroupNo)
                    .execute('mp_LevelGroupGetByNo');

                const first = Array.isArray(response.recordset) ? response.recordset[0] as Record<string, unknown> : null;
                const levelName = first ? toText(first.LevelGroupName ?? first.levelGroupName) : '';
                resultMap.set(levelGroupNo, levelName || levelGroupNo);
            } catch (error) {
                console.error(`Failed to resolve level name for ${levelGroupNo}:`, error);
                resultMap.set(levelGroupNo, levelGroupNo);
            }
        })
    );

    return resultMap;
};

const bindCostPayload = (
    request: sql.Request,
    payload: CostPayload,
    keyPrefix = ''
): sql.Request => request
    .input(`${keyPrefix}OrgUnitNo`, sql.NVarChar(32), payload.orgUnitNo)
    .input(`${keyPrefix}LevelGroupNo`, sql.NVarChar(16), payload.levelGroupNo)
    .input(`${keyPrefix}EffectiveDate`, sql.Date, payload.effectiveDate)
    .input(`${keyPrefix}Note`, sql.NVarChar(200), toText(payload.note))
    .input(`${keyPrefix}Cost`, sql.Decimal(18, 4), payload.cost);

const executeCostUpsert = async (
    pool: sql.ConnectionPool,
    payload: CostPayload
): Promise<'inserted' | 'updated'> => {
    const result = await bindCostPayload(pool.request(), payload)
        .output('Action', sql.NVarChar(16))
        .execute('MP_CostRecordUpsert');

    return result.output.Action === 'updated' ? 'updated' : 'inserted';
};

export const getCostRecordsService = async (fromDate: string, toDate: string): Promise<CostRecord[]> => {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('FromDate', sql.Date, fromDate)
        .input('ToDate', sql.Date, toDate)
        .execute('MP_CostRecordList');

    const rows = Array.isArray(result.recordset)
        ? (result.recordset as Array<Record<string, unknown>>)
        : [];

    const mappedRows = rows.map(mapCostRow);
    const levelNameMap = await getLevelGroupNameMap(pool, mappedRows.map((row) => row.LevelGroupNo));

    return mappedRows.map((row) => ({
        ...row,
        LevelGroupName: levelNameMap.get(row.LevelGroupNo) || row.LevelGroupNo
    }));
};

export const upsertCostRecordService = async (payload: CostPayload): Promise<'inserted' | 'updated'> => {
    const pool = await poolPromise;
    return executeCostUpsert(pool, payload);
};

export const importCostRowsService = async (
    rows: CostPayload[]
): Promise<{ inserted: number; updated: number; total: number }> => {
    const pool = await poolPromise;

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
        const action = await executeCostUpsert(pool, row);
        if (action === 'inserted') inserted += 1;
        if (action === 'updated') updated += 1;
    }

    return {
        inserted,
        updated,
        total: rows.length
    };
};

export const updateCostRecordService = async (
    original: CostPayload,
    next: CostPayload
): Promise<boolean> => {
    const pool = await poolPromise;
    const result = await bindCostPayload(
        bindCostPayload(pool.request(), original, 'Original'),
        next,
        'Next'
    )
        .output('RowsAffected', sql.Int)
        .execute('MP_CostRecordUpdateOriginal');

    return Number(result.output.RowsAffected || 0) > 0;
};

export const deleteCostRecordService = async (original: CostPayload): Promise<boolean> => {
    const pool = await poolPromise;
    const result = await bindCostPayload(pool.request(), original, 'Original')
        .output('RowsAffected', sql.Int)
        .execute('MP_CostRecordDeleteOriginal');

    return Number(result.output.RowsAffected || 0) > 0;
};

export const getCostTemplateMetaService = async (): Promise<{
    headers: string[];
    table: string;
    mappings: Record<string, string | null>;
}> => {
    const headers = [...BASE_TEMPLATE_HEADERS];
    headers.push('Note', 'Cost');

    return {
        headers,
        table: 'dbo.MP_CostEmployee',
        mappings: {
            OrgUnitNo: 'OrgUnitNo',
            LevelGroupNo: 'LevelGroupNo',
            EffectiveDate: 'EffectiveDate',
            Note: 'Note',
            Cost: 'TotalCost'
        }
    };
};

export const exportCostRecordsService = async (fromDate: string, toDate: string): Promise<CostRecord[]> => {
    return getCostRecordsService(fromDate, toDate);
};

export const getCostLevelGroupsService = async (effectiveDate: string): Promise<LevelGroupOption[]> => {
    const pool = await poolPromise;
    const request = pool.request();

    request.input('EffectiveDate', sql.Date, effectiveDate);

    const result = await request.execute('MP_CostLevelGroupOptions');

    const rows = Array.isArray(result.recordset)
        ? (result.recordset as Array<Record<string, unknown>>)
        : [];

    return rows
        .map((row) => ({
            LevelGroupNo: toText(row.LevelGroupNo),
            LevelGroupName: toText(row.LevelGroupName),
            LevelGroupOrder: row.LevelGroupOrder === null || row.LevelGroupOrder === undefined
                ? null
                : Number(row.LevelGroupOrder)
        }))
        .filter((row) => row.LevelGroupNo && row.LevelGroupName);
};
