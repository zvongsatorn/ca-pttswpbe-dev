import { sql, poolPromise } from '../config/db.js';

type Report08LevelMap = Map<string, Map<string, number>>;
type Report09OrgYearMap = Map<string, Map<number, { support: number; bu: number }>>;

type TableMeta = {
    schemaName: string;
    tableName: string;
    fullName: string;
    objectName: string;
    columns: Map<string, string>;
};

const REPORT08_PEOPLE_LEVELS = [
    { levelGroupNo: '1007', peopleKey: 'people_21', expenseKey: 'expense_21' },
    { levelGroupNo: '1006', peopleKey: 'people_18_20', expenseKey: 'expense_18_20' },
    { levelGroupNo: '1005', peopleKey: 'people_16_17', expenseKey: 'expense_16_17' },
    { levelGroupNo: '1004', peopleKey: 'people_14_15', expenseKey: 'expense_14_15' },
    { levelGroupNo: '1003', peopleKey: 'people_11_13', expenseKey: 'expense_11_13' },
    { levelGroupNo: '1002', peopleKey: 'people_9_10', expenseKey: 'expense_9_10' },
    { levelGroupNo: '1001', peopleKey: 'people_4_8', expenseKey: 'expense_4_8' }
] as const;

const REPORT08_MAJOR_LEVEL = '1017';
const REPORT08_MINOR_LEVEL = '1018';

const REPORT08_ORG_COL_CANDIDATES = ['OrgUnitID', 'OrgUnitId', 'OrgUnitNo', 'OrgUnitNO', 'OrgUnit', 'UnitNo', 'UnitCode', 'OrgNo'];
const REPORT08_LEVEL_COL_CANDIDATES = ['LevelGroupNo', 'LevelGroupNO', 'LevelNo', 'GroupNo', 'PositionLevel'];
const REPORT08_EMPLOYEE_COL_CANDIDATES = ['EmployeeID', 'EmployeeId', 'EmpID', 'EmpId', 'EmployeeNo'];
const REPORT08_SIGN_POS_COL_CANDIDATES = ['SignPos', 'SignPOS', 'SignPosition', 'SignPosFlag'];
const REPORT08_BEGIN_COL_CANDIDATES = ['BeginDate', 'StartDate', 'FromDate', 'EffectiveStartDate'];
const REPORT08_END_COL_CANDIDATES = ['EndDate', 'ToDate', 'EffectiveEndDate'];
const REPORT08_EFFECTIVE_COL_CANDIDATES = ['EffectiveDate', 'CheckDate', 'DataDate', 'MonthDate', 'TranDate'];
const REPORT08_AMOUNT_COL_CANDIDATES = ['CostEmployee', 'CostAmount', 'Amount', 'BudgetAmount', 'ExpenseAmount', 'TotalAmount', 'TotalCost', 'Cost', 'Value'];

const REPORT09_INFO_TABLE_CANDIDATES = ['infodata', 'InfoData'];
const REPORT09_POSITION_TABLE_CANDIDATES = ['InterfacePosition', 'interfaceposition'];
const REPORT09_RETIRE_YEAR_COL_CANDIDATES = ['RETIREYEAR', 'RetireYear'];
const REPORT09_INFO_POSITION_COL_CANDIDATES = ['POSCODE', 'PositionID', 'PositionCode', 'PosCode'];
const REPORT09_POSITION_ID_COL_CANDIDATES = ['PositionID', 'POSCODE', 'PositionCode', 'PosCode'];
const REPORT09_ORG_COL_CANDIDATES = ['OrgUnitID', 'OrgUnitId', 'OrgUnitNo', 'OrgUnitNO', 'OrgUnit', 'UnitNo', 'UnitCode', 'OrgNo'];
const REPORT09_BS_TYPE_COL_CANDIDATES = ['BSType', 'BsType', 'BS_Type', 'TypeBS'];
const REPORT09_SIGN_POS_COL_CANDIDATES = ['SignPos', 'SignPOS', 'SignPosition', 'SignPosFlag'];
const REPORT09_EMPLOYEE_COL_CANDIDATES = ['EmployeeID', 'EmployeeId', 'EmpID', 'EmpId', 'EmployeeNo'];

