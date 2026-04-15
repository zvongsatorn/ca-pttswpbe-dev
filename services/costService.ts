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

type TableMeta = {
    schemaName: string;
    tableName: string;
    fullName: string;
    objectName: string;
    columns: Map<string, string>;
};

type ResolvedCostTable = TableMeta & {
    orgCol: string;
    levelCol: string;
    amountCol: string;
    noteCol: string | null;
    effectiveDateCol: string | null;
    beginDateCol: string | null;
    endDateCol: string | null;
};

const COST_TABLE_CANDIDATES = ['MP_CostEmployee', 'MP_CostEmp', 'CostEmployee'];
const ORG_COL_CANDIDATES = ['OrgUnitID', 'OrgUnitId', 'OrgUnitNo', 'OrgUnitNO', 'OrgUnit', 'UnitNo', 'UnitCode', 'OrgNo'];
const LEVEL_COL_CANDIDATES = ['LevelGroupNo', 'LevelGroupNO', 'LevelNo', 'GroupNo', 'PositionLevel'];
const EFFECTIVE_COL_CANDIDATES = ['EffectiveDate', 'CheckDate', 'DataDate', 'MonthDate', 'TranDate'];
const BEGIN_COL_CANDIDATES = ['BeginDate', 'StartDate', 'FromDate', 'EffectiveStartDate'];
const END_COL_CANDIDATES = ['EndDate', 'ToDate', 'EffectiveEndDate'];
const COST_COL_CANDIDATES = ['CostEmployee', 'CostAmount', 'Amount', 'BudgetAmount', 'ExpenseAmount', 'TotalAmount', 'TotalCost', 'Cost', 'Value'];
const NOTE_COL_CANDIDATES = ['Note', 'Remark', 'Description', 'Memo'];

const BASE_TEMPLATE_HEADERS = ['OrgUnitNo', 'LevelGroupNo', 'EffectiveDate'];