export const getDashboardDataService = async (
    effectiveMonth: string,
    effectiveYear: string,
    employeeId: string,
    userGroupNo: string,
    isSecondment: number,
    levelType: number,
    division: string
) => {
    try {
        const pool = await poolPromise;
        let request = pool.request();

        // Convert year, assuming CE is input or fixing it
        let yearAD = 0;
        if (parseInt(effectiveYear) > 2500) {
            yearAD = parseInt(effectiveYear) - 543;
        } else {
            yearAD = parseInt(effectiveYear);
        }

        const effectiveDateStr = `${yearAD}-${effectiveMonth.toString().padStart(2, '0')}-01`;
        const effectiveDate = new Date(effectiveDateStr);

        request.input('Effectivedate', sql.DateTime, effectiveDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNo', sql.VarChar(2), userGroupNo);

        if (isSecondment >= 0) {
            request.input('IsSecondment', sql.Int, isSecondment);
        } else {
            request.input('IsSecondment', sql.Int, null);
        }
        
        request.input('Leveltype', sql.Int, levelType);
        
        // division is equivalent to OrgUnitNo
        if (division) {
             request.input('division', sql.VarChar(8), division);
        } else {
             request.input('division', sql.VarChar(8), null);
        }

        const result = await request.execute('mp_DashboardReport4');

        return result.recordset;
    } catch (error) {
        console.error('Error in getDashboardDataService:', error);
        throw error;
    }
};

export const getDashboardExcelDataService = async (
    effectiveMonth: string,
    effectiveYear: string,
    employeeId: string,
    userGroupNo: string,
    isSecondment: number,
    levelType: number,
    division: string
) => {
    try {
        const pool = await poolPromise;
        let request = pool.request();

        let yearAD = 0;
        if (parseInt(effectiveYear) > 2500) {
            yearAD = parseInt(effectiveYear) - 543;
        } else {
            yearAD = parseInt(effectiveYear);
        }

        const effectiveDateStr = `${yearAD}-${effectiveMonth.toString().padStart(2, '0')}-01`;
        const effectiveDate = new Date(effectiveDateStr);

        request.input('Effectivedate', sql.DateTime, effectiveDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNo', sql.VarChar(2), userGroupNo);

        if (isSecondment >= 0) {
            request.input('IsSecondment', sql.Int, isSecondment);
        } else {
            request.input('IsSecondment', sql.Int, null);
        }
        
        request.input('Leveltype', sql.Int, levelType);
        
        if (division) {
             request.input('division', sql.VarChar(8), division);
        } else {
             request.input('division', sql.VarChar(8), null);
        }

        const result = await request.execute('mp_DashboardReport4_excel');

        return result.recordset;
    } catch (error) {
        console.error('Error in getDashboardExcelDataService:', error);
        throw error;
    }
};

export const getReport01DataService = async (
    effectiveDateStr: string,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        const pool = await poolPromise;
        let request = pool.request();

        // effectiveDateStr normally comes in "YYYY-MM-DD" format from frontend
        const effectiveDate = new Date(effectiveDateStr);

        request.input('Effectivedate', sql.DateTime, effectiveDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNo', sql.VarChar(2), userGroupNo);

        const result = await request.execute('mp_Report01Get');
        const rows = result.recordset;

        // Transform flat rows into a hierarchical tree format matching the Ant Design table `children` array structure.
        return buildReport01Tree(rows);
    } catch (error) {
        console.error('Error in getReport01DataService:', error);
        throw error;
    }
};

export const getReport1ExcelDataService = async (
    effectiveDateStr: string,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();

        const effectiveDate = new Date(effectiveDateStr);

        request.input('Effectivedate', sql.DateTime, effectiveDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNo', sql.VarChar(2), userGroupNo);

        const result = await request.execute('mp_Report01Get');
        const rows = result.recordset;


        // Reuse the buildReport01Tree logic to ensure consistency between UI and Excel
        return buildReport01Tree(rows);
    } catch (error) {
        console.error('Error in getReport1ExcelDataService:', error);
        throw error;
    }
};

export const getReport02DataService = async (
    fromDateStr: string,
    toDateStr: string,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();

        const fromDate = new Date(fromDateStr);
        const toDate = new Date(toDateStr);

        request.input('FromDate', sql.DateTime, fromDate);
        request.input('ToDate', sql.DateTime, toDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNo', sql.VarChar(2), userGroupNo || null);

        const result = await request.execute('mp_ReportBG3');
        return result.recordset;
    } catch (error) {
        console.error('Error in getReport02DataService:', error);
        throw error;
    }
};

export const getReport03DataService = async (
    effectiveDateStr: string,
    employeeId: string,
    userGroupNo: string,
    division: string,
    orgUnitNo: string,
    bgNo: string,
    reportType: string
) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();

        const effectiveDate = new Date(effectiveDateStr);

        request.input('EffectiveDate', sql.DateTime, effectiveDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNO', sql.VarChar(2), userGroupNo);
        request.input('Division', sql.VarChar(8), division || null);
        request.input('OrgUnitNo', sql.VarChar(8), orgUnitNo || null);
        request.input('BGNo', sql.VarChar(3), bgNo || null);
        request.input('ReportType', sql.VarChar(1), reportType || null);

        const result = await request.execute('mp_HRCenter_Report');
        return result.recordset;
    } catch (error) {
        console.error('Error in getReport03DataService:', error);
        throw error;
    }
};

export const getReport03FilterOptionsService = async (
    effectiveDateStr: string,
    employeeId: string,
    userGroupNo: string,
    bgNo: string,
    division: string
) => {
    try {
        const pool = await poolPromise;
        const effectiveDate = new Date(effectiveDateStr);

        const safeExec = async (label: string, fn: () => Promise<any[]>) => {
            try {
                return await fn();
            } catch (error) {
                console.error(`Error in getReport03FilterOptionsService (${label}):`, error);
                return [];
            }
        };

        const businessUnits = await safeExec('bg', async () => {
            const bgRequest = pool.request();
            bgRequest.input('p_CheckDate', sql.DateTime, effectiveDate);
            const bgResult = await bgRequest.execute('mp_BGGetByEffectivePeriod');
            return bgResult.recordset || [];
        });

        const lines = await safeExec('line', async () => {
            const lineRequest = pool.request();
            lineRequest.input('UserGroupNo', sql.VarChar(2), userGroupNo);
            lineRequest.input('EmployeeID', sql.VarChar(8), employeeId);
            lineRequest.input('EffectiveDate', sql.DateTime, effectiveDate);
            lineRequest.input('BGNo', sql.VarChar(3), bgNo || null);
            const lineResult = await lineRequest.execute('mp_GetUnitLine');
            return lineResult.recordset || [];
        });

        const units = await safeExec('unit', async () => {
            const unitRequest = pool.request();
            if (bgNo) {
                unitRequest.input('EffectiveDate', sql.DateTime, effectiveDate);
                unitRequest.input('BGNo', sql.VarChar(3), bgNo);
                unitRequest.input('division', sql.VarChar(8), division || null);
                unitRequest.input('UserGroupNO', sql.VarChar(2), userGroupNo);
                unitRequest.input('EmployeeID', sql.VarChar(8), employeeId);
                unitRequest.input('p_SelectType', sql.Int, 9);
                const unitResult = await unitRequest.execute('mp_UnitGetByLineBGAndEffectivePeriod');
                return unitResult.recordset || [];
            }

            unitRequest.input('UserGroupNo', sql.VarChar(2), userGroupNo);
            unitRequest.input('EmployeeID', sql.VarChar(8), employeeId);
            unitRequest.input('OrgUnitNo', sql.VarChar(8), division || null);
            unitRequest.input('EffectiveDate', sql.DateTime, effectiveDate);
            unitRequest.input('p_SelectType', sql.Int, 0);
            const unitResult = await unitRequest.execute('mp_UnitGetByLineAndEffectivePeriod');
            return unitResult.recordset || [];
        });

        // If any core part (lines or units) is empty despite having business units, 
        // it means an SP potentially failed. Continue to fallback to heal the data.
        if (businessUnits.length > 0 && lines.length > 0 && units.length > 0) {
            return {
                businessUnits,
                lines,
                units
            };
        }

        // Fallback: derive options from report result to avoid blocking UI if combo SPs fail in some environments.
        const reportRows = await getReport03DataService(
            effectiveDateStr,
            employeeId,
            userGroupNo,
            division || '',
            '',
            bgNo || '',
            '0'
        );

        const bgMap = new Map<string, any>();
        const lineMap = new Map<string, any>();
        const unitMap = new Map<string, any>();

        reportRows.forEach((row: any) => {
            const bgCode = String(row.BGNo || '').trim();
            const bgName = String(row.BGName || '').trim();
            if (bgCode || bgName) {
                bgMap.set(bgCode || bgName, { BGNo: bgCode, BGName: bgName });
            }

            const lineCode = String(row.SecUnitDummy || '').trim();
            const lineName = String(row.SecUnitDummy || '').trim();
            if (lineCode || lineName) {
                lineMap.set(lineCode || lineName, { OrgUnitNo: lineCode, UnitText: lineName });
            }

            const unitCode = String(row.OrgUnitNo || '').trim();
            const unitName = String(row.UnitName || '').trim();
            const unitAbbr = String(row.UnitAbbr || '').trim();
            if (unitCode || unitName || unitAbbr) {
                unitMap.set(unitCode || unitName, {
                    OrgUnitNo: unitCode,
                    UnitName: unitName,
                    UnitAbbr: unitAbbr,
                    UnitText: unitName || unitAbbr
                });
            }
        });

        return {
            businessUnits: Array.from(bgMap.values()),
            lines: Array.from(lineMap.values()),
            units: Array.from(unitMap.values())
        };
    } catch (error) {
        console.error('Error in getReport03FilterOptionsService:', error);
        throw error;
    }
};

const escapeSqlString = (value: string): string => value.replace(/'/g, "''");

const escapeSqlIdentifier = (value: string): string => `[${value.replace(/]/g, ']]')}]`;

const pickColumnName = (columns: Map<string, string>, candidates: string[]): string | null => {
    for (const candidate of candidates) {
        const found = columns.get(candidate.toLowerCase());
        if (found) return found;
    }
    return null;
};

const getTableMeta = async (
    pool: any,
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

    const rows = Array.isArray(tableRes.recordset) ? tableRes.recordset as Array<Record<string, unknown>> : [];
    if (!rows.length) return null;

    const rankTable = (row: Record<string, unknown>, candidate: string) => {
        const tableName = String(row.table_name || '').toLowerCase();
        const schemaName = String(row.schema_name || '').toLowerCase();
        const tableExact = tableName === candidate.toLowerCase() ? 0 : 1;
        const schemaRank = schemaName === 'dbo' ? 0 : 1;
        return tableExact * 10 + schemaRank;
    };

    let selected: Record<string, unknown> | null = null;
    for (const candidate of tableCandidates) {
        const matched = rows
            .filter((row) => String(row.table_name || '').toLowerCase() === candidate.toLowerCase())
            .sort((a, b) => rankTable(a, candidate) - rankTable(b, candidate));
        if (matched.length > 0) {
            selected = matched[0];
            break;
        }
    }

    if (!selected) selected = rows[0];

    const schemaName = String(selected.schema_name || '').trim();
    const tableName = String(selected.table_name || '').trim();
    if (!schemaName || !tableName) return null;

    const objectName = `${schemaName}.${tableName}`;
    const columnsRes = await pool.request()
        .input('objectName', sql.NVarChar(300), objectName)
        .query(`
            SELECT c.name
            FROM sys.columns c
            WHERE c.object_id = OBJECT_ID(@objectName)
        `);

    const columnRows = Array.isArray(columnsRes.recordset) ? columnsRes.recordset as Array<Record<string, unknown>> : [];
    const columns = new Map<string, string>();
    columnRows.forEach((row) => {
        const colName = String(row.name || '').trim();
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

const normalizeReport08RowsToMap = (rows: Array<Record<string, unknown>>): Report08LevelMap => {
    const result: Report08LevelMap = new Map();

    rows.forEach((row) => {
        const orgUnitNo = toTrimText(row.org_unit_no ?? row.OrgUnitNo);
        const levelGroupNo = toTrimText(row.level_group_no ?? row.LevelGroupNo);
        const metricValue = toNumberOrZero(row.metric_value ?? row.MetricValue);

        if (!orgUnitNo || !levelGroupNo) return;
        if (!result.has(orgUnitNo)) result.set(orgUnitNo, new Map<string, number>());

        const levelMap = result.get(orgUnitNo)!;
        levelMap.set(levelGroupNo, (levelMap.get(levelGroupNo) || 0) + metricValue);
    });

    return result;
};

const buildReport08DateCondition = (
    alias: string,
    beginDateCol: string | null,
    endDateCol: string | null,
    effectiveDateCol: string | null,
    mode: 'range' | 'point' = 'range'
) => {
    const prefix = alias ? `${alias}.` : '';

    if (mode === 'point') {
        if (beginDateCol && endDateCol) {
            return `AND @EffectiveDate BETWEEN COALESCE(${prefix}${escapeSqlIdentifier(beginDateCol)}, @EffectiveDate) AND COALESCE(${prefix}${escapeSqlIdentifier(endDateCol)}, @EffectiveDate)`;
        }

        if (effectiveDateCol) {
            return `AND ${prefix}${escapeSqlIdentifier(effectiveDateCol)} = @EffectiveDate`;
        }

        if (beginDateCol) {
            return `AND COALESCE(${prefix}${escapeSqlIdentifier(beginDateCol)}, @EffectiveDate) <= @EffectiveDate`;
        }

        if (endDateCol) {
            return `AND COALESCE(${prefix}${escapeSqlIdentifier(endDateCol)}, @EffectiveDate) >= @EffectiveDate`;
        }

        return '';
    }

    if (beginDateCol && endDateCol) {
        return `AND @ToDate >= COALESCE(${prefix}${escapeSqlIdentifier(beginDateCol)}, @FromDate) AND @FromDate <= COALESCE(${prefix}${escapeSqlIdentifier(endDateCol)}, @ToDate)`;
    }

    if (effectiveDateCol) {
        return `AND ${prefix}${escapeSqlIdentifier(effectiveDateCol)} BETWEEN @FromDate AND @ToDate`;
    }

    if (beginDateCol) {
        return `AND COALESCE(${prefix}${escapeSqlIdentifier(beginDateCol)}, @FromDate) <= @ToDate`;
    }

    if (endDateCol) {
        return `AND COALESCE(${prefix}${escapeSqlIdentifier(endDateCol)}, @ToDate) >= @FromDate`;
    }

    return '';
};

const getReport08PositionMap = async (
    pool: any,
    effectiveDate: Date
): Promise<Report08LevelMap> => {
    const tableMeta = await getTableMeta(pool, ['InterfacePosition', 'interfaceposition']);
    if (!tableMeta) return new Map();

    const orgCol = pickColumnName(tableMeta.columns, REPORT08_ORG_COL_CANDIDATES);
    const levelCol = pickColumnName(tableMeta.columns, REPORT08_LEVEL_COL_CANDIDATES);
    if (!orgCol || !levelCol) return new Map();

    const employeeCol = pickColumnName(tableMeta.columns, REPORT08_EMPLOYEE_COL_CANDIDATES);
    const signPosCol = pickColumnName(tableMeta.columns, REPORT08_SIGN_POS_COL_CANDIDATES);
    const beginDateCol = pickColumnName(tableMeta.columns, REPORT08_BEGIN_COL_CANDIDATES);
    const endDateCol = pickColumnName(tableMeta.columns, REPORT08_END_COL_CANDIDATES);
    const effectiveDateCol = pickColumnName(tableMeta.columns, REPORT08_EFFECTIVE_COL_CANDIDATES);
    const dateCondition = buildReport08DateCondition('src', beginDateCol, endDateCol, effectiveDateCol, 'point');
    const employeeCondition = employeeCol
        ? `AND src.${escapeSqlIdentifier(employeeCol)} IS NOT NULL AND LTRIM(RTRIM(CAST(src.${escapeSqlIdentifier(employeeCol)} AS nvarchar(50)))) <> ''`
        : '';
    const signPosCondition = signPosCol
        ? `AND TRY_CONVERT(int, src.${escapeSqlIdentifier(signPosCol)}) = 100`
        : '';

    const reportLevelList = REPORT08_PEOPLE_LEVELS.map((item) => item.levelGroupNo);
    const inList = reportLevelList.map((lv) => `'${escapeSqlString(lv)}'`).join(',');

    const query = `
        SELECT
            CAST(src.${escapeSqlIdentifier(orgCol)} AS nvarchar(32)) AS org_unit_no,
            CAST(src.${escapeSqlIdentifier(levelCol)} AS nvarchar(16)) AS level_group_no,
            COUNT(1) AS metric_value
        FROM ${tableMeta.fullName} src
        WHERE CAST(src.${escapeSqlIdentifier(levelCol)} AS nvarchar(16)) IN (${inList})
        ${dateCondition}
        ${employeeCondition}
        ${signPosCondition}
        GROUP BY
            CAST(src.${escapeSqlIdentifier(orgCol)} AS nvarchar(32)),
            CAST(src.${escapeSqlIdentifier(levelCol)} AS nvarchar(16))
    `;

    const res = await pool.request()
        .input('EffectiveDate', sql.DateTime, effectiveDate)
        .query(query);

    return normalizeReport08RowsToMap(Array.isArray(res.recordset) ? res.recordset as Array<Record<string, unknown>> : []);
};

const getReport08CostMap = async (
    pool: any,
    fromDate: Date,
    toDate: Date
): Promise<Report08LevelMap> => {
    const tableMeta = await getTableMeta(pool, ['MP_CostEmployee', 'MP_CostEmp', 'CostEmployee']);
    if (!tableMeta) return new Map();

    const orgCol = pickColumnName(tableMeta.columns, REPORT08_ORG_COL_CANDIDATES);
    const levelCol = pickColumnName(tableMeta.columns, REPORT08_LEVEL_COL_CANDIDATES);
    if (!orgCol || !levelCol) return new Map();

    const amountCol = pickColumnName(tableMeta.columns, REPORT08_AMOUNT_COL_CANDIDATES);
    const beginDateCol = pickColumnName(tableMeta.columns, REPORT08_BEGIN_COL_CANDIDATES);
    const endDateCol = pickColumnName(tableMeta.columns, REPORT08_END_COL_CANDIDATES);
    const effectiveDateCol = pickColumnName(tableMeta.columns, REPORT08_EFFECTIVE_COL_CANDIDATES);
    const dateCondition = buildReport08DateCondition('src', beginDateCol, endDateCol, effectiveDateCol);

    const reportLevelList = [
        ...REPORT08_PEOPLE_LEVELS.map((item) => item.levelGroupNo),
        REPORT08_MAJOR_LEVEL,
        REPORT08_MINOR_LEVEL
    ];
    const inList = reportLevelList.map((lv) => `'${escapeSqlString(lv)}'`).join(',');
    const amountExpr = amountCol
        ? `COALESCE(TRY_CONVERT(decimal(18,2), src.${escapeSqlIdentifier(amountCol)}), 0)`
        : '0';

    const query = `
        SELECT
            CAST(src.${escapeSqlIdentifier(orgCol)} AS nvarchar(32)) AS org_unit_no,
            CAST(src.${escapeSqlIdentifier(levelCol)} AS nvarchar(16)) AS level_group_no,
            SUM(${amountExpr}) AS metric_value
        FROM ${tableMeta.fullName} src
        WHERE CAST(src.${escapeSqlIdentifier(levelCol)} AS nvarchar(16)) IN (${inList})
        ${dateCondition}
        GROUP BY
            CAST(src.${escapeSqlIdentifier(orgCol)} AS nvarchar(32)),
            CAST(src.${escapeSqlIdentifier(levelCol)} AS nvarchar(16))
    `;

    const res = await pool.request()
        .input('FromDate', sql.DateTime, fromDate)
        .input('ToDate', sql.DateTime, toDate)
        .query(query);

    return normalizeReport08RowsToMap(Array.isArray(res.recordset) ? res.recordset as Array<Record<string, unknown>> : []);
};

const getReport08Metric = (map: Report08LevelMap, orgUnitNo: string, levelGroupNo: string): number => {
    const perOrg = map.get(orgUnitNo);
    if (!perOrg) return 0;
    return toNumberOrZero(perOrg.get(levelGroupNo));
};

const toNumberOrZero = (value: unknown): number => {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toTrimText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
};

const splitCsvValues = (value: string): string[] =>
    toTrimText(value)
        .split(',')
        .map((item) => toTrimText(item))
        .filter((item) => item.length > 0);

const singleOrNull = (values: string[]): string | null => (values.length === 1 ? values[0] : null);

const matchesSelectedSet = (selected: Set<string> | null, candidates: Array<unknown>): boolean => {
    if (!selected || selected.size === 0) return true;
    return candidates.some((candidate) => {
        const normalized = toTrimText(candidate);
        return normalized !== '' && selected.has(normalized);
    });
};

const toDisplayDate = (value: unknown): string => {
    if (!value) return '';
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear());
    return `${day}/${month}/${year}`;
};

const mapTypecalToDataset = (value: unknown): string => {
    const text = toTrimText(value).toLowerCase();
    const num = Number(value);

    if (Number.isFinite(num)) {
        if (num === 2) return 'PoolRS';
        if (num === 3) return 'Sec Pool';
        return 'ปกติ';
    }

    if (text.includes('sec')) return 'Sec Pool';
    if (text.includes('pool')) return 'PoolRS';
    if (text.includes('normal') || text.includes('ปกติ')) return 'ปกติ';
    return 'ปกติ';
};

const buildRowAccessor = (row: Record<string, unknown>) => {
    const lowerMap = new Map<string, unknown>();
    Object.entries(row).forEach(([key, value]) => {
        lowerMap.set(key.toLowerCase(), value);
    });

    const pick = (...aliases: string[]) => {
        for (const alias of aliases) {
            const value = lowerMap.get(alias.toLowerCase());
            if (value !== undefined && value !== null && value !== '') {
                return value;
            }
        }
        return undefined;
    };

    const num = (...aliases: string[]) => toNumberOrZero(pick(...aliases));
    const text = (...aliases: string[]) => toTrimText(pick(...aliases));

    return { num, text };
};

const sumLevels = (levels: number[]) => levels.reduce((sum, current) => sum + current, 0);

export const getReport04DataService = async (
    effectiveDateStr: string,
    employeeId: string,
    userGroupNo: string,
    division: string,
    orgUnitNo: string,
    bgNo: string
) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();
        const selectedDivisionValues = splitCsvValues(division);
        const selectedOrgUnitValues = splitCsvValues(orgUnitNo);
        const selectedBgValues = splitCsvValues(bgNo);

        const effectiveDate = new Date(effectiveDateStr);
        request.input('EffectiveDate', sql.DateTime, effectiveDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNO', sql.VarChar(2), userGroupNo || null);
        request.input('Division', sql.VarChar(8), singleOrNull(selectedDivisionValues));
        request.input('OrgUnitNo', sql.VarChar(8), singleOrNull(selectedOrgUnitValues));
        request.input('BGNo', sql.VarChar(3), singleOrNull(selectedBgValues));

        const result = await request.execute('mp_ReportActualUnit');
        const rows = Array.isArray(result.recordset) ? result.recordset : [];
        const selectedDivisionSet = selectedDivisionValues.length > 0 ? new Set(selectedDivisionValues) : null;
        const selectedOrgUnitSet = selectedOrgUnitValues.length > 0 ? new Set(selectedOrgUnitValues) : null;
        const selectedBgSet = selectedBgValues.length > 0 ? new Set(selectedBgValues) : null;

        const filteredRows = rows.filter((rawRow) => {
            const row = (rawRow && typeof rawRow === 'object') ? (rawRow as Record<string, unknown>) : {};
            const { text } = buildRowAccessor(row);

            const rowBg = text('BGNo', 'bg_no', 'bgno');
            const rowDivision = text(
                'ParentOrgUnitNo',
                'line_of_work',
                'GrandName2',
                'GrandName',
                'GrandParent',
                'SecUnitDummy',
                'Division',
                'OrgUnitLine',
                'LineCode',
                'LineNo'
            );
            const rowOrgUnit = text('OrgUnitNo', 'org_unit_no', 'unit_code');

            return (
                matchesSelectedSet(selectedBgSet, [rowBg]) &&
                matchesSelectedSet(selectedDivisionSet, [rowDivision]) &&
                matchesSelectedSet(selectedOrgUnitSet, [rowOrgUnit])
            );
        });

        return filteredRows.map((rawRow, index) => {
            const row = (rawRow && typeof rawRow === 'object') ? rawRow as Record<string, unknown> : {};
            const { num, text } = buildRowAccessor(row);

            const frameStaffLevels = [
                num('n_Q_21', 'Q_N_21'),
                num('n_Q_18_20', 'Q_N_18_20'),
                num('n_Q_16_17', 'Q_N_16_17'),
                num('n_Q_14_15', 'Q_N_14_15'),
                num('n_Q_11_13', 'Q_N_11_13'),
                num('n_Q_9_10', 'Q_N_9_10'),
                num('n_Q_8', 'Q_N_4_8')
            ];

            const frameStaffDiffLevels = [
                num('Diff_Q_21'),
                num('Diff_Q_18_20'),
                num('Diff_Q_16_17'),
                num('Diff_Q_14_15'),
                num('Diff_Q_11_13'),
                num('Diff_Q_9_10'),
                num('Diff_Q_8')
            ];

            const peopleNormalLevels = [
                num('Actual_21'),
                num('Actual_18_20'),
                num('Actual_16_17'),
                num('Actual_14_15'),
                num('Actual_11_13'),
                num('Actual_9_10'),
                num('Actual_8')
            ];

            const peopleNormalDiffLevels = [
                num('Diff_Actual_21'),
                num('Diff_Actual_18_20'),
                num('Diff_Actual_16_17'),
                num('Diff_Actual_14_15'),
                num('Diff_Actual_11_13'),
                num('Diff_Actual_9_10'),
                num('Diff_Actual_8')
            ];

            const frameSecLevels = [
                num('sq_Q_21', 'Q_S_21'),
                num('sq_Q_18_20', 'Q_S_18_20'),
                num('sq_Q_16_17', 'Q_S_16_17'),
                num('sq_Q_14_15', 'Q_S_14_15'),
                num('sq_Q_11_13', 'Q_S_11_13'),
                num('sq_Q_9_10', 'Q_S_9_10'),
                num('sq_Q_8', 'Q_S_8', 'Q_S_4_8')
            ];
            const frameSecDiffLevels = [
                num('Diff_sq_Q_21', 'Diff_Q_S_21'),
                num('Diff_sq_Q_18_20', 'Diff_Q_S_18_20'),
                num('Diff_sq_Q_16_17', 'Diff_Q_S_16_17'),
                num('Diff_sq_Q_14_15', 'Diff_Q_S_14_15'),
                num('Diff_sq_Q_11_13', 'Diff_Q_S_11_13'),
                num('Diff_sq_Q_9_10', 'Diff_Q_S_9_10'),
                num('Diff_sq_Q_8', 'Diff_Q_S_8')
            ];
            const peopleSecLevels = [
                num('sp_P_21', 'P_S_21'),
                num('sp_P_18_20', 'P_S_18_20'),
                num('sp_P_16_17', 'P_S_16_17'),
                num('sp_P_14_15', 'P_S_14_15'),
                num('sp_P_11_13', 'P_S_11_13'),
                num('sp_P_9_10', 'P_S_9_10'),
                num('sp_P_8', 'P_S_8', 'P_S_4_8')
            ];
            const peopleSecDiffLevels = [
                num('Diff_sp_P_21', 'Diff_P_S_21'),
                num('Diff_sp_P_18_20', 'Diff_P_S_18_20'),
                num('Diff_sp_P_16_17', 'Diff_P_S_16_17'),
                num('Diff_sp_P_14_15', 'Diff_P_S_14_15'),
                num('Diff_sp_P_11_13', 'Diff_P_S_11_13'),
                num('Diff_sp_P_9_10', 'Diff_P_S_9_10'),
                num('Diff_sp_P_8', 'Diff_P_S_8')
            ];

            const frameStaffTotal = num('n_amount') || sumLevels(frameStaffLevels);
            const frameStaffTotalDiff = num('Diff_Q_Total') || sumLevels(frameStaffDiffLevels);

            const peopleNormalTotal = num('Actual_Total') || sumLevels(peopleNormalLevels);
            const peopleNormalTotalDiff = num('Diff_Actual_Total') || sumLevels(peopleNormalDiffLevels);

            const frameSecTotal = num('sq_amount') || sumLevels(frameSecLevels);
            const frameSecTotalDiff = num('Diff_sq_Total') || sumLevels(frameSecDiffLevels);
            const peopleSecTotal = num('sp_amount') || sumLevels(peopleSecLevels);
            const peopleSecTotalDiff = num('Diff_sp_Total') || sumLevels(peopleSecDiffLevels);

            const totalFrameNormal = num('Total_Q_Normal');
            const totalFrameNormalDiff = num('Diff_Total_Q_Normal');
            const totalFramePool = num('Total_Q_PoolRS');
            const totalFramePoolDiff = num('Diff_Total_Q_PoolRS');
            const totalFrameTrad = num('Total_Q_Traditional');
            const totalFrameTradDiff = num('Diff_Total_Q_Traditional');
            const totalFrameNewbiz = num('Total_Q_NewBiz');
            const totalFrameNewbizDiff = num('Diff_Total_Q_NewBiz');
            const totalFrameTotal = num('GrandTotal_Q');
            const totalFrameTotalDiff = num('Diff_GrandTotal_Q');

            const totalPeopleNormal = num('Total_P_Normal');
            const totalPeopleNormalDiff = num('Diff_Total_P_Normal');
            const totalPeoplePool = num('Total_P_PoolRS');
            const totalPeoplePoolDiff = num('Diff_Total_P_PoolRS');
            const totalPeopleTrad = num('Total_P_Traditional');
            const totalPeopleTradDiff = num('Diff_Total_P_Traditional');
            const totalPeopleNewbiz = num('Total_P_NewBiz');
            const totalPeopleNewbizDiff = num('Diff_Total_P_NewBiz');
            const totalPeopleTotal = num('GrandTotal_P');
            const totalPeopleTotalDiff = num('Diff_GrandTotal_P');

            const vacancyLevels = [
                num('Vacant_21'),
                num('Vacant_18_20'),
                num('Vacant_16_17'),
                num('Vacant_14_15'),
                num('Vacant_11_13'),
                num('Vacant_9_10'),
                num('Vacant_8')
            ];
            const vacancyDiffLevels = frameStaffDiffLevels.map((value, i) => value - peopleNormalDiffLevels[i]);
            const vacancyTotal = num('Vacant_Total') || (totalFrameTotal - totalPeopleNormal - num('Recruit_Amount', 'f_amount'));
            const vacancyTotalDiff = totalFrameTotalDiff - totalPeopleNormalDiff;
            const recruitAmount = num('Recruit_Amount', 'f_amount');

            return {
                key: `r4-${index + 1}`,
                unit_short: text('UnitAbbr', 'unit_short', 'DisplayName'),
                unit_code: text('OrgUnitNo', 'unit_code'),
                unit_name: text('UnitName', 'unit_name', 'UnitAbbr', 'DisplayName'),
                line_of_work: text('ParentOrgUnitNo', 'line_of_work', 'GrandName2', 'GrandName', 'GrandParent'),
                level: text('UnitLevelName', 'UnitLevel', 'level'),
                business_unit: text('BGName', 'business_unit', 'BGNo'),

                frame_staff_21: frameStaffLevels[0],
                frame_staff_18_20: frameStaffLevels[1],
                frame_staff_16_17: frameStaffLevels[2],
                frame_staff_14_15: frameStaffLevels[3],
                frame_staff_11_13: frameStaffLevels[4],
                frame_staff_9_10: frameStaffLevels[5],
                frame_staff_under_8: frameStaffLevels[6],
                frame_staff_total: frameStaffTotal,

                frame_staff_21_change: frameStaffDiffLevels[0],
                frame_staff_18_20_change: frameStaffDiffLevels[1],
                frame_staff_16_17_change: frameStaffDiffLevels[2],
                frame_staff_14_15_change: frameStaffDiffLevels[3],
                frame_staff_11_13_change: frameStaffDiffLevels[4],
                frame_staff_9_10_change: frameStaffDiffLevels[5],
                frame_staff_under_8_change: frameStaffDiffLevels[6],
                frame_staff_total_change: frameStaffTotalDiff,

                people_normal_21: peopleNormalLevels[0],
                people_normal_18_20: peopleNormalLevels[1],
                people_normal_16_17: peopleNormalLevels[2],
                people_normal_14_15: peopleNormalLevels[3],
                people_normal_11_13: peopleNormalLevels[4],
                people_normal_9_10: peopleNormalLevels[5],
                people_normal_under_8: peopleNormalLevels[6],
                people_normal_total: peopleNormalTotal,

                people_normal_21_change: peopleNormalDiffLevels[0],
                people_normal_18_20_change: peopleNormalDiffLevels[1],
                people_normal_16_17_change: peopleNormalDiffLevels[2],
                people_normal_14_15_change: peopleNormalDiffLevels[3],
                people_normal_11_13_change: peopleNormalDiffLevels[4],
                people_normal_9_10_change: peopleNormalDiffLevels[5],
                people_normal_under_8_change: peopleNormalDiffLevels[6],
                people_normal_total_change: peopleNormalTotalDiff,

                frame_sec_21: frameSecLevels[0],
                frame_sec_18_20: frameSecLevels[1],
                frame_sec_16_17: frameSecLevels[2],
                frame_sec_14_15: frameSecLevels[3],
                frame_sec_11_13: frameSecLevels[4],
                frame_sec_9_10: frameSecLevels[5],
                frame_sec_under_8: frameSecLevels[6],
                frame_sec_total: frameSecTotal,

                frame_sec_21_change: frameSecDiffLevels[0],
                frame_sec_18_20_change: frameSecDiffLevels[1],
                frame_sec_16_17_change: frameSecDiffLevels[2],
                frame_sec_14_15_change: frameSecDiffLevels[3],
                frame_sec_11_13_change: frameSecDiffLevels[4],
                frame_sec_9_10_change: frameSecDiffLevels[5],
                frame_sec_under_8_change: frameSecDiffLevels[6],
                frame_sec_total_change: frameSecTotalDiff,

                people_sec_21: peopleSecLevels[0],
                people_sec_18_20: peopleSecLevels[1],
                people_sec_16_17: peopleSecLevels[2],
                people_sec_14_15: peopleSecLevels[3],
                people_sec_11_13: peopleSecLevels[4],
                people_sec_9_10: peopleSecLevels[5],
                people_sec_under_8: peopleSecLevels[6],
                people_sec_total: peopleSecTotal,

                people_sec_21_change: peopleSecDiffLevels[0],
                people_sec_18_20_change: peopleSecDiffLevels[1],
                people_sec_16_17_change: peopleSecDiffLevels[2],
                people_sec_14_15_change: peopleSecDiffLevels[3],
                people_sec_11_13_change: peopleSecDiffLevels[4],
                people_sec_9_10_change: peopleSecDiffLevels[5],
                people_sec_under_8_change: peopleSecDiffLevels[6],
                people_sec_total_change: peopleSecTotalDiff,

                total_frame_normal: totalFrameNormal,
                total_frame_pool: totalFramePool,
                total_frame_trad: totalFrameTrad,
                total_frame_newbiz: totalFrameNewbiz,
                total_frame_total: totalFrameTotal,

                total_frame_normal_change: totalFrameNormalDiff,
                total_frame_pool_change: totalFramePoolDiff,
                total_frame_trad_change: totalFrameTradDiff,
                total_frame_newbiz_change: totalFrameNewbizDiff,
                total_frame_total_change: totalFrameTotalDiff,

                total_people_normal: totalPeopleNormal,
                total_people_pool: totalPeoplePool,
                total_people_trad: totalPeopleTrad,
                total_people_newbiz: totalPeopleNewbiz,
                total_people_total: totalPeopleTotal,

                total_people_normal_change: totalPeopleNormalDiff,
                total_people_pool_change: totalPeoplePoolDiff,
                total_people_trad_change: totalPeopleTradDiff,
                total_people_newbiz_change: totalPeopleNewbizDiff,
                total_people_total_change: totalPeopleTotalDiff,

                recruit_total: recruitAmount,
                recruit_total_change: 0,

                vacancy_21: vacancyLevels[0],
                vacancy_18_20: vacancyLevels[1],
                vacancy_16_17: vacancyLevels[2],
                vacancy_14_15: vacancyLevels[3],
                vacancy_11_13: vacancyLevels[4],
                vacancy_9_10: vacancyLevels[5],
                vacancy_under_8: vacancyLevels[6],
                vacancy_total: num('Vacant_Total', 'Blank_Amount', 'Vacancy_Total') || vacancyTotal,

                vacancy_21_change: vacancyDiffLevels[0],
                vacancy_18_20_change: vacancyDiffLevels[1],
                vacancy_16_17_change: vacancyDiffLevels[2],
                vacancy_14_15_change: vacancyDiffLevels[3],
                vacancy_11_13_change: vacancyDiffLevels[4],
                vacancy_9_10_change: vacancyDiffLevels[5],
                vacancy_under_8_change: vacancyDiffLevels[6],
                vacancy_total_change: num('TBlank_Amount', 'TVacancy_Total') || vacancyTotalDiff,

                contact_out: num('Q_Contact', 'q_contact'),
                contact_out_change: 0,
                contact_out_sub: num('Q_SubContact', 'q_subcontact'),
                contact_out_sub_change: 0,

                remark: text('remark', 'Remark', 'Note'),
                log: text('note', 'new_note', 'TransactionDesc', 'log')
            };
        }).filter((row) => row.unit_code || row.unit_name || row.unit_short);
    } catch (error) {
        console.error('Error in getReport04DataService:', error);
        throw error;
    }
};

export const getReport05DataService = async (
    fromDateStr: string,
    toDateStr: string,
    employeeId: string,
    userGroupNo: string,
    division: string,
    orgUnitNo: string
) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();
        const selectedDivisionValues = splitCsvValues(division);
        const selectedOrgUnitValues = splitCsvValues(orgUnitNo);

        const fromDate = new Date(fromDateStr);
        const toDate = new Date(toDateStr);

        request.input('FromDate', sql.DateTime, fromDate);
        request.input('ToDate', sql.DateTime, toDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNO', sql.VarChar(2), userGroupNo || null);
        request.input('OrgUnitNo', sql.VarChar(8), singleOrNull(selectedOrgUnitValues));
        request.input('Division', sql.VarChar(8), singleOrNull(selectedDivisionValues));

        const result = await request.execute('mp_ReportActualManMonthly');
        const rows = Array.isArray(result.recordset) ? result.recordset : [];
        const selectedDivisionSet = selectedDivisionValues.length > 0 ? new Set(selectedDivisionValues) : null;
        const selectedOrgUnitSet = selectedOrgUnitValues.length > 0 ? new Set(selectedOrgUnitValues) : null;

        const filteredRows = rows.filter((rawRow) => {
            const row = (rawRow && typeof rawRow === 'object') ? (rawRow as Record<string, unknown>) : {};
            const { text } = buildRowAccessor(row);

            const rowDivision = text(
                'ParentOrgUnitNo',
                'line_of_work',
                'GrandName2',
                'GrandName',
                'GrandParent',
                'SecUnitDummy',
                'Division',
                'OrgUnitLine',
                'LineCode',
                'LineNo'
            );
            const rowOrgUnit = text('OrgUnitNo', 'org_unit_no', 'unit_code');

            return (
                matchesSelectedSet(selectedDivisionSet, [rowDivision]) &&
                matchesSelectedSet(selectedOrgUnitSet, [rowOrgUnit])
            );
        });

        let lastUnitShort = '';
        let lastUnitCode = '';
        let lastUnitName = '';
        let lastLineCode = '';
        let lastLineOfWork = '';
        let lastBusinessCode = '';
        let lastBusinessUnit = '';
        let lastDataset = 'ปกติ';

        return filteredRows.map((rawRow, index) => {
                const row = (rawRow && typeof rawRow === 'object') ? (rawRow as Record<string, unknown>) : {};
                const { num, text } = buildRowAccessor(row);

                const frame21 = num('amount1', 'q_21');
                const frame1820 = num('amount2', 'q_18_20');
                const frame1617 = num('amount3', 'q_16_17');
                const frame1415 = num('amount4', 'q_14_15');
                const frame1113 = num('amount5', 'q_11_13');
                const frame910 = num('amount6', 'q_9_10');
                const frameUnder8 = num('amount7', 'q_8', 'q_4_8');
                const total = num('tamount', 'amount', 'total_amount') || (
                    frame21 +
                    frame1820 +
                    frame1617 +
                    frame1415 +
                    frame1113 +
                    frame910 +
                    frameUnder8
                );

                const unitShortRaw = text('UnitAbbr', 'DisplayName', 'unit_short');
                const unitCodeRaw = text('OrgUnitNo', 'unit_code');
                const unitNameRaw = text('UnitName', 'unit_name', 'UnitAbbr', 'DisplayName');
                const lineCodeRaw = text('ParentOrgUnitNo', 'line_of_work_code', 'parent_org_unit_no');
                const lineOfWorkRaw = text('line_of_work', 'ParentOrgUnitNo', 'GrandName2', 'GrandName', 'GrandParent', 'SecUnitDummy');
                const businessCodeRaw = text('BGNo', 'bg_no', 'business_unit_code');
                const businessUnitRaw = text('business_unit', 'BGName', 'BGNo');
                const operatorRaw = text('CreateByName', 'operator');
                const datasetSource = row.typecal ?? row.TypeCal;
                const hasDatasetSource = datasetSource !== undefined && datasetSource !== null && datasetSource !== '';

                const unit_short = unitShortRaw || lastUnitShort;
                const unit_code = unitCodeRaw || lastUnitCode;
                const unit_name = unitNameRaw || lastUnitName;
                const line_of_work_code = lineCodeRaw || lastLineCode;
                const line_of_work = lineOfWorkRaw || lastLineOfWork;
                const business_unit_code = businessCodeRaw || lastBusinessCode;
                const business_unit = businessUnitRaw || lastBusinessUnit;
                const operator = operatorRaw;
                const dataset = hasDatasetSource ? mapTypecalToDataset(datasetSource) : lastDataset;

                if (unitShortRaw) lastUnitShort = unitShortRaw;
                if (unitCodeRaw) lastUnitCode = unitCodeRaw;
                if (unitNameRaw) lastUnitName = unitNameRaw;
                if (lineCodeRaw) lastLineCode = lineCodeRaw;
                if (lineOfWorkRaw) lastLineOfWork = lineOfWorkRaw;
                if (businessCodeRaw) lastBusinessCode = businessCodeRaw;
                if (businessUnitRaw) lastBusinessUnit = businessUnitRaw;
                if (hasDatasetSource) lastDataset = dataset;

                return {
                    key: `r5-${index + 1}`,
                    unit_short,
                    unit_code,
                    unit_name,
                    date: toDisplayDate(row.EffectiveDate ?? row.effectivedate),
                    frame_21: frame21,
                    frame_18_20: frame1820,
                    frame_16_17: frame1617,
                    frame_14_15: frame1415,
                    frame_11_13: frame1113,
                    frame_9_10: frame910,
                    frame_under_8: frameUnder8,
                    frame_total: total,
                    operator,
                    remark: text('remark', 'Remark', 'note'),
                    log: text('log', 'new_note', 'TransactionDesc'),
                    line_of_work_code,
                    line_of_work,
                    business_unit_code,
                    business_unit,
                    dataset
                };
            });
    } catch (error) {
        console.error('Error in getReport05DataService:', error);
        throw error;
    }
};

export const getReport06DataService = async (
    effectiveDateStr: string,
    employeeId: string,
    userGroupNo: string,
    division: string,
    bgNo: string
) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();
        const effectiveDate = new Date(effectiveDateStr);

        request.input('Effectivedate', sql.DateTime, effectiveDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNO', sql.VarChar(2), userGroupNo);

        const result = await request.execute('mp_ReportActualMovement_Effectivedate');
        const rows = Array.isArray(result.recordset) ? result.recordset : [];

        return rows.map((rawRow, index) => {
            const row = (rawRow && typeof rawRow === 'object') ? (rawRow as Record<string, unknown>) : {};
            const { num, text } = buildRowAccessor(row);

            // --- กรอบ breakdown ---
            const qn_1 = num('quota_n_1'); const qn_2 = num('quota_n_2'); const qn_3 = num('quota_n_3'); const qn_4 = num('quota_n_4');
            const qn_5 = num('quota_n_5'); const qn_6 = num('quota_n_6'); const qn_7 = num('quota_n_7'); const qn_total = num('quota_n_total');
            const qp_1 = num('quota_p_1'); const qp_2 = num('quota_p_2'); const qp_3 = num('quota_p_3'); const qp_4 = num('quota_p_4');
            const qp_5 = num('quota_p_5'); const qp_6 = num('quota_p_6'); const qp_7 = num('quota_p_7'); const qp_total = num('quota_p_total');
            const qs_1 = num('quota_s_1'); const qs_2 = num('quota_s_2'); const qs_3 = num('quota_s_3'); const qs_4 = num('quota_s_4');
            const qs_5 = num('quota_s_5'); const qs_6 = num('quota_s_6'); const qs_7 = num('quota_s_7'); const qs_total = num('quota_s_total');

            // --- คน breakdown ---
            const mn_1 = num('actual_n_1'); const mn_2 = num('actual_n_2'); const mn_3 = num('actual_n_3'); const mn_4 = num('actual_n_4');
            const mn_5 = num('actual_n_5'); const mn_6 = num('actual_n_6'); const mn_7 = num('actual_n_7'); const mn_total = num('actual_n_total');
            const mp_1 = num('actual_p_1'); const mp_2 = num('actual_p_2'); const mp_3 = num('actual_p_3'); const mp_4 = num('actual_p_4');
            const mp_5 = num('actual_p_5'); const mp_6 = num('actual_p_6'); const mp_7 = num('actual_p_7'); const mp_total = num('actual_p_total');
            const ms_1 = num('actual_s_1'); const ms_2 = num('actual_s_2'); const ms_3 = num('actual_s_3'); const ms_4 = num('actual_s_4');
            const ms_5 = num('actual_s_5'); const ms_6 = num('actual_s_6'); const ms_7 = num('actual_s_7'); const ms_total = num('actual_s_total');

            // Combined totals (backward compat for Report 7: q = ปกติ+Pool, ไม่รวม Sec)
            const q_1 = qn_1 + qp_1; const q_2 = qn_2 + qp_2; const q_3 = qn_3 + qp_3; const q_4 = qn_4 + qp_4;
            const q_5 = qn_5 + qp_5; const q_6 = qn_6 + qp_6; const q_7 = qn_7 + qp_7; const q_total = qn_total + qp_total;
            const m_1 = mn_1 + mp_1; const m_2 = mn_2 + mp_2; const m_3 = mn_3 + mp_3; const m_4 = mn_4 + mp_4;
            const m_5 = mn_5 + mp_5; const m_6 = mn_6 + mp_6; const m_7 = mn_7 + mp_7; const m_total = mn_total + mp_total;

            const f_amount = num('f_amount');

            return {
                key: `r6-${index + 1}`,
                org_unit_no: text('OrgUnitNo'),
                parent_org_unit_no: text('ParentOrgUnitNo'),
                lvl: num('Lvl'),
                bg_no: text('BGNo'),
                business_unit: text('BGName', 'BGNo'),
                unit_level: text('UnitLevel'),
                unit_level_name: text('UnitLevelName'),
                unit_short: text('UnitAbbr', 'UnitShort'),
                unit_name: text('UnitName'),

                // --- Combined (backward compat) ---
                q_1, m_1, f_1: 0, t_1: q_1 - m_1,
                q_2, m_2, f_2: 0, t_2: q_2 - m_2,
                q_3, m_3, f_3: 0, t_3: q_3 - m_3,
                q_4, m_4, f_4: 0, t_4: q_4 - m_4,
                q_5, m_5, f_5: 0, t_5: q_5 - m_5,
                q_6, m_6, f_6: 0, t_6: q_6 - m_6,
                q_7, m_7, f_7: 0, t_7: q_7 - m_7,
                q_total, m_total,
                f_total: f_amount,
                total: q_total - m_total - f_amount,
                q_8: num('q_contact'),
                q_10: num('q_subcontact'),

                // --- กรอบ ปกติ ---
                qn_1, qn_2, qn_3, qn_4, qn_5, qn_6, qn_7, qn_total,
                // --- กรอบ Pool ---
                qp_1, qp_2, qp_3, qp_4, qp_5, qp_6, qp_7, qp_total,
                // --- กรอบ Sec ---
                qs_1, qs_2, qs_3, qs_4, qs_5, qs_6, qs_7, qs_total,
                // --- คน ปกติ ---
                mn_1, mn_2, mn_3, mn_4, mn_5, mn_6, mn_7, mn_total,
                // --- คน Pool ---
                mp_1, mp_2, mp_3, mp_4, mp_5, mp_6, mp_7, mp_total,
                // --- คน Sec ---
                ms_1, ms_2, ms_3, ms_4, ms_5, ms_6, ms_7, ms_total,

                remark: text('TransactionDesc', 'note', 'remark')
            };
        });
    } catch (error) {
        console.error('Error in getReport06DataService:', error);
        throw error;
    }
};

const safeRatio = (numerator: number, denominator: number): number => {
    if (!Number.isFinite(denominator) || denominator === 0) return 0;
    return numerator / denominator;
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const getReport07DataService = async (
    effectiveDateStr: string,
    employeeId: string,
    userGroupNo: string,
    division: string,
    bgNo: string
) => {
    try {
        const selectedDivisionValues = splitCsvValues(division);
        const selectedBgValues = splitCsvValues(bgNo);
        const selectedDivisionSet = selectedDivisionValues.length > 0 ? new Set(selectedDivisionValues) : null;
        const selectedBgSet = selectedBgValues.length > 0 ? new Set(selectedBgValues) : null;

        const baseRows = await getReport06DataService(effectiveDateStr, employeeId, userGroupNo, division, bgNo);
        const effectiveDate = new Date(effectiveDateStr);
        const pool = await poolPromise;

        const bgNameRequest = pool.request();
        bgNameRequest.input('EffectiveDate', sql.DateTime, effectiveDate);
        const bgNameRes = await bgNameRequest.query(`
            SELECT BGNo, BGName
            FROM MP_BG
            WHERE @EffectiveDate BETWEEN BeginDate AND EndDate
        `);
        const bgNameMap = new Map<string, string>();
        const bgRows = Array.isArray(bgNameRes.recordset) ? bgNameRes.recordset : [];
        bgRows.forEach((raw) => {
            const row = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
            const { text } = buildRowAccessor(row);
            const code = text('BGNo');
            const name = text('BGName');
            if (!code || !name) return;
            bgNameMap.set(code, name);
        });

        const request = pool.request();
        request.input('EffectiveDate', sql.DateTime, effectiveDate);

        const landscapeRes = await request.query(`
            WITH ranked AS (
                SELECT
                    OrgUnitNo,
                    CAST(vp AS decimal(18,4)) AS vp,
                    CAST(dm AS decimal(18,4)) AS dm,
                    CAST(sr AS decimal(18,4)) AS sr,
                    CAST(jr AS decimal(18,4)) AS jr,
                    BeginDate,
                    EndDate,
                    ROW_NUMBER() OVER (
                        PARTITION BY OrgUnitNo
                        ORDER BY BeginDate DESC, EndDate DESC
                    ) AS rn
                FROM MP_Landscape
                WHERE @EffectiveDate BETWEEN BeginDate AND EndDate
            )
            SELECT OrgUnitNo, vp, dm, sr, jr
            FROM ranked
            WHERE rn = 1
        `);

        const landscapeMap = new Map<string, { vp: number; dm: number; sr: number; jr: number }>();
        let defaultLandscape: { vp: number; dm: number; sr: number; jr: number } | null = null;
        const landscapeRows = Array.isArray(landscapeRes.recordset) ? landscapeRes.recordset : [];
        landscapeRows.forEach((raw) => {
            const row = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
            const { num, text } = buildRowAccessor(row);
            const orgUnitNo = text('OrgUnitNo');
            const landscapeValue = {
                vp: num('vp'),
                dm: num('dm'),
                sr: num('sr'),
                jr: num('jr')
            };

            // Business rule: if OrgUnitNo is empty in MP_Landscape,
            // that row is treated as default for all units.
            if (!orgUnitNo) {
                defaultLandscape = landscapeValue;
                return;
            }

            landscapeMap.set(orgUnitNo, landscapeValue);
        });

        const enrichedRows = baseRows.map((rawRow) => {
            const row = (rawRow && typeof rawRow === 'object') ? (rawRow as Record<string, unknown>) : {};
            const orgUnitNo = toTrimText(row.org_unit_no);
            const bgNoCode = toTrimText(row.bg_no);
            const landscape = landscapeMap.get(orgUnitNo) || defaultLandscape;

            const q4 = toNumberOrZero(row.q_4);
            const q5 = toNumberOrZero(row.q_5);
            const q6 = toNumberOrZero(row.q_6);
            const q7 = toNumberOrZero(row.q_7);
            const qTotal = toNumberOrZero(row.q_total);
            const contractOut = toNumberOrZero(row.q_8);

            const mpVp = landscape?.vp ?? 0;
            const mpDm = landscape?.dm ?? 0;
            const mpSr = landscape?.sr ?? 0;
            const mpJr = landscape?.jr ?? 0;
            const mpTotal = mpVp + mpDm + mpSr + mpJr;

            // Formula from "To be" draft:
            // shape_vp = vp
            // shape_dm = (dm/(dm+sr+jr)) * (q_5+q_6+q_7)
            // shape_sr = (sr/(sr+jr+mp_total)) * (q_7+q_total)
            // shape_jr = (jr/(jr+mp_total+shape_vp)) * (q_6+q_total+contract_out)
            const shapeVp = mpVp;
            const shapeDm = safeRatio(mpDm, mpDm + mpSr + mpJr) * (q5 + q6 + q7);
            const shapeSr = safeRatio(mpSr, mpSr + mpJr + mpTotal) * (q7 + qTotal);
            const shapeJr = safeRatio(mpJr, mpJr + mpTotal + shapeVp) * (q6 + qTotal + contractOut);
            const shapeTotal = shapeVp + shapeDm + shapeSr + shapeJr;

            // %Gap formula from draft:
            // gap_vp = (q_4-shape_vp)/shape_vp
            // gap_dm = (0-shape_dm)/shape_dm
            // gap_sr = (q_5-shape_sr)/shape_sr
            // gap_jr = (0-shape_jr)/shape_jr
            // gap_total = (q_6-shape_total)/shape_total
            const gapVp = safeRatio(q4 - shapeVp, shapeVp);
            const gapDm = safeRatio(0 - shapeDm, shapeDm);
            const gapSr = safeRatio(q5 - shapeSr, shapeSr);
            const gapJr = safeRatio(0 - shapeJr, shapeJr);
            const gapTotal = safeRatio(q6 - shapeTotal, shapeTotal);

            return {
                ...row,
                business_unit: bgNameMap.get(bgNoCode) || toTrimText(row.business_unit) || bgNoCode,
                frame_contract_out: contractOut,
                frame_sub_contract: toNumberOrZero(row.q_10),
                recruit_total: toNumberOrZero(row.f_total),
                vacancy_total: toNumberOrZero(row.total),
                mp_vp: round2(mpVp),
                mp_dm: round2(mpDm),
                mp_sr: round2(mpSr),
                mp_jr: round2(mpJr),
                mp_total: round2(mpTotal),
                shape_vp: round2(shapeVp),
                shape_dm: round2(shapeDm),
                shape_sr: round2(shapeSr),
                shape_jr: round2(shapeJr),
                shape_total: round2(shapeTotal),
                gap_vp: round2(gapVp),
                gap_dm: round2(gapDm),
                gap_sr: round2(gapSr),
                gap_jr: round2(gapJr),
                gap_total: round2(gapTotal)
            };
        });

        return enrichedRows.filter((row) => {
            const raw = row as Record<string, unknown>;
            return (
                matchesSelectedSet(selectedBgSet, [raw.bg_no]) &&
                matchesSelectedSet(selectedDivisionSet, [raw.parent_org_unit_no])
            );
        });
    } catch (error) {
        console.error('Error in getReport07DataService:', error);
        throw error;
    }
};

export const getReport08DataService = async (
    fromDateStr: string,
    toDateStr: string,
    employeeId: string,
    userGroupNo: string,
    structureDateStr?: string,
    bgNo?: string,
    division?: string
) => {
    try {
        const pool = await poolPromise;
        const fromDate = new Date(fromDateStr);
        const toDate = new Date(toDateStr);
        const structureDate = new Date(structureDateStr || toDateStr);
        const selectedBgValues = splitCsvValues(bgNo || '');
        const selectedDivisionValues = splitCsvValues(division || '');
        const selectedBgCodeSet = selectedBgValues.length > 0 ? new Set(selectedBgValues) : null;
        const selectedDivisionSet = selectedDivisionValues.length > 0 ? new Set(selectedDivisionValues) : null;

        const structureReq = pool.request();
        structureReq.input('Effectivedate', sql.DateTime, structureDate);
        structureReq.input('EmployeeID', sql.VarChar(8), employeeId);
        structureReq.input('UserGroupNo', sql.VarChar(2), userGroupNo || null);

        const structureRes = await structureReq.execute('mp_Report01Get');
        const flatRows = Array.isArray(structureRes.recordset) ? structureRes.recordset : [];

        const bgNameByCode = new Map<string, string>();
        if (selectedBgValues.length > 0) {
            const bgReq = pool.request();
            bgReq.input('EffectiveDate', sql.DateTime, structureDate);
            const bgRes = await bgReq.query(`
                SELECT BGNo, BGName
                FROM MP_BG
                WHERE @EffectiveDate BETWEEN BeginDate AND EndDate
            `);
            const bgRows = Array.isArray(bgRes.recordset) ? bgRes.recordset : [];
            bgRows.forEach((raw) => {
                const row = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
                const code = toTrimText(row.BGNo);
                const name = toTrimText(row.BGName);
                if (!code || !name) return;
                bgNameByCode.set(code, name);
            });
        }
        const selectedBgNameSet = selectedBgValues.length > 0
            ? new Set(
                selectedBgValues
                    .map((code) => bgNameByCode.get(code) || '')
                    .map((name) => toTrimText(name))
                    .filter((name) => name.length > 0)
            )
            : null;

        const getRowText = (row: Record<string, unknown>, ...aliases: string[]) => {
            const lowerMap = new Map<string, unknown>();
            Object.entries(row).forEach(([key, value]) => lowerMap.set(key.toLowerCase(), value));
            for (const alias of aliases) {
                const value = lowerMap.get(alias.toLowerCase());
                if (value !== undefined && value !== null && value !== '') {
                    return toTrimText(value);
                }
            }
            return '';
        };

        const filteredRows = flatRows.filter((rawRow) => {
            const row = (rawRow && typeof rawRow === 'object') ? (rawRow as Record<string, unknown>) : {};
            const rowBgNo = getRowText(row, 'BGNo', 'bg_no', 'bgNo');
            const rowBgName = getRowText(row, 'BGName', 'business_unit', 'Group1', 'group1');
            const rowDivision = getRowText(
                row,
                'SecUnitDummy',
                'ParentOrgUnitNo',
                'line_of_work',
                'Division',
                'OrgUnitLine',
                'LineCode',
                'LineNo',
                'OrgUnitNo'
            );

            const rowBgNameFromCode = rowBgNo ? (bgNameByCode.get(rowBgNo) || '') : '';
            const matchBg =
                (!selectedBgCodeSet && !selectedBgNameSet) ||
                matchesSelectedSet(selectedBgCodeSet, [rowBgNo]) ||
                matchesSelectedSet(selectedBgNameSet, [rowBgName, rowBgNameFromCode]);
            const matchDivision = matchesSelectedSet(selectedDivisionSet, [rowDivision]);
            return matchBg && matchDivision;
        });

        const [positionMap, costMap] = await Promise.all([
            getReport08PositionMap(pool, structureDate),
            getReport08CostMap(pool, fromDate, toDate)
        ]);

        return buildReport08Tree(filteredRows, positionMap, costMap);
    } catch (error) {
        console.error('Error in getReport08DataService:', error);
        throw error;
    }
};

const buildReport09Years = (effectiveYear: number): number[] =>
    Array.from({ length: 5 }, (_, idx) => effectiveYear + idx);

const normalizeReport09OrgUnitKey = (value: unknown): string => {
    const raw = toTrimText(value);
    if (!raw) return '';
    // Business rule from user/domain: OrgUnitNo = OrgUnitID.
    // Keep exact code (trim only), do not strip prefix digits or reformat.
    return raw;
};

const createEmptyReport09Node = (displayYears: number[]) => {
    const node: Record<string, number> = {
        cut_support: 0,
        cut_bu: 0,
        cut_total: 0
    };

    displayYears.forEach((year) => {
        node[`y${year}_sup`] = 0;
        node[`y${year}_bu`] = 0;
    });

    return node;
};

const getReport09OrgUnitNo = (row: Record<string, unknown>): string => {
    const { text } = buildRowAccessor(row);
    const direct = text(
        'OrgUnitID',
        'orgunitid',
        'OrgUnitNo',
        'orgunitno',
        'OrgUnitNO',
        'UnitNo',
        'unitno'
    );

    if (direct) return normalizeReport09OrgUnitKey(direct);

    return '';
};

const getReport09RetirementMap = async (
    pool: any,
    effectiveYear: number,
    structureDate: Date,
    structureIsSecondment: number | null
): Promise<Report09OrgYearMap> => {
    const displayYears = buildReport09Years(effectiveYear);
    const fromYear = displayYears[0];
    const toYear = displayYears[displayYears.length - 1];

    const infoMeta = await getTableMeta(pool, REPORT09_INFO_TABLE_CANDIDATES);
    const positionMeta = await getTableMeta(pool, REPORT09_POSITION_TABLE_CANDIDATES);
    if (!infoMeta || !positionMeta) return new Map();

    const retireYearCol = pickColumnName(infoMeta.columns, REPORT09_RETIRE_YEAR_COL_CANDIDATES);
    const infoPosCol = pickColumnName(infoMeta.columns, REPORT09_INFO_POSITION_COL_CANDIDATES);
    const positionIdCol = pickColumnName(positionMeta.columns, REPORT09_POSITION_ID_COL_CANDIDATES);
    const orgCol = pickColumnName(positionMeta.columns, REPORT09_ORG_COL_CANDIDATES);
    const bsTypeCol = pickColumnName(positionMeta.columns, REPORT09_BS_TYPE_COL_CANDIDATES);
    if (!retireYearCol || !infoPosCol || !positionIdCol || !orgCol || !bsTypeCol) return new Map();

    const signPosCol = pickColumnName(positionMeta.columns, REPORT09_SIGN_POS_COL_CANDIDATES);
    const employeeCol = pickColumnName(positionMeta.columns, REPORT09_EMPLOYEE_COL_CANDIDATES);

    const signPosCondition = signPosCol
        ? `AND TRY_CONVERT(int, pos.${escapeSqlIdentifier(signPosCol)}) = 100`
        : '';
    const countExpr = employeeCol
        ? `COUNT(DISTINCT LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(employeeCol)} AS nvarchar(64)))))`
        : 'COUNT(1)';

    const orgKeyExpr = structureIsSecondment === 0
        ? `
            CASE
                WHEN ISNULL(unit.IsSecondment, 0) = 1
                     AND rt.Reportto IS NOT NULL
                     AND LTRIM(RTRIM(CAST(rt.Reportto AS nvarchar(32)))) <> ''
                    THEN LTRIM(RTRIM(CAST(rt.Reportto AS nvarchar(32))))
                ELSE LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(orgCol)} AS nvarchar(32))))
            END
        `
        : `LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(orgCol)} AS nvarchar(32))))`;

    const joinStructureForMapping = structureIsSecondment === 0
        ? `
        LEFT JOIN InterfaceUnit unit
            ON LTRIM(RTRIM(CAST(unit.OrgUnitNo AS nvarchar(32)))) =
               LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(orgCol)} AS nvarchar(32))))
           AND @EffectiveDate BETWEEN unit.BeginDate AND unit.EndDate
        LEFT JOIN MP_Reportto rt
            ON LTRIM(RTRIM(CAST(rt.OrgUnitNo AS nvarchar(32)))) =
               LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(orgCol)} AS nvarchar(32))))
           AND @EffectiveDate BETWEEN rt.BeginDate AND rt.EndDate
        `
        : '';

    const query = `
        SELECT
            ${orgKeyExpr} AS org_unit_id,
            TRY_CONVERT(int, info.${escapeSqlIdentifier(retireYearCol)}) AS retire_year,
            CASE WHEN TRY_CONVERT(int, pos.${escapeSqlIdentifier(bsTypeCol)}) = 2 THEN 2 ELSE 1 END AS bs_type,
            ${countExpr} AS retire_count
        FROM ${infoMeta.fullName} info
        INNER JOIN ${positionMeta.fullName} pos
            ON LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) =
               LTRIM(RTRIM(CAST(info.${escapeSqlIdentifier(infoPosCol)} AS nvarchar(64))))
        ${joinStructureForMapping}
        WHERE TRY_CONVERT(int, info.${escapeSqlIdentifier(retireYearCol)}) BETWEEN @FromYear AND @ToYear
          AND TRY_CONVERT(int, pos.${escapeSqlIdentifier(bsTypeCol)}) IN (1, 2)
          AND ${orgKeyExpr} <> ''
          ${signPosCondition}
        GROUP BY
            ${orgKeyExpr},
            TRY_CONVERT(int, info.${escapeSqlIdentifier(retireYearCol)}),
            CASE WHEN TRY_CONVERT(int, pos.${escapeSqlIdentifier(bsTypeCol)}) = 2 THEN 2 ELSE 1 END
    `;

    const result = await pool.request()
        .input('FromYear', sql.Int, fromYear)
        .input('ToYear', sql.Int, toYear)
        .input('EffectiveDate', sql.DateTime, structureDate)
        .query(query);

    const rows = Array.isArray(result.recordset) ? result.recordset as Array<Record<string, unknown>> : [];
    const map: Report09OrgYearMap = new Map();

    rows.forEach((row) => {
        const orgUnitId = normalizeReport09OrgUnitKey(row.org_unit_id);
        const retireYear = toNumberOrZero(row.retire_year);
        const bsType = toNumberOrZero(row.bs_type) === 2 ? 2 : 1;
        const count = toNumberOrZero(row.retire_count);
        if (!orgUnitId || !retireYear || count <= 0) return;

        if (!map.has(orgUnitId)) map.set(orgUnitId, new Map());
        const perOrg = map.get(orgUnitId)!;
        const current = perOrg.get(retireYear) || { support: 0, bu: 0 };

        if (bsType === 2) current.support += count;
        else current.bu += count;

        perOrg.set(retireYear, current);
    });

    return map;
};

const getReport09OrgYearValue = (
    sourceMap: Report09OrgYearMap,
    orgUnitId: string,
    year: number
) => {
    const byOrg = sourceMap.get(orgUnitId);
    if (!byOrg) return { support: 0, bu: 0 };
    return byOrg.get(year) || { support: 0, bu: 0 };
};

const buildReport09FallbackTree = (
    sourceMap: Report09OrgYearMap,
    displayYears: number[]
) => {
    const rows = Array.from(sourceMap.entries())
        .map(([orgUnitId]) => {
            const row: Record<string, unknown> = {
                key: `org-${orgUnitId}`,
                unit: orgUnitId,
                ...createEmptyReport09Node(displayYears)
            };

            let cutSupport = 0;
            let cutBu = 0;
            displayYears.forEach((year) => {
                const values = getReport09OrgYearValue(sourceMap, orgUnitId, year);
                row[`y${year}_sup`] = values.support;
                row[`y${year}_bu`] = values.bu;
                cutSupport += values.support;
                cutBu += values.bu;
            });

            row.cut_support = cutSupport;
            row.cut_bu = cutBu;
            row.cut_total = cutSupport + cutBu;
            return row;
        })
        .sort((a, b) => toTrimText(a.unit).localeCompare(toTrimText(b.unit), 'th'));

    const grandTotal: Record<string, unknown> = {
        key: 'total',
        unit: 'รวมทุกธุรกิจ',
        ...createEmptyReport09Node(displayYears)
    };

    rows.forEach((row) => sumNode(grandTotal, row));
    rows.push(grandTotal);
    return rows;
};

const buildReport09Tree = (
    flatData: any[],
    sourceMap: Report09OrgYearMap,
    displayYears: number[]
) => {
    const resultTree: any[] = [];
    const group1Map = new Map<string, any>();
    const group2Map = new Map<string, any>();
    const group3Map = new Map<string, any>();
    let keyCounter = 1;

    flatData.forEach((raw) => {
        const row = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
        const bgName = toTrimText(row.GroupBGName);
        if (!bgName) return;

        const grandParent = toTrimText(row.GrandParent);
        const grandParent2 = toTrimText(row.GrandParent2);
        const orgUnitId = getReport09OrgUnitNo(row);

        const leafData: Record<string, unknown> = {
            key: `r-${keyCounter++}`,
            unit: toTrimText(row.DisplayName) || toTrimText(row.UnitAbbr) || orgUnitId || '-',
            ...createEmptyReport09Node(displayYears),
            _isHiddenLegacy: row.IsBelongTo == 1 || row.IsBelongTo === true || row.IsBelongTo === '1'
        };

        let cutSupport = 0;
        let cutBu = 0;
        displayYears.forEach((year) => {
            const values = getReport09OrgYearValue(sourceMap, orgUnitId, year);
            leafData[`y${year}_sup`] = values.support;
            leafData[`y${year}_bu`] = values.bu;
            cutSupport += values.support;
            cutBu += values.bu;
        });

        leafData.cut_support = cutSupport;
        leafData.cut_bu = cutBu;
        leafData.cut_total = cutSupport + cutBu;

        if (!group1Map.has(bgName)) {
            const bgNode = {
                key: `bg-${keyCounter++}`,
                unit: bgName,
                ...createEmptyReport09Node(displayYears),
                children: []
            };
            group1Map.set(bgName, bgNode);
            resultTree.push(bgNode);
        }

        let targetNode = group1Map.get(bgName);

        if (grandParent) {
            const group2KeyId = `${bgName}-${grandParent}`;
            if (!group2Map.has(group2KeyId)) {
                const gpNode = {
                    key: `gp-${keyCounter++}`,
                    unit: grandParent,
                    ...createEmptyReport09Node(displayYears),
                    children: []
                };
                group2Map.set(group2KeyId, gpNode);
                targetNode.children.push(gpNode);
            }
            targetNode = group2Map.get(group2KeyId);

            if (grandParent2 && grandParent2 !== grandParent) {
                const group3KeyId = `${bgName}-${grandParent}-${grandParent2}`;
                if (!group3Map.has(group3KeyId)) {
                    const gp2Node = {
                        key: `gp2-${keyCounter++}`,
                        unit: grandParent2,
                        ...createEmptyReport09Node(displayYears),
                        children: []
                    };
                    group3Map.set(group3KeyId, gp2Node);
                    targetNode.children.push(gp2Node);
                }
                targetNode = group3Map.get(group3KeyId);
            }
        }

        targetNode.children.push(leafData);
    });

    const sumTotalRecursive = (node: any) => {
        if (!node.children || node.children.length === 0) return node;
        node.children.forEach((child: any) => sumTotalRecursive(child));
        node.children.forEach((child: any) => sumNode(node, child));
        return node;
    };
    resultTree.forEach((bgNode) => sumTotalRecursive(bgNode));

    const grandTotal = {
        key: 'total',
        unit: 'รวมทุกธุรกิจ',
        ...createEmptyReport09Node(displayYears)
    };
    resultTree.forEach((node) => sumNode(grandTotal, node));
    resultTree.push(grandTotal);

    // Match Report01 legacy grouping behaviors:
    // - hide specific "ขึ้นตรง" rows when flagged by IsBelongTo
    // - promote single lead-child rows
    // - keep gp/gp2 label styles and flatten one-gp groups
    const cleanupTree = (node: any) => {
        if (!node.children) return;

        for (let i = node.children.length - 1; i >= 0; i--) {
            const childNode = node.children[i];
            if (!childNode.children) continue;

            cleanupTree(childNode);

            childNode.children = childNode.children.filter((grandChild: any) => {
                const childName = String(childNode.unit || '').replace(/ /g, '');
                const grandChildName = String(grandChild.unit || '').replace(/ /g, '');
                const isLeadChild = grandChildName === `${childName}ขึ้นตรง`;
                const isHidden = grandChild._isHiddenLegacy && isLeadChild;
                return !isHidden;
            });

            if (
                childNode.children.length === 1 &&
                String(childNode.children[0].unit || '').replace(/ /g, '') === `${String(childNode.unit || '').replace(/ /g, '')}ขึ้นตรง`
            ) {
                node.children.splice(i, 1, childNode.children[0]);
            } else if (childNode.children.length === 0) {
                delete childNode.children;
                if (childNode.key.startsWith('gp2-')) {
                    childNode.unit = `> ${String(childNode.unit || '').trim()}`;
                } else if (childNode.key.startsWith('gp-')) {
                    childNode.unit = String(childNode.unit || '').trim();
                }
            } else {
                if (childNode.key.startsWith('gp2-')) {
                    childNode.unit = `> ${String(childNode.unit || '').trim()}`;
                }

                const prefix = childNode.key.startsWith('gp2-') ? '→ ' : '> ';
                childNode.children.forEach((grandChild: any) => {
                    const currentName = String(grandChild.unit || '').trim();
                    const originalParentName = String(childNode.unit || '').replace('> ', '').trim();
                    if (currentName.endsWith('ขึ้นตรง') && currentName !== `${originalParentName}ขึ้นตรง`) {
                        grandChild.unit = prefix + currentName.replace('ขึ้นตรง', '');
                    }
                });
            }
        }
    };
    resultTree.forEach((bgNode) => cleanupTree(bgNode));

    // Report01 rule: when a BG has only one gp- group, hide gp header and promote children.
    resultTree.forEach((bgNode) => {
        if (!bgNode.children) return;
        const gpChildren = bgNode.children.filter((c: any) => c.key && c.key.startsWith('gp-'));
        if (gpChildren.length === 1) {
            const gpNode = gpChildren[0];
            if (gpNode.children && gpNode.children.length > 0) {
                const idx = bgNode.children.indexOf(gpNode);
                bgNode.children.splice(idx, 1, ...gpNode.children);
            }
        }
    });

    return resultTree;
};

export const getReport09DataService = async (
    effectiveYear: number,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        const safeEffectiveYear = toNumberOrZero(effectiveYear) || (new Date().getFullYear() + 543);
        const effectiveYearAD = safeEffectiveYear > 2500 ? safeEffectiveYear - 543 : safeEffectiveYear;
        const structureDate = new Date(`${effectiveYearAD}-01-01T00:00:00`);
        const structureIsSecondment = 0;
        const displayYears = buildReport09Years(safeEffectiveYear);
        const pool = await poolPromise;

        const [retirementMap, structureRows] = await Promise.all([
            getReport09RetirementMap(pool, safeEffectiveYear, structureDate, structureIsSecondment),
            (async () => {
                try {
                    const request = pool.request();
                    request.input('Effectivedate', sql.DateTime, structureDate);
                    request.input('EmployeeID', sql.VarChar(8), employeeId);
                    request.input('UserGroupNo', sql.VarChar(2), userGroupNo || null);
                    request.input('IsSecondment', sql.Int, structureIsSecondment);
                    const result = await request.execute('mp_Report09Get');
                    return Array.isArray(result.recordset) ? result.recordset : [];
                } catch (spError) {
                    // Temporary compatibility fallback until mp_Report09Get is deployed in every environment.
                    console.warn('mp_Report09Get unavailable, fallback to mp_Report01Get:', spError);
                    const fallbackRequest = pool.request();
                    fallbackRequest.input('Effectivedate', sql.DateTime, structureDate);
                    fallbackRequest.input('EmployeeID', sql.VarChar(8), employeeId);
                    fallbackRequest.input('UserGroupNo', sql.VarChar(2), userGroupNo || null);
                    const fallbackResult = await fallbackRequest.execute('mp_Report01Get');
                    return Array.isArray(fallbackResult.recordset) ? fallbackResult.recordset : [];
                }
            })()
        ]);

        if (!structureRows.length) {
            return buildReport09FallbackTree(retirementMap, displayYears);
        }

        const tree = buildReport09Tree(structureRows, retirementMap, displayYears);
        if (!tree.length) {
            return buildReport09FallbackTree(retirementMap, displayYears);
        }

        return tree;
    } catch (error) {
        console.error('Error in getReport09DataService:', error);
        throw error;
    }
};

const mapReport10LevelGroup = (unitLevelNo: string, levelName: string): '010' | '020_030' | '040' | '050' | 'OTHER' => {
    const normalizedLevelNo = toTrimText(unitLevelNo).replace(/\D/g, '');
    if (normalizedLevelNo === '010') return '010';
    if (normalizedLevelNo === '020' || normalizedLevelNo === '030') return '020_030';
    if (normalizedLevelNo === '040') return '040';
    if (normalizedLevelNo === '050') return '050';

    if (levelName.includes('ปธบ') || levelName.includes('กผญ')) return '010';
    if (levelName.includes('รองกรรมการผู้จัดการใหญ่') || levelName.includes('ประธานเจ้าหน้าที่')) return '020_030';
    if (levelName.includes('ผู้ช่วยกรรมการผู้จัดการใหญ่')) return '040';
    if (levelName.includes('ผู้จัดการฝ่าย')) return '050';
    return 'OTHER';
};

export const getReport10SummaryDataService = async (
    effectiveDateStr: string,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();
        const effectiveDate = new Date(effectiveDateStr);

        request.input('Effectivedate', sql.DateTime, effectiveDate);
        request.input('EmployeeID', sql.VarChar(8), employeeId);
        request.input('UserGroupNO', sql.VarChar(2), userGroupNo || null);

        const result = await request.execute('mp_Report10GetSum');
        const rows = Array.isArray(result.recordset) ? result.recordset : [];

        return rows.map((rawRow, index) => {
            const row = (rawRow && typeof rawRow === 'object') ? (rawRow as Record<string, unknown>) : {};
            const { num, text } = buildRowAccessor(row);
            const position = text('ตำแหน่ง', 'position', 'LevelName', 'levelname');

            return {
                key: `r10-${index + 1}`,
                position,
                n1: num('n1'),
                n2: num('n2'),
                n3: num('n3'),
                s1: num('s1'),
                s2: num('s2'),
                s3: num('s3'),
                sm1: num('sm1'),
                sm2: num('sm2'),
                sm3: num('sm3'),
                t1: num('t1'),
                t2: num('t2'),
                t3: num('t3')
            };
        });
    } catch (error) {
        console.error('Error in getReport10SummaryDataService:', error);
        throw error;
    }
};

export const getReport10ExportDataService = async (
    effectiveDateStr: string,
    _employeeId: string,
    _userGroupNo: string
) => {
    try {
        const pool = await poolPromise;
        const request = pool.request();
        const effectiveDate = new Date(effectiveDateStr);

        request.input('EffectiveDate', sql.DateTime, effectiveDate);

        const result = await request.query(`
            ;WITH PositionDedup AS (
                SELECT
                    p.*,
                    ROW_NUMBER() OVER (
                        PARTITION BY p.PositionID
                        ORDER BY
                            CAST(p.EndDate AS nvarchar(32)) DESC,
                            CAST(p.BeginDate AS nvarchar(32)) DESC,
                            CAST(p.OrgUnitID AS nvarchar(32)) DESC
                    ) AS rn
                FROM InterfacePosition p
                WHERE @EffectiveDate BETWEEN TRY_CONVERT(date, p.BeginDate) AND TRY_CONVERT(date, p.EndDate)
            ),
            InfoDataDedup AS (
                SELECT
                    i.*,
                    ROW_NUMBER() OVER (
                        PARTITION BY i.POSCODE
                        ORDER BY
                            CAST(i.CODE AS nvarchar(32)) DESC,
                            CAST(i.FULLNAMETH AS nvarchar(300)) DESC
                    ) AS rn
                FROM InfoData i
            ),
            JCodeDedup AS (
                SELECT
                    levelgroup,
                    MAX(JCODE) AS JCODE
                FROM mp_JCode
                GROUP BY levelgroup
            )
            SELECT
                i.POSCODE,
                p.OrgUnitID AS OrgUnitNo,
                InterfaceUnit.UnitName,
                p.OrgFlag,
                p.OrgType,
                p.PoolRSFlag,
                p.JobBand,
                p.LevelGroupNo,
                p.SignPos,
                p.StrgFlag,
                p.BSType,
                p.SpecFlag,
                p.LineStaffFlag,
                p.EmployeeID,
                i.CODE AS InfoEmployeeID,
                i.FULLNAMETH,
                i.POSNAME,
                JCodeDedup.JCODE,
                InterfaceUnit.ParentOrgUnitNo,
                UnitParent.UnitName AS ParentUnitName,
                MP_UnitLevel.UnitLevelName,
                RIGHT('000' + LTRIM(RTRIM(CAST(MP_UnitLevel.UnitLevelNo AS nvarchar(16)))), 3) AS UnitLevelNo
            FROM PositionDedup p
            INNER JOIN InfoDataDedup i ON i.POSCODE = p.PositionID AND i.rn = 1
            LEFT JOIN JCodeDedup ON JCodeDedup.levelgroup = p.LevelGroupNo
            LEFT JOIN InterfaceUnit ON InterfaceUnit.OrgUnitNo = p.OrgUnitID
            LEFT JOIN InterfaceUnit UnitParent ON UnitParent.OrgUnitNo = InterfaceUnit.ParentOrgUnitNo
            LEFT JOIN MP_UnitLevel ON MP_UnitLevel.UnitLevelNo = InterfaceUnit.UnitLevel
            WHERE p.rn = 1
        `);
        const rows = Array.isArray(result.recordset) ? result.recordset : [];

        return rows.map((rawRow, index) => {
            const row = (rawRow && typeof rawRow === 'object') ? (rawRow as Record<string, unknown>) : {};
            const { num, text } = buildRowAccessor(row);

            const unitLevelNo = text('UnitLevelNo', 'unitlevelno');
            const levelName = text('UnitLevelName', 'unitlevelname', 'LevelName', 'levelname');
            const orgType = num('OrgType', 'orgtype');
            const poolRsFlag = num('PoolRSFlag', 'poolrsflag');
            const strgFlag = num('StrgFlag', 'strgflag');
            const bsType = num('BSType', 'bstype');
            const specFlag = num('SpecFlag', 'specflag');
            const isSecondment = orgType === 2;
            const isSpecific = specFlag === 1;

            return {
                key: `r10e-${index + 1}`,
                level_group: mapReport10LevelGroup(unitLevelNo, levelName),
                level_name: levelName,
                position_name: text('POSNAME', 'posname'),
                position_short_name: text('UnitLevelName', 'unitlevelname'),
                unit_name: text('UnitName', 'unitname'),
                parent_unit_name: text('ParentUnitName', 'parentunitname'),
                unit_level_no: unitLevelNo,
                unit_level_name: levelName,
                org_unit_id: text('OrgUnitNo', 'orgunitno', 'OrgUnitID', 'orgunitid'),
                position_id: text('POSCODE', 'poscode'),
                employee_id: text('EmployeeID', 'employeeid'),
                info_employee_id: text('InfoEmployeeID', 'infoemployeeid'),
                full_name: text('FULLNAMETH', 'fullnameth'),
                job_band: text('JobBand', 'jobband'),
                jg: text('JobBand', 'jobband'),
                org_flag: num('OrgFlag', 'orgflag'),
                org_type: orgType,
                pool_rs_flag: poolRsFlag,
                strg_flag: strgFlag,
                bs_type: bsType,
                spec_flag: specFlag,
                frame_type: poolRsFlag === 1 ? 'pool' : (orgType === 2 ? 'Secondment' : 'ปตท'),
                strategic: strgFlag === 1 ? 'Y' : 'N',
                business_support: bsType === 1 ? 'Business' : (bsType === 2 ? 'Support' : '-'),
                specific_rate: specFlag === 1 ? 'Y' : 'N',
                group_type: isSecondment ? 'SECONDMENT' : (isSpecific ? 'SPEC' : 'PTT')
            };
        });
    } catch (error) {
        console.error('Error in getReport10ExportDataService:', error);
        throw error;
    }
};