const escapeSqlString = (value: string): string => value.replace(/'/g, "''");
const escapeSqlIdentifier = (value: string): string => `[${value.replace(/]/g, ']]')}]`;

const pickColumnName = (columns: Map<string, string>, candidates: string[]): string | null => {
    for (const candidate of candidates) {
        const found = columns.get(candidate.toLowerCase());
        if (found) return found;
    }
    return null;
};

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

const getTableMeta = async (
    pool: sql.ConnectionPool,
    tableCandidates: string[]
): Promise<TableMeta | null> => {
    if (!tableCandidates.length) return null;

    const inList = tableCandidates.map((name) => `'${escapeSqlString(name.toLowerCase())}'`).join(',');
    const tableRes = await pool.request().query(`
        SELECT s.name AS schema_name, t.name AS table_name
        FROM sys.tables t
        INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE LOWER(t.name) IN (${inList})
    `);

    const rows = Array.isArray(tableRes.recordset)
        ? (tableRes.recordset as Array<Record<string, unknown>>)
        : [];

    if (!rows.length) return null;

    let selected: Record<string, unknown> | null = null;
    for (const candidate of tableCandidates) {
        selected = rows.find((row) => toText(row.table_name).toLowerCase() === candidate.toLowerCase()) || null;
        if (selected) break;
    }
    if (!selected) selected = rows[0];

    const schemaName = toText(selected.schema_name);
    const tableName = toText(selected.table_name);
    if (!schemaName || !tableName) return null;

    const objectName = `${schemaName}.${tableName}`;
    const columnsRes = await pool.request()
        .input('objectName', sql.NVarChar(300), objectName)
        .query(`
            SELECT c.name
            FROM sys.columns c
            WHERE c.object_id = OBJECT_ID(@objectName)
        `);

    const columnRows = Array.isArray(columnsRes.recordset)
        ? (columnsRes.recordset as Array<Record<string, unknown>>)
        : [];

    const columns = new Map<string, string>();
    columnRows.forEach((row) => {
        const colName = toText(row.name);
        if (!colName) return;
        columns.set(colName.toLowerCase(), colName);
    });

    return {
        schemaName,
        tableName,
        objectName,
        fullName: `${escapeSqlIdentifier(schemaName)}.${escapeSqlIdentifier(tableName)}`,
        columns
    };
};

const resolveCostTable = async (pool: sql.ConnectionPool): Promise<ResolvedCostTable> => {
    const tableMeta = await getTableMeta(pool, COST_TABLE_CANDIDATES);
    if (!tableMeta) {
        throw new Error('ไม่พบตาราง Cost (MP_CostEmployee/MP_CostEmp/CostEmployee)');
    }

    const orgCol = pickColumnName(tableMeta.columns, ORG_COL_CANDIDATES);
    const levelCol = pickColumnName(tableMeta.columns, LEVEL_COL_CANDIDATES);
    const amountCol = pickColumnName(tableMeta.columns, COST_COL_CANDIDATES);
    const noteCol = pickColumnName(tableMeta.columns, NOTE_COL_CANDIDATES);
    const effectiveDateCol = pickColumnName(tableMeta.columns, EFFECTIVE_COL_CANDIDATES);
    const beginDateCol = pickColumnName(tableMeta.columns, BEGIN_COL_CANDIDATES);
    const endDateCol = pickColumnName(tableMeta.columns, END_COL_CANDIDATES);

    if (!orgCol || !levelCol || !amountCol) {
        throw new Error('ไม่พบคอลัมน์หลักของ Cost (OrgUnitNo/LevelGroupNo/Cost)');
    }

    if (!effectiveDateCol && !beginDateCol && !endDateCol) {
        throw new Error('ไม่พบคอลัมน์วันที่ของ Cost');
    }

    return {
        ...tableMeta,
        orgCol,
        levelCol,
        amountCol,
        noteCol,
        effectiveDateCol,
        beginDateCol,
        endDateCol
    };
};

const dateExpr = (resolved: ResolvedCostTable, alias = 'src'): string => {
    const p = alias ? `${alias}.` : '';

    if (resolved.effectiveDateCol) {
        return `TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.effectiveDateCol)})`;
    }

    if (resolved.beginDateCol) {
        return `TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.beginDateCol)})`;
    }

    return `TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.endDateCol || '')})`;
};

const rangeDateCondition = (resolved: ResolvedCostTable, alias = 'src'): string => {
    const p = alias ? `${alias}.` : '';

    if (resolved.beginDateCol && resolved.endDateCol) {
        return `
            AND @ToDate >= COALESCE(TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.beginDateCol)}), @FromDate)
            AND @FromDate <= COALESCE(TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.endDateCol)}), @ToDate)
        `;
    }

    if (resolved.effectiveDateCol) {
        return `AND TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.effectiveDateCol)}) BETWEEN @FromDate AND @ToDate`;
    }

    if (resolved.beginDateCol) {
        return `AND COALESCE(TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.beginDateCol)}), @FromDate) <= @ToDate`;
    }

    if (resolved.endDateCol) {
        return `AND COALESCE(TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.endDateCol)}), @ToDate) >= @FromDate`;
    }

    return '';
};

const bindCostPayload = (
    request: sql.Request,
    payload: CostPayload,
    keyPrefix = ''
) => {
    const prefix = keyPrefix ? `${keyPrefix}` : '';

    request.input(`${prefix}OrgUnitNo`, sql.NVarChar(32), payload.orgUnitNo);
    request.input(`${prefix}LevelGroupNo`, sql.NVarChar(16), payload.levelGroupNo);
    request.input(`${prefix}EffectiveDate`, sql.Date, payload.effectiveDate);
    request.input(`${prefix}Note`, sql.NVarChar(200), toText(payload.note));
    request.input(`${prefix}Cost`, sql.Decimal(18, 4), payload.cost);
};

const keyMatchCondition = (resolved: ResolvedCostTable, alias = ''): string => {
    const p = alias ? `${alias}.` : '';

    const orgMatch = `LTRIM(RTRIM(CAST(${p}${escapeSqlIdentifier(resolved.orgCol)} AS nvarchar(64)))) = @OrgUnitNo`;
    const levelMatch = `LTRIM(RTRIM(CAST(${p}${escapeSqlIdentifier(resolved.levelCol)} AS nvarchar(32)))) = @LevelGroupNo`;

    if (resolved.effectiveDateCol) {
        return `${orgMatch} AND ${levelMatch} AND TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.effectiveDateCol)}) = @EffectiveDate`;
    }

    if (resolved.beginDateCol) {
        return `${orgMatch} AND ${levelMatch} AND TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.beginDateCol)}) = @EffectiveDate`;
    }

    return `${orgMatch} AND ${levelMatch} AND TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.endDateCol || '')}) = @EffectiveDate`;
};

const originalMatchCondition = (resolved: ResolvedCostTable, alias = ''): string => {
    const p = alias ? `${alias}.` : '';

    const orgMatch = `LTRIM(RTRIM(CAST(${p}${escapeSqlIdentifier(resolved.orgCol)} AS nvarchar(64)))) = @OriginalOrgUnitNo`;
    const levelMatch = `LTRIM(RTRIM(CAST(${p}${escapeSqlIdentifier(resolved.levelCol)} AS nvarchar(32)))) = @OriginalLevelGroupNo`;
    const costMatch = `COALESCE(TRY_CONVERT(decimal(18,4), ${p}${escapeSqlIdentifier(resolved.amountCol)}), 0) = @OriginalCost`;

    if (resolved.effectiveDateCol) {
        return `${orgMatch} AND ${levelMatch} AND TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.effectiveDateCol)}) = @OriginalEffectiveDate AND ${costMatch}`;
    }

    if (resolved.beginDateCol) {
        return `${orgMatch} AND ${levelMatch} AND TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.beginDateCol)}) = @OriginalEffectiveDate AND ${costMatch}`;
    }

    return `${orgMatch} AND ${levelMatch} AND TRY_CONVERT(date, ${p}${escapeSqlIdentifier(resolved.endDateCol || '')}) = @OriginalEffectiveDate AND ${costMatch}`;
};

const insertCostRecord = async (
    pool: sql.ConnectionPool,
    resolved: ResolvedCostTable,
    payload: CostPayload
): Promise<void> => {
    const columns: string[] = [
        escapeSqlIdentifier(resolved.orgCol),
        escapeSqlIdentifier(resolved.levelCol),
        escapeSqlIdentifier(resolved.amountCol)
    ];

    const values: string[] = ['@OrgUnitNo', '@LevelGroupNo', '@Cost'];

    if (resolved.noteCol) {
        columns.push(escapeSqlIdentifier(resolved.noteCol));
        values.push('@Note');
    }

    if (resolved.effectiveDateCol) {
        columns.push(escapeSqlIdentifier(resolved.effectiveDateCol));
        values.push('@EffectiveDate');
    }
    if (resolved.beginDateCol) {
        columns.push(escapeSqlIdentifier(resolved.beginDateCol));
        values.push('@EffectiveDate');
    }
    if (resolved.endDateCol) {
        columns.push(escapeSqlIdentifier(resolved.endDateCol));
        values.push('@EffectiveDate');
    }

    const request = pool.request();
    bindCostPayload(request, payload);

    await request.query(`
        INSERT INTO ${resolved.fullName} (${columns.join(', ')})
        VALUES (${values.join(', ')})
    `);
};

const updateCostByKey = async (
    pool: sql.ConnectionPool,
    resolved: ResolvedCostTable,
    payload: CostPayload
): Promise<number> => {
    const setParts: string[] = [
        `${escapeSqlIdentifier(resolved.amountCol)} = @Cost`
    ];

    if (resolved.noteCol) {
        setParts.push(`${escapeSqlIdentifier(resolved.noteCol)} = @Note`);
    }

    if (resolved.effectiveDateCol) {
        setParts.push(`${escapeSqlIdentifier(resolved.effectiveDateCol)} = @EffectiveDate`);
    }
    if (resolved.beginDateCol) {
        setParts.push(`${escapeSqlIdentifier(resolved.beginDateCol)} = @EffectiveDate`);
    }
    if (resolved.endDateCol) {
        setParts.push(`${escapeSqlIdentifier(resolved.endDateCol)} = @EffectiveDate`);
    }

    const request = pool.request();
    bindCostPayload(request, payload);

    const result = await request.query(`
        UPDATE ${resolved.fullName}
        SET ${setParts.join(', ')}
        WHERE ${keyMatchCondition(resolved)}
    `);

    return result.rowsAffected?.[0] || 0;
};

const existsCostByKey = async (
    pool: sql.ConnectionPool,
    resolved: ResolvedCostTable,
    payload: CostPayload
): Promise<boolean> => {
    const request = pool.request();
    bindCostPayload(request, payload);

    const result = await request.query(`
        SELECT TOP (1) 1 AS exists_flag
        FROM ${resolved.fullName}
        WHERE ${keyMatchCondition(resolved)}
    `);

    return Array.isArray(result.recordset) && result.recordset.length > 0;
};

const upsertWithResolved = async (
    pool: sql.ConnectionPool,
    resolved: ResolvedCostTable,
    payload: CostPayload
): Promise<'inserted' | 'updated'> => {
    const exists = await existsCostByKey(pool, resolved, payload);

    if (exists) {
        await updateCostByKey(pool, resolved, payload);
        return 'updated';
    }

    await insertCostRecord(pool, resolved, payload);
    return 'inserted';
};

export const getCostRecordsService = async (fromDate: string, toDate: string): Promise<CostRecord[]> => {
    const pool = await poolPromise;
    const resolved = await resolveCostTable(pool);

    const result = await pool.request()
        .input('FromDate', sql.Date, fromDate)
        .input('ToDate', sql.Date, toDate)
        .query(`
            SELECT
                LTRIM(RTRIM(CAST(src.${escapeSqlIdentifier(resolved.orgCol)} AS nvarchar(64)))) AS OrgUnitNo,
                LTRIM(RTRIM(CAST(src.${escapeSqlIdentifier(resolved.levelCol)} AS nvarchar(32)))) AS LevelGroupNo,
                CONVERT(varchar(10), ${dateExpr(resolved, 'src')}, 23) AS EffectiveDate,
                ${resolved.noteCol
                    ? `COALESCE(CAST(src.${escapeSqlIdentifier(resolved.noteCol)} AS nvarchar(200)), '')`
                    : `CAST('' AS nvarchar(200))`
                } AS Note,
                CAST(COALESCE(TRY_CONVERT(decimal(18,4), src.${escapeSqlIdentifier(resolved.amountCol)}), 0) AS decimal(18,4)) AS Cost
            FROM ${resolved.fullName} src
            WHERE 1 = 1
            ${rangeDateCondition(resolved, 'src')}
            ORDER BY ${dateExpr(resolved, 'src')} DESC, src.${escapeSqlIdentifier(resolved.orgCol)}, src.${escapeSqlIdentifier(resolved.levelCol)}
        `);

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
    const resolved = await resolveCostTable(pool);
    return upsertWithResolved(pool, resolved, payload);
};

export const importCostRowsService = async (
    rows: CostPayload[]
): Promise<{ inserted: number; updated: number; total: number }> => {
    const pool = await poolPromise;
    const resolved = await resolveCostTable(pool);

    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
        const action = await upsertWithResolved(pool, resolved, row);
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
    const resolved = await resolveCostTable(pool);

    const setParts: string[] = [
        `${escapeSqlIdentifier(resolved.orgCol)} = @NextOrgUnitNo`,
        `${escapeSqlIdentifier(resolved.levelCol)} = @NextLevelGroupNo`,
        `${escapeSqlIdentifier(resolved.amountCol)} = @NextCost`
    ];

    if (resolved.noteCol) {
        setParts.push(`${escapeSqlIdentifier(resolved.noteCol)} = @NextNote`);
    }

    if (resolved.effectiveDateCol) {
        setParts.push(`${escapeSqlIdentifier(resolved.effectiveDateCol)} = @NextEffectiveDate`);
    }
    if (resolved.beginDateCol) {
        setParts.push(`${escapeSqlIdentifier(resolved.beginDateCol)} = @NextEffectiveDate`);
    }
    if (resolved.endDateCol) {
        setParts.push(`${escapeSqlIdentifier(resolved.endDateCol)} = @NextEffectiveDate`);
    }

    const request = pool.request();
    bindCostPayload(request, original, 'Original');
    bindCostPayload(request, next, 'Next');

    const result = await request.query(`
        ;WITH target AS (
            SELECT TOP (1) *
            FROM ${resolved.fullName}
            WHERE ${originalMatchCondition(resolved)}
            ORDER BY ${dateExpr(resolved, '')} DESC
        )
        UPDATE target
        SET ${setParts.join(', ')}
    `);

    return (result.rowsAffected?.[0] || 0) > 0;
};

export const deleteCostRecordService = async (original: CostPayload): Promise<boolean> => {
    const pool = await poolPromise;
    const resolved = await resolveCostTable(pool);

    const request = pool.request();
    bindCostPayload(request, original, 'Original');

    const result = await request.query(`
        ;WITH target AS (
            SELECT TOP (1) *
            FROM ${resolved.fullName}
            WHERE ${originalMatchCondition(resolved)}
            ORDER BY ${dateExpr(resolved, '')} DESC
        )
        DELETE FROM target
    `);

    return (result.rowsAffected?.[0] || 0) > 0;
};

export const getCostTemplateMetaService = async (): Promise<{
    headers: string[];
    table: string;
    mappings: Record<string, string | null>;
}> => {
    const pool = await poolPromise;
    const resolved = await resolveCostTable(pool);
    const headers = [...BASE_TEMPLATE_HEADERS];
    if (resolved.noteCol) {
        headers.push('Note');
    }
    headers.push('Cost');

    return {
        headers,
        table: `${resolved.schemaName}.${resolved.tableName}`,
        mappings: {
            OrgUnitNo: resolved.orgCol,
            LevelGroupNo: resolved.levelCol,
            EffectiveDate: resolved.effectiveDateCol || resolved.beginDateCol || resolved.endDateCol,
            Note: resolved.noteCol,
            Cost: resolved.amountCol
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

    const result = await request.query(`
        SELECT
            LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo,
            LTRIM(RTRIM(CAST(LevelGroupName AS nvarchar(255)))) AS LevelGroupName,
            TRY_CONVERT(int, LevelGroupOrder) AS LevelGroupOrder
        FROM MP_LevelGroup
        WHERE
            @EffectiveDate BETWEEN
            COALESCE(TRY_CONVERT(date, BeginDate), @EffectiveDate) AND
            COALESCE(TRY_CONVERT(date, EndDate), @EffectiveDate)
        ORDER BY
            COALESCE(TRY_CONVERT(int, LevelGroupOrder), 9999),
            LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16))))
    `);

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