function buildReport08Tree(
    flatData: any[],
    positionMap: Report08LevelMap,
    costMap: Report08LevelMap
) {
    const resultTree: any[] = [];
    const group1Map = new Map();
    const group2Map = new Map();
    const group3Map = new Map();
    let keyCounter = 1;

    const readRowValue = (row: Record<string, unknown>, ...aliases: string[]) => {
        const lowerMap = new Map<string, unknown>();
        Object.entries(row).forEach(([key, value]) => lowerMap.set(key.toLowerCase(), value));
        for (const alias of aliases) {
            const value = lowerMap.get(alias.toLowerCase());
            if (value !== undefined && value !== null && value !== '') {
                return value;
            }
        }
        return undefined;
    };

    const hasReport01PeopleFields = (row: Record<string, unknown>) => {
        const aliases = [
            'P_N_21', 'P_N_18_20', 'P_N_16_17', 'P_N_14_15', 'P_N_11_13', 'P_N_9_10', 'P_N_4_8',
            'P_S_21', 'P_S_18_20', 'P_S_16_17', 'P_S_14_15', 'P_S_11_13', 'P_S_9_10', 'P_S_4_8'
        ];
        return aliases.some((alias) => readRowValue(row, alias) !== undefined);
    };

    const getReport01PeopleLevels = (row: Record<string, unknown>) => {
        const n21 = toNumberOrZero(readRowValue(row, 'P_N_21'));
        const n1820 = toNumberOrZero(readRowValue(row, 'P_N_18_20'));
        const n1617 = toNumberOrZero(readRowValue(row, 'P_N_16_17'));
        const n1415 = toNumberOrZero(readRowValue(row, 'P_N_14_15'));
        const n1113 = toNumberOrZero(readRowValue(row, 'P_N_11_13'));
        const n910 = toNumberOrZero(readRowValue(row, 'P_N_9_10'));
        const n48 = toNumberOrZero(readRowValue(row, 'P_N_4_8'));

        const s21 = toNumberOrZero(readRowValue(row, 'P_S_21'));
        const s1820 = toNumberOrZero(readRowValue(row, 'P_S_18_20'));
        const s1617 = toNumberOrZero(readRowValue(row, 'P_S_16_17'));
        const s1415 = toNumberOrZero(readRowValue(row, 'P_S_14_15'));
        const s1113 = toNumberOrZero(readRowValue(row, 'P_S_11_13'));
        const s910 = toNumberOrZero(readRowValue(row, 'P_S_9_10'));
        const s48 = toNumberOrZero(readRowValue(row, 'P_S_4_8'));

        return [
            n21 + s21,
            n1820 + s1820,
            n1617 + s1617,
            n1415 + s1415,
            n1113 + s1113,
            n910 + s910,
            n48 + s48
        ];
    };

    const extractOrgUnitNo = (row: Record<string, unknown>) => {
        const raw = readRowValue(
            row,
            'OrgUnitNo',
            'orgUnitNo',
            'OrgUnitNO',
            'UnitNo',
            'unitNo',
            'UnitCode',
            'unitCode',
            'OrgNo',
            'orgNo',
            'UnitDummy',
            'unitDummy',
            'SecUnitDummy',
            'secUnitDummy'
        );
        const text = toTrimText(raw);
        if (text) return text;

        const fromTextFields = [
            toTrimText(readRowValue(row, 'UnitText', 'unitText')),
            toTrimText(readRowValue(row, 'DisplayName', 'displayName')),
            toTrimText(readRowValue(row, 'UnitAbbr', 'unitAbbr'))
        ];

        for (const field of fromTextFields) {
            const matched = field.match(/[0-9]{7,10}/);
            if (matched) return matched[0];
        }
        return '';
    };

    flatData.forEach((row) => {
        const bgName = row.GroupBGName;
        const grandParent = row.GrandParent || '';
        const grandParent2 = row.GrandParent2 || '';

        if (!bgName) return;

        if (!group1Map.has(bgName)) {
            const bgNode = {
                key: `bg-${keyCounter++}`,
                unit: bgName,
                ...createEmptyReport08Node(),
                children: []
            };
            group1Map.set(bgName, bgNode);
            resultTree.push(bgNode);
        }

        let targetNode = group1Map.get(bgName);

        const rowObj = (row && typeof row === 'object') ? (row as Record<string, unknown>) : {};
        const orgUnitNo = extractOrgUnitNo(rowObj);
        const useReport01People = hasReport01PeopleFields(rowObj);
        const peopleValues = useReport01People
            ? getReport01PeopleLevels(rowObj)
            : REPORT08_PEOPLE_LEVELS.map(({ levelGroupNo }) => getReport08Metric(positionMap, orgUnitNo, levelGroupNo));
        const expenseValues = REPORT08_PEOPLE_LEVELS.map(({ levelGroupNo }) => getReport08Metric(costMap, orgUnitNo, levelGroupNo));

        const peopleTotalFromLevels = peopleValues.reduce((sum, value) => sum + value, 0);
        const report01PeopleTotalRaw = readRowValue(rowObj, 'm_amount', 'M_Amount', 'mAmount');
        const peopleTotal = useReport01People && report01PeopleTotalRaw !== undefined
            ? toNumberOrZero(report01PeopleTotalRaw)
            : peopleTotalFromLevels;
        const expenseTotal = expenseValues.reduce((sum, value) => sum + value, 0);
        const majorPoints = toNumberOrZero(
            readRowValue(rowObj, 'q_contact', 'Q_Contact', 'q_8', 'Q_8', 'L9908', 'l9908')
        );
        const majorBudget = getReport08Metric(costMap, orgUnitNo, REPORT08_MAJOR_LEVEL);
        const minorPoints = toNumberOrZero(
            readRowValue(rowObj, 'q_subcontact', 'Q_SubContact', 'q_10', 'Q_10', 'L9910', 'l9910')
        );
        const minorBudget = getReport08Metric(costMap, orgUnitNo, REPORT08_MINOR_LEVEL);
        const totalGrandExpense = expenseTotal + majorBudget + minorBudget;

        const rowData = {
            key: `r-${keyCounter++}`,
            unit: row.DisplayName || row.UnitAbbr || orgUnitNo || '-',
            people_21: peopleValues[0] || 0,
            people_18_20: peopleValues[1] || 0,
            people_16_17: peopleValues[2] || 0,
            people_14_15: peopleValues[3] || 0,
            people_11_13: peopleValues[4] || 0,
            people_9_10: peopleValues[5] || 0,
            people_4_8: peopleValues[6] || 0,
            people_total: peopleTotal,
            expense_21: expenseValues[0] || 0,
            expense_18_20: expenseValues[1] || 0,
            expense_16_17: expenseValues[2] || 0,
            expense_14_15: expenseValues[3] || 0,
            expense_11_13: expenseValues[4] || 0,
            expense_9_10: expenseValues[5] || 0,
            expense_4_8: expenseValues[6] || 0,
            expense_total: expenseTotal,
            major_points: majorPoints,
            major_budget: majorBudget,
            minor_points: minorPoints,
            minor_budget: minorBudget,
            total_grand_expense: totalGrandExpense,
            _isHiddenLegacy: row.IsBelongTo == 1 || row.IsBelongTo === true || row.IsBelongTo === '1'
        };

        if (grandParent) {
            const group2KeyId = `${bgName}-${grandParent}`;
            if (!group2Map.has(group2KeyId)) {
                const gpNode = {
                    key: `gp-${keyCounter++}`,
                    unit: grandParent,
                    ...createEmptyReport08Node(),
                    children: []
                };
                group2Map.set(group2KeyId, gpNode);
                targetNode.children.push(gpNode);
            }
            targetNode = group2Map.get(group2KeyId);

            if (grandParent2 && grandParent2 !== grandParent) {
                const group3KeyId = `${bgName}-${grandParent}-${grandParent2}`;
                if (!group3Map.has(group3KeyId)) {
                    const gp2Node = {
                        key: `gp2-${keyCounter++}`,
                        unit: grandParent2,
                        ...createEmptyReport08Node(),
                        children: []
                    };
                    group3Map.set(group3KeyId, gp2Node);
                    targetNode.children.push(gp2Node);
                }
                targetNode = group3Map.get(group3KeyId);
            }
        }

        targetNode.children.push(rowData);
    });

    const sumTotalRecursive = (node: any) => {
        if (!node.children || node.children.length === 0) return node;
        node.children.forEach((child: any) => sumTotalRecursive(child));
        node.children.forEach((child: any) => sumNode(node, child));
        return node;
    };
    resultTree.forEach((bgNode) => sumTotalRecursive(bgNode));

    const grandTotal = {
        key: 'total',
        unit: 'รวมทุกธุรกิจ',
        ...createEmptyReport08Node()
    };
    resultTree.forEach((node) => sumNode(grandTotal, node));
    resultTree.push(grandTotal);

    const cleanupTree = (node: any) => {
        if (!node.children) return;

        for (let i = node.children.length - 1; i >= 0; i--) {
            const childNode = node.children[i];
            if (!childNode.children) continue;

            cleanupTree(childNode);

            childNode.children = childNode.children.filter((grandChild: any) => {
                const childName = String(childNode.unit || '').replace(/ /g, '');
                const grandChildName = String(grandChild.unit || '').replace(/ /g, '');
                const isLeadChild = grandChildName === `${childName}ขึ้นตรง`;
                const isHidden = grandChild._isHiddenLegacy && isLeadChild;
                return !isHidden;
            });

            if (
                childNode.children.length === 1 &&
                String(childNode.children[0].unit || '').replace(/ /g, '') === `${String(childNode.unit || '').replace(/ /g, '')}ขึ้นตรง`
            ) {
                node.children.splice(i, 1, childNode.children[0]);
            } else if (childNode.children.length === 0) {
                delete childNode.children;
                if (childNode.key.startsWith('gp2-')) {
                    childNode.unit = `> ${String(childNode.unit || '').trim()}`;
                } else if (childNode.key.startsWith('gp-')) {
                    childNode.unit = String(childNode.unit || '').trim();
                }
            } else {
                if (childNode.key.startsWith('gp2-')) {
                    childNode.unit = `> ${String(childNode.unit || '').trim()}`;
                }

                const prefix = childNode.key.startsWith('gp2-') ? '→ ' : '> ';
                childNode.children.forEach((grandChild: any) => {
                    const currentName = String(grandChild.unit || '').trim();
                    const originalParentName = String(childNode.unit || '').replace('> ', '').trim();
                    if (currentName.endsWith('ขึ้นตรง') && currentName !== `${originalParentName}ขึ้นตรง`) {
                        grandChild.unit = prefix + currentName.replace('ขึ้นตรง', '');
                    }
                });
            }
        }
    };
    resultTree.forEach((bgNode) => cleanupTree(bgNode));

    resultTree.forEach((bgNode) => {
        if (!bgNode.children) return;
        const gpChildren = bgNode.children.filter((c: any) => c.key && c.key.startsWith('gp-'));
        if (gpChildren.length === 1) {
            const gpNode = gpChildren[0];
            if (gpNode.children && gpNode.children.length > 0) {
                const idx = bgNode.children.indexOf(gpNode);
                bgNode.children.splice(idx, 1, ...gpNode.children);
            }
        }
    });

    return resultTree;
}

function createEmptyReport08Node() {
    return {
        people_21: 0,
        people_18_20: 0,
        people_16_17: 0,
        people_14_15: 0,
        people_11_13: 0,
        people_9_10: 0,
        people_4_8: 0,
        people_total: 0,
        expense_21: 0,
        expense_18_20: 0,
        expense_16_17: 0,
        expense_14_15: 0,
        expense_11_13: 0,
        expense_9_10: 0,
        expense_4_8: 0,
        expense_total: 0,
        major_points: 0,
        major_budget: 0,
        minor_points: 0,
        minor_budget: 0,
        total_grand_expense: 0
    };
}


function getIndentPrefix(level: any) {
    const lvl = String(level);
    if (lvl === '1') return '';
    if (lvl === '2') return '\u00A0\u00A0\u00A0\u00A0\u00A0'; // 5 spaces
    if (lvl === '3') return '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'; // 10 spaces
    if (lvl === '4') return '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u2192\u00A0'; // 9 spaces + arrow + space
    return '';
}

function buildReport01Tree(flatData: any[]) {
    const resultTree: any[] = [];
    const group1Map = new Map();
    const group2Map = new Map();
    const group3Map = new Map();
    let keyCounter = 1;

    flatData.forEach((row) => {
        const bgName = row.GroupBGName;
        // Legacy reporting used GrandParent for logical summing groups of children (like ผงญ. inside ปธง.)
        const grandParent = row.GrandParent || "";
        const grandParent2 = row.GrandParent2 || "";

        if (!bgName) return; 

        // 1. Root Group (GroupBGName)
        if (!group1Map.has(bgName)) {
            const bgNode = {
                key: `bg-${keyCounter++}`,
                unit: bgName,
                ...createEmptyNode(),
                children: []
            };
            group1Map.set(bgName, bgNode);
            resultTree.push(bgNode);
        }
        let level1Node = group1Map.get(bgName);
        let targetNode = level1Node;

        const rowData = {
            key: `r-${keyCounter++}`, 
            unit: row.DisplayName || row.UnitAbbr,
            // frame_staff
            frame_staff_0: row.Q_N_21 || 0,
            frame_staff_1: row.Q_N_18_20 || 0,
            frame_staff_2: row.Q_N_16_17 || 0,
            frame_staff_3: row.Q_N_14_15 || 0,
            frame_staff_4: row.Q_N_11_13 || 0,
            frame_staff_5: row.Q_N_9_10 || 0,
            frame_staff_6: row.Q_N_4_8 || 0,
            frame_staff_7: (row.Q_N_21 || 0) + (row.Q_N_18_20 || 0) + (row.Q_N_16_17 || 0) + (row.Q_N_14_15 || 0) + (row.Q_N_11_13 || 0) + (row.Q_N_9_10 || 0) + (row.Q_N_4_8 || 0),

            // people_normal
            people_normal_0: row.P_N_21 || 0,
            people_normal_1: row.P_N_18_20 || 0,
            people_normal_2: row.P_N_16_17 || 0,
            people_normal_3: row.P_N_14_15 || 0,
            people_normal_4: row.P_N_11_13 || 0,
            people_normal_5: row.P_N_9_10 || 0,
            people_normal_6: row.P_N_4_8 || 0,
            people_normal_7: (row.P_N_21 || 0) + (row.P_N_18_20 || 0) + (row.P_N_16_17 || 0) + (row.P_N_14_15 || 0) + (row.P_N_11_13 || 0) + (row.P_N_9_10 || 0) + (row.P_N_4_8 || 0),

            // frame_sec
            frame_sec_0: row.Q_S_21 || 0,
            frame_sec_1: row.Q_S_18_20 || 0,
            frame_sec_2: row.Q_S_16_17 || 0,
            frame_sec_3: row.Q_S_14_15 || 0,
            frame_sec_4: row.Q_S_11_13 || 0,
            frame_sec_5: row.Q_S_9_10 || 0,
            frame_sec_6: row.Q_S_4_8 || 0,
            frame_sec_7: (row.Q_S_21 || 0) + (row.Q_S_18_20 || 0) + (row.Q_S_16_17 || 0) + (row.Q_S_14_15 || 0) + (row.Q_S_11_13 || 0) + (row.Q_S_9_10 || 0) + (row.Q_S_4_8 || 0),

            // people_sec
            people_sec_0: row.P_S_21 || 0,
            people_sec_1: row.P_S_18_20 || 0,
            people_sec_2: row.P_S_16_17 || 0,
            people_sec_3: row.P_S_14_15 || 0,
            people_sec_4: row.P_S_11_13 || 0,
            people_sec_5: row.P_S_9_10 || 0,
            people_sec_6: row.P_S_4_8 || 0,
            people_sec_7: (row.P_S_21 || 0) + (row.P_S_18_20 || 0) + (row.P_S_16_17 || 0) + (row.P_S_14_15 || 0) + (row.P_S_11_13 || 0) + (row.P_S_9_10 || 0) + (row.P_S_4_8 || 0),

            // total_frame
            sum_frame_normal: row.mn_amount || row.n_amount || 0,
            sum_frame_pool: row.p_amount || 0,
            sum_frame_trad: row.mtr_amount || row.tr_amount || 0,
            sum_frame_newbiz: row.mnb_amount || row.nb_amount || 0,
            sum_frame_total: row.total_amount || 0,

            // total_people
            sum_people_normal: row.m_amount || 0,
            sum_people_pool: row.m_amount || 0,
            sum_people_trad: 0,
            sum_people_newbiz: 0,
            sum_people_total: row.m_amount || row.total_amount || 0,

            // other columns
            recruit_total: row.f_amount || row.F_Amount || row.F_amount || 0,
            vacancy_0: row.Vacant_21 || 0,
            vacancy_1: row.Vacant_18_20 || 0,
            vacancy_2: row.Vacant_16_17 || 0,
            vacancy_3: row.Vacant_14_15 || 0,
            vacancy_4: row.Vacant_11_13 || 0,
            vacancy_5: row.Vacant_9_10 || 0,
            vacancy_6: row.Vacant_4_8 || 0,
            vacancy_7: (row.Vacant_21 || 0) + (row.Vacant_18_20 || 0) + (row.Vacant_16_17 || 0) + (row.Vacant_14_15 || 0) + (row.Vacant_11_13 || 0) + (row.Vacant_9_10 || 0) + (row.Vacant_4_8 || 0),

            contact_out: row.q_contact || 0,
            contact_out_sub: row.q_subcontact || 0,
            _isHiddenLegacy: row.IsBelongTo == 1 || row.IsBelongTo === true || row.IsBelongTo === '1'
        };

        // 2. Sub Group (GrandParent)
        if (grandParent) {
            const group2KeyId = `${bgName}-${grandParent}`;
            if (!group2Map.has(group2KeyId)) {
                const gpNode = {
                    key: `gp-${keyCounter++}`,
                    unit: grandParent,
                    ...createEmptyNode(),
                    children: []
                };
                group2Map.set(group2KeyId, gpNode);
                targetNode.children.push(gpNode);
            }
            targetNode = group2Map.get(group2KeyId);

            // 3. Sub-Sub Group (GrandParent2)
            if (grandParent2 && grandParent2 !== grandParent) {
                const group3KeyId = `${bgName}-${grandParent}-${grandParent2}`;
                if (!group3Map.has(group3KeyId)) {
                    const gp2Node = {
                        key: `gp2-${keyCounter++}`,
                        unit: grandParent2,
                        ...createEmptyNode(),
                        children: []
                    };
                    group3Map.set(group3KeyId, gp2Node);
                    targetNode.children.push(gp2Node);
                }
                targetNode = group3Map.get(group3KeyId);
            }
        }

        rowData.key = `r-${keyCounter++}`;
        targetNode.children.push(rowData);
    });

    // Rollup sums matching legacy report recursively!
    function sumTotalRecursive(node: any) {
        if (!node.children || node.children.length === 0) return node;
        node.children.forEach((child: any) => sumTotalRecursive(child));
        node.children.forEach((child: any) => sumNode(node, child));
        return node;
    }
    resultTree.forEach(bgNode => sumTotalRecursive(bgNode));

    // Compute grand total record
    let grandTotal = {
        key: 'total',
        unit: 'รวมทุกธุรกิจ',
        ...createEmptyNode()
    };
    resultTree.forEach(node => sumNode(grandTotal, node));
    resultTree.push(grandTotal);

    // Format names to match Legacy Design exactly (Recursive Cleanup)
    function cleanupTree(node: any) {
        if (!node.children) return;

        for (let i = node.children.length - 1; i >= 0; i--) {
            let childNode = node.children[i];

            if (childNode.children) {
                // Recursively clean sub-folders first
                cleanupTree(childNode);

                // 1. Remove logically hidden leaf nodes
                childNode.children = childNode.children.filter((grandChild: any) => {
                    const isLeadChild = grandChild.unit.replace(/ /g, '') === childNode.unit.replace(/ /g, '') + "ขึ้นตรง";
                    const isHidden = grandChild._isHiddenLegacy && isLeadChild;
                    return !isHidden;
                });

                // 2. Refine node structures
                if (childNode.children.length === 1 && childNode.children[0].unit.replace(/ /g, '') === childNode.unit.replace(/ /g, '') + "ขึ้นตรง") {
                    // Folder exactly contains Lead Child! Promote it & remove folder wrapper
                    node.children.splice(i, 1, childNode.children[0]);
                } else if (childNode.children.length === 0) {
                    // Empty Folders drop their array to become solid header rows (e.g. ผตญ.)
                    delete childNode.children;
                    // For Level 3 folders like > ผงญ. format them correctly
                    if (childNode.key.startsWith('gp2-')) {
                        childNode.unit = "> " + childNode.unit.trim();
                    } else if (childNode.key.startsWith('gp-')) {
                        // GrandParent groups that became empty keep their exact string
                        childNode.unit = childNode.unit.trim(); 
                    }
                } else {
                    // Multiple visible children: Rename sub-leaf names to > or arrow
                    // For GrandParent2 (sub-sub-groups) it behaves like a folder, so mark its name with "> "
                    if (childNode.key.startsWith('gp2-')) {
                        childNode.unit = "> " + childNode.unit.trim();
                    }
                    
                    const prefix = childNode.key.startsWith('gp2-') ? "→ " : "> ";
                    childNode.children.forEach((grandChild: any) => {
                        let cName = grandChild.unit.trim();
                        let originalParentName = childNode.unit.replace("> ", "").trim();
                        
                        if (cName.endsWith("ขึ้นตรง") && cName !== originalParentName + "ขึ้นตรง") {
                            grandChild.unit = prefix + cName.replace("ขึ้นตรง", "");
                        }
                    });
                }
            }
        }
    }

    resultTree.forEach(bgNode => cleanupTree(bgNode));

    // RDLC Legacy Rule: IIF(Fields!Lvl.Value = 1, True, False)
    // When a GroupBG has only ONE GrandParent (Lvl=1), the GrandParent header is hidden
    // and its children are promoted directly to the GroupBG level.
    resultTree.forEach(bgNode => {
        if (!bgNode.children) return;
        // Count how many gp- children exist
        const gpChildren = bgNode.children.filter((c: any) => c.key && c.key.startsWith('gp-'));
        if (gpChildren.length === 1) {
            const gpNode = gpChildren[0];
            if (gpNode.children && gpNode.children.length > 0) {
                // Find the index of the gp- node and replace it with its children
                const idx = bgNode.children.indexOf(gpNode);
                bgNode.children.splice(idx, 1, ...gpNode.children);
            }
        }
    });

    return resultTree;
}
function rollupTotals(node: any) {
    if (!node.children || node.children.length === 0) return node;
    node.children.forEach((child: any) => rollupTotals(child));
    node.children.forEach((child: any) => sumNode(node, child));
    return node;
}

function sumNode(target: any, source: any) {
    Object.keys(source).forEach(key => {
        if (typeof target[key] === 'number') {
            target[key] += (source[key] || 0);
        }
    });
}

function createEmptyNode() {
    return {
        frame_staff_0: 0, frame_staff_1: 0, frame_staff_2: 0, frame_staff_3: 0, frame_staff_4: 0, frame_staff_5: 0, frame_staff_6: 0, frame_staff_7: 0,
        people_normal_0: 0, people_normal_1: 0, people_normal_2: 0, people_normal_3: 0, people_normal_4: 0, people_normal_5: 0, people_normal_6: 0, people_normal_7: 0,
        frame_sec_0: 0, frame_sec_1: 0, frame_sec_2: 0, frame_sec_3: 0, frame_sec_4: 0, frame_sec_5: 0, frame_sec_6: 0, frame_sec_7: 0,
        people_sec_0: 0, people_sec_1: 0, people_sec_2: 0, people_sec_3: 0, people_sec_4: 0, people_sec_5: 0, people_sec_6: 0, people_sec_7: 0,
        sum_frame_normal: 0, sum_frame_pool: 0, sum_frame_trad: 0, sum_frame_newbiz: 0, sum_frame_total: 0,
        sum_people_normal: 0, sum_people_pool: 0, sum_people_trad: 0, sum_people_newbiz: 0, sum_people_total: 0,
        recruit_total: 0, 
        vacancy_0: 0, vacancy_1: 0, vacancy_2: 0, vacancy_3: 0, vacancy_4: 0, vacancy_5: 0, vacancy_6: 0, vacancy_7: 0,
        contact_out: 0, contact_out_sub: 0
    };
}
