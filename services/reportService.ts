import { sql, poolPromise } from '../config/db.js';
import { calculateReport7ShapeGapMetrics } from '../config/report7FormulaConfig.js';

type Report08LevelMap = Map<string, Map<string, number>>;
type Report09OrgYearMap = Map<string, Map<number, { support: number; bu: number }>>;
type Report09YearRateMap = Map<number, { support: { rate: number; base: number }; bu: { rate: number; base: number } }>;
type Report09AuditRow = {
    stage_code: string;
    stage_name: string;
    org_unit_id: string;
    unit_abbr: string;
    unit_name: string;
    retire_year: number;
    bs_type: 'Support' | 'BU';
    position_rows: number;
    employee_count: number;
};

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
const REPORT09_INFO_EMPLOYEE_COL_CANDIDATES = ['CODE', 'Code', 'EmployeeID', 'EmployeeId'];
const REPORT09_INFO_SECONDMENT_TEXT_COL_CANDIDATES = ['Secondment_text', 'Secondment_Text', 'SecondmentText', 'secondment_text'];
const REPORT09_RETIRE_YEAR_COL_CANDIDATES = ['RETIREYEAR', 'RetireYear'];
const REPORT09_INFO_POSITION_COL_CANDIDATES = ['POSCODE', 'PositionID', 'PositionCode', 'PosCode'];
const REPORT09_POSITION_ID_COL_CANDIDATES = ['PositionID', 'POSCODE', 'PositionCode', 'PosCode'];
const REPORT09_ORG_COL_CANDIDATES = ['OrgUnitID', 'OrgUnitId', 'OrgUnitNo', 'OrgUnitNO', 'OrgUnit', 'UnitNo', 'UnitCode', 'OrgNo'];
const REPORT09_ORG_TYPE_COL_CANDIDATES = ['OrgType', 'ORGTYPE', 'orgtype'];
const REPORT09_LEVEL_COL_CANDIDATES = ['LevelGroupNo', 'LevelGroupNO', 'LevelNo', 'GroupNo', 'PositionLevel'];
const REPORT09_BS_TYPE_COL_CANDIDATES = ['BSType', 'BsType', 'BS_Type', 'TypeBS'];
const REPORT09_SIGN_POS_COL_CANDIDATES = ['SignPos', 'SignPOS', 'SignPosition', 'SignPosFlag'];
const REPORT09_EMPLOYEE_COL_CANDIDATES = ['EmployeeID', 'EmployeeId', 'EmpID', 'EmpId', 'EmployeeNo'];
const REPORT09_UNIT_FN_CANDIDATES = ['fn_InterfaceUnit'];
const REPORT09_UNIT_BG_COL_CANDIDATES = ['BGNo', 'BgNo', 'BGNO'];
const REPORT09_UNIT_NAME_COL_CANDIDATES = ['UnitName', 'OrgUnitName', 'Name'];
const REPORT09_UNIT_ABBR_COL_CANDIDATES = ['UnitAbbr', 'OrgUnitAbbr', 'ShortName', 'Abbr'];
const REPORT09_LEVEL_GROUP_TABLE_CANDIDATES = ['MP_LevelGroup'];
const REPORT09_LEVEL_GROUP_ACTIVE_COL_CANDIDATES = ['LevelDelayActive', 'LevelDelayActiive', 'LevelDalayActive'];
const REPORT09_LEVEL_GROUP_ORDER_COL_CANDIDATES = ['LevelDelayOrder', 'LevelDalayOrder', 'LevelGroupOrder'];
const REPORT09_NON_COUNT_DELAY_YEAR = 9999;

export const getDashboardDataService = async (
    effectiveMonth: string,
    effectiveYear: string,
    employeeId: string,
    userGroupNo: string,
    isSecondment: number,
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
    division: string,
    orgUnits: string[] = []
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
        
        if (division) {
             request.input('division', sql.VarChar(8), division);
        } else {
             request.input('division', sql.VarChar(8), null);
        }

        const result = await request.execute('mp_DashboardReport4_excel');
        const rows = result.recordset || [];

        if (!orgUnits.length) {
            return rows;
        }

        const unitSet = new Set(orgUnits.map(v => String(v).trim()).filter(Boolean));
        return rows.filter((row: Record<string, unknown>) => {
            const orgUnitNo = String(
                row['รหัสหน่วยงาน'] ??
                row.OrgUnitNo ??
                row.OrgUnitID ??
                row.orgUnitNo ??
                ''
            ).trim();
            return unitSet.has(orgUnitNo);
        });
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

const getObjectMeta = async (
    pool: any,
    objectCandidates: string[]
): Promise<TableMeta | null> => {
    if (!objectCandidates.length) return null;

    const inList = objectCandidates.map((name) => `'${escapeSqlString(name.toLowerCase())}'`).join(',');
    const objectRes = await pool.request().query(`
        SELECT s.name AS schema_name, o.name AS object_name
        FROM sys.objects o
        INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE LOWER(o.name) IN (${inList})
          AND o.type IN ('U', 'V', 'IF', 'TF')
    `);

    const rows = Array.isArray(objectRes.recordset) ? objectRes.recordset as Array<Record<string, unknown>> : [];
    if (!rows.length) return null;

    const rankObject = (row: Record<string, unknown>, candidate: string) => {
        const objectName = String(row.object_name || '').toLowerCase();
        const schemaName = String(row.schema_name || '').toLowerCase();
        const objectExact = objectName === candidate.toLowerCase() ? 0 : 1;
        const schemaRank = schemaName === 'dbo' ? 0 : 1;
        return objectExact * 10 + schemaRank;
    };

    let selected: Record<string, unknown> | null = null;
    for (const candidate of objectCandidates) {
        const matched = rows
            .filter((row) => String(row.object_name || '').toLowerCase() === candidate.toLowerCase())
            .sort((a, b) => rankObject(a, candidate) - rankObject(b, candidate));
        if (matched.length > 0) {
            selected = matched[0];
            break;
        }
    }

    if (!selected) selected = rows[0];

    const schemaName = String(selected.schema_name || '').trim();
    const tableName = String(selected.object_name || '').trim();
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
            const recruitAmount = num('Recruit_Amount', 'f_amount');

            // The DB's Vacant_Total is net of Recruit_Amount, while the visible
            // vacancy level columns are not. Use the summed level vacancies here
            // so the "รวม" column matches the displayed level breakdown.
            const vacancyTotal = sumLevels(vacancyLevels);
            const vacancyTotalDiff = sumLevels(vacancyDiffLevels);

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
                vacancy_total: vacancyTotal,

                vacancy_21_change: vacancyDiffLevels[0],
                vacancy_18_20_change: vacancyDiffLevels[1],
                vacancy_16_17_change: vacancyDiffLevels[2],
                vacancy_14_15_change: vacancyDiffLevels[3],
                vacancy_11_13_change: vacancyDiffLevels[4],
                vacancy_9_10_change: vacancyDiffLevels[5],
                vacancy_under_8_change: vacancyDiffLevels[6],
                vacancy_total_change: vacancyTotalDiff,

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

        const fromDateRaw = new Date(fromDateStr);
        const toDateRaw = new Date(toDateStr);

        if (Number.isNaN(fromDateRaw.getTime()) || Number.isNaN(toDateRaw.getTime())) {
            throw new Error('Invalid report5 date range');
        }

        const fromDate = fromDateRaw;
        const toDate = toDateRaw;

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

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const cleanReport7UnitShort = (value: unknown): string =>
    toTrimText(value).replace(/\s*ขึ้นตรง\s*$/, '').trim();

type Report7QuotaTotals = {
    q_1: number;
    q_2: number;
    q_3: number;
    q_4: number;
    q_5: number;
    q_6: number;
    q_7: number;
    q_total: number;
    q_8: number;
    q_10: number;
};

export const getReport07DataService = async (
    effectiveDateStr: string,
    employeeId: string,
    userGroupNo: string,
    division: string,
    orgUnitNo: string,
    bgNo: string
) => {
    try {
        const report4Rows = await getReport04DataService(effectiveDateStr, employeeId, userGroupNo, division, orgUnitNo, bgNo);
        const baseRows = report4Rows.map((rawRow, index) => {
            const row = (rawRow && typeof rawRow === 'object') ? rawRow as Record<string, unknown> : {};
            const q1 = toNumberOrZero(row.frame_staff_21);
            const q2 = toNumberOrZero(row.frame_staff_18_20);
            const q3 = toNumberOrZero(row.frame_staff_16_17);
            const q4 = toNumberOrZero(row.frame_staff_14_15);
            const q5 = toNumberOrZero(row.frame_staff_11_13);
            const q6 = toNumberOrZero(row.frame_staff_9_10);
            const q7 = toNumberOrZero(row.frame_staff_under_8);
            const qTotal = toNumberOrZero(row.frame_staff_total) || (q1 + q2 + q3 + q4 + q5 + q6 + q7);

            const m1 = toNumberOrZero(row.people_normal_21);
            const m2 = toNumberOrZero(row.people_normal_18_20);
            const m3 = toNumberOrZero(row.people_normal_16_17);
            const m4 = toNumberOrZero(row.people_normal_14_15);
            const m5 = toNumberOrZero(row.people_normal_11_13);
            const m6 = toNumberOrZero(row.people_normal_9_10);
            const m7 = toNumberOrZero(row.people_normal_under_8);
            const mTotal = toNumberOrZero(row.people_normal_total) || (m1 + m2 + m3 + m4 + m5 + m6 + m7);

            const t1 = toNumberOrZero(row.vacancy_21);
            const t2 = toNumberOrZero(row.vacancy_18_20);
            const t3 = toNumberOrZero(row.vacancy_16_17);
            const t4 = toNumberOrZero(row.vacancy_14_15);
            const t5 = toNumberOrZero(row.vacancy_11_13);
            const t6 = toNumberOrZero(row.vacancy_9_10);
            const t7 = toNumberOrZero(row.vacancy_under_8);
            const vacancyTotal = toNumberOrZero(row.vacancy_total) || (t1 + t2 + t3 + t4 + t5 + t6 + t7);
            const recruitTotal = toNumberOrZero(row.recruit_total);

            return {
                key: `r7-${index + 1}`,
                org_unit_no: toTrimText(row.unit_code),
                parent_org_unit_no: toTrimText(row.line_of_work),
                lvl: 0,
                bg_no: '',
                business_unit: toTrimText(row.business_unit),
                unit_level: '',
                unit_level_name: toTrimText(row.level),
                unit_short: toTrimText(row.unit_short),
                unit_name: toTrimText(row.unit_name),

                q_1: q1,
                q_2: q2,
                q_3: q3,
                q_4: q4,
                q_5: q5,
                q_6: q6,
                q_7: q7,
                q_total: qTotal,
                m_1: m1,
                m_2: m2,
                m_3: m3,
                m_4: m4,
                m_5: m5,
                m_6: m6,
                m_7: m7,
                m_total: mTotal,
                f_1: 0,
                f_2: 0,
                f_3: 0,
                f_4: 0,
                f_5: 0,
                f_6: 0,
                f_7: 0,
                f_total: recruitTotal,
                t_1: t1,
                t_2: t2,
                t_3: t3,
                t_4: t4,
                t_5: t5,
                t_6: t6,
                t_7: t7,
                total: vacancyTotal,
                q_8: toNumberOrZero(row.contact_out),
                q_10: toNumberOrZero(row.contact_out_sub),
                remark: toTrimText(row.remark)
            };
        });
        const effectiveDate = new Date(effectiveDateStr);
        const pool = await poolPromise;

        const quotaRequest = pool.request();
        quotaRequest.input('EffectiveDate', sql.DateTime, effectiveDate);
        const quotaRes = await quotaRequest.query(`
            SELECT
                OrgUnitNo,
                SUM(ISNULL(L9907, 0)) AS q_1,
                SUM(ISNULL(L9906, 0)) AS q_2,
                SUM(ISNULL(L9905, 0)) AS q_3,
                SUM(ISNULL(L9904, 0)) AS q_4,
                SUM(ISNULL(L9903, 0)) AS q_5,
                SUM(ISNULL(L9902, 0)) AS q_6,
                SUM(ISNULL(L9901, 0)) AS q_7,
                SUM(ISNULL(L9907, 0) + ISNULL(L9906, 0) + ISNULL(L9905, 0) + ISNULL(L9904, 0)
                    + ISNULL(L9903, 0) + ISNULL(L9902, 0) + ISNULL(L9901, 0)) AS q_total,
                SUM(ISNULL(L9908, 0)) AS q_8,
                SUM(ISNULL(L9910, 0)) AS q_10
            FROM MP_QuotaN
            WHERE EffectiveDate = DATEADD(month, DATEDIFF(month, 0, @EffectiveDate), 0)
            GROUP BY OrgUnitNo
        `);
        const quotaMap = new Map<string, Report7QuotaTotals>();
        const quotaRows = Array.isArray(quotaRes.recordset) ? quotaRes.recordset : [];
        quotaRows.forEach((raw) => {
            const row = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
            const { num, text } = buildRowAccessor(row);
            const orgUnitNo = text('OrgUnitNo');
            if (!orgUnitNo) return;
            quotaMap.set(orgUnitNo, {
                q_1: num('q_1'),
                q_2: num('q_2'),
                q_3: num('q_3'),
                q_4: num('q_4'),
                q_5: num('q_5'),
                q_6: num('q_6'),
                q_7: num('q_7'),
                q_total: num('q_total'),
                q_8: num('q_8'),
                q_10: num('q_10')
            });
        });

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
            const quota = quotaMap.get(orgUnitNo);

            const q1 = quota?.q_1 ?? toNumberOrZero(row.q_1);
            const q2 = quota?.q_2 ?? toNumberOrZero(row.q_2);
            const q3 = quota?.q_3 ?? toNumberOrZero(row.q_3);
            const q4 = quota?.q_4 ?? toNumberOrZero(row.q_4);
            const q5 = quota?.q_5 ?? toNumberOrZero(row.q_5);
            const q6 = quota?.q_6 ?? toNumberOrZero(row.q_6);
            const q7 = quota?.q_7 ?? toNumberOrZero(row.q_7);
            const qTotal = quota?.q_total ?? toNumberOrZero(row.q_total);
            const contractOut = quota?.q_8 ?? toNumberOrZero(row.q_8);
            const subContract = quota?.q_10 ?? toNumberOrZero(row.q_10);

            const m1 = toNumberOrZero(row.m_1);
            const m2 = toNumberOrZero(row.m_2);
            const m3 = toNumberOrZero(row.m_3);
            const m4 = toNumberOrZero(row.m_4);
            const m5 = toNumberOrZero(row.m_5);
            const m6 = toNumberOrZero(row.m_6);
            const m7 = toNumberOrZero(row.m_7);
            const mTotal = toNumberOrZero(row.m_total);
            const recruitTotal = toNumberOrZero(row.f_total);

            const mpVp = landscape?.vp ?? 0;
            const mpDm = landscape?.dm ?? 0;
            const mpSr = landscape?.sr ?? 0;
            const mpJr = landscape?.jr ?? 0;
            const mpTotal = mpVp + mpDm + mpSr + mpJr;
            const calculated = calculateReport7ShapeGapMetrics({
                q_4: q4,
                q_5: q5,
                q_6: q6,
                q_7: q7,
                q_total: qTotal,
                contract_out: contractOut,
                mp_vp: mpVp,
                mp_dm: mpDm,
                mp_sr: mpSr,
                mp_jr: mpJr
            });

            return {
                ...row,
                business_unit: bgNameMap.get(bgNoCode) || toTrimText(row.business_unit) || bgNoCode,
                unit_short: cleanReport7UnitShort(row.unit_short),
                q_1: q1,
                q_2: q2,
                q_3: q3,
                q_4: q4,
                q_5: q5,
                q_6: q6,
                q_7: q7,
                q_total: qTotal,
                t_1: q1 - m1,
                t_2: q2 - m2,
                t_3: q3 - m3,
                t_4: q4 - m4,
                t_5: q5 - m5,
                t_6: q6 - m6,
                t_7: q7 - m7,
                total: qTotal - mTotal - recruitTotal,
                q_8: contractOut,
                q_10: subContract,
                frame_contract_out: contractOut,
                frame_sub_contract: subContract,
                recruit_total: recruitTotal,
                vacancy_total: qTotal - mTotal - recruitTotal,
                mp_vp: round2(mpVp),
                mp_dm: round2(mpDm),
                mp_sr: round2(mpSr),
                mp_jr: round2(mpJr),
                mp_total: round2(mpTotal),
                shape_vp: round2(calculated.shape_vp),
                shape_dm: round2(calculated.shape_dm),
                shape_sr: round2(calculated.shape_sr),
                shape_jr: round2(calculated.shape_jr),
                shape_total: round2(calculated.shape_total),
                gap_vp: round2(calculated.gap_vp),
                gap_dm: round2(calculated.gap_dm),
                gap_sr: round2(calculated.gap_sr),
                gap_jr: round2(calculated.gap_jr),
                gap_total: round2(calculated.gap_total)
            };
        });

        return enrichedRows;
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

const normalizeReport09EmployeeIdParam = (value: unknown): string => {
    const raw = toTrimText(value).toUpperCase();
    if (!raw) return 'SYSTEM';
    const match = raw.match(/[A-Z]\d{7}/);
    if (match) return match[0];
    return raw.slice(0, 8) || 'SYSTEM';
};

const normalizeReport09UserGroupNoParam = (value: unknown): string => {
    const raw = toTrimText(value);
    if (!raw) return '';
    if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, '0');
    const match = raw.match(/\b(\d{1,2})\b/);
    return match ? match[1].padStart(2, '0') : '';
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
        node[`y${year}_cut_sup`] = 0;
        node[`y${year}_cut_bu`] = 0;
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

const resolveReport09LevelGroupColumns = async (
    pool: any
): Promise<{ activeColumn: string | null; orderColumn: string | null }> => {
    const levelMeta = await getTableMeta(pool, REPORT09_LEVEL_GROUP_TABLE_CANDIDATES);
    if (!levelMeta) return { activeColumn: null, orderColumn: null };

    return {
        activeColumn: pickColumnName(levelMeta.columns, REPORT09_LEVEL_GROUP_ACTIVE_COL_CANDIDATES),
        orderColumn: pickColumnName(levelMeta.columns, REPORT09_LEVEL_GROUP_ORDER_COL_CANDIDATES)
    };
};

const getReport09RetirementLevelFilter = async (
    pool: any,
    effectiveYear: number
): Promise<{ selectedLevelGroupNo: string; allowedLevelGroupNos: string[] }> => {
    try {
        const effectiveYearAD = effectiveYear > 2500 ? effectiveYear - 543 : effectiveYear;
        const effectiveYearBE = effectiveYearAD + 543;
        const { activeColumn, orderColumn } = await resolveReport09LevelGroupColumns(pool);
        const activeFilter = activeColumn
            ? `AND ISNULL(TRY_CONVERT(int, ${escapeSqlIdentifier(activeColumn)}), 0) = 1`
            : '';
        const activeFilterForAlias = activeColumn
            ? `AND ISNULL(TRY_CONVERT(int, lg.${escapeSqlIdentifier(activeColumn)}), 0) = 1`
            : '';
        const orderExpr = orderColumn
            ? `TRY_CONVERT(int, ${escapeSqlIdentifier(orderColumn)})`
            : 'NULL';
        const orderExprForAlias = orderColumn
            ? `TRY_CONVERT(int, lg.${escapeSqlIdentifier(orderColumn)})`
            : 'NULL';

        const selectedResult = await pool.request()
            .input('EffectiveYearAD', sql.Int, effectiveYearAD)
            .input('EffectiveYearBE', sql.Int, effectiveYearBE)
            .query(`
                SELECT TOP (1)
                    LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo
                FROM MP_BUSupportRateRemark
                WHERE EffectiveYear IN (@EffectiveYearAD, @EffectiveYearBE)
                  AND NULLIF(LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))), '') IS NOT NULL
                ORDER BY
                    CASE WHEN EffectiveYear = @EffectiveYearBE THEN 0 ELSE 1 END,
                    TRY_CONVERT(bigint, BUSupportRateRemarkID) DESC
            `);

        const selectedLevelGroupNo = toTrimText(selectedResult.recordset?.[0]?.LevelGroupNo);
        if (!selectedLevelGroupNo) {
            return { selectedLevelGroupNo: '', allowedLevelGroupNos: [] };
        }

        const levelsResult = await pool.request()
            .input('SelectedLevelGroupNo', sql.VarChar(16), selectedLevelGroupNo)
            .query(`
                ;WITH Selected AS (
                    SELECT TOP (1)
                        ${orderExpr} AS SelectedOrder
                    FROM MP_LevelGroup
                    WHERE LTRIM(RTRIM(CAST(LevelGroupNo AS nvarchar(16)))) = @SelectedLevelGroupNo
                      ${activeFilter}
                )
                SELECT
                    LTRIM(RTRIM(CAST(lg.LevelGroupNo AS nvarchar(16)))) AS LevelGroupNo
                FROM MP_LevelGroup lg
                CROSS JOIN Selected s
                WHERE s.SelectedOrder IS NOT NULL
                  ${activeFilterForAlias}
                  AND ${orderExprForAlias} <= s.SelectedOrder
                ORDER BY
                    ${orderExprForAlias} DESC,
                    LTRIM(RTRIM(CAST(lg.LevelGroupNo AS nvarchar(16))))
            `);

        const levelRows = Array.isArray(levelsResult.recordset)
            ? levelsResult.recordset as Array<Record<string, unknown>>
            : [];
        const allowedLevelGroupNos: string[] = Array.from(
            new Set(
                levelRows
                    .map((row: Record<string, unknown>) => toTrimText(row.LevelGroupNo))
                    .filter((value): value is string => Boolean(value))
            )
        );

        if (!allowedLevelGroupNos.length) {
            return {
                selectedLevelGroupNo,
                allowedLevelGroupNos: [selectedLevelGroupNo]
            };
        }

        return { selectedLevelGroupNo, allowedLevelGroupNos };
    } catch {
        return { selectedLevelGroupNo: '', allowedLevelGroupNos: [] };
    }
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
    const unitMeta = await getObjectMeta(pool, REPORT09_UNIT_FN_CANDIDATES);
    if (!infoMeta || !positionMeta) return new Map();

    const retireYearCol = pickColumnName(infoMeta.columns, REPORT09_RETIRE_YEAR_COL_CANDIDATES);
    const infoEmployeeCol = pickColumnName(infoMeta.columns, REPORT09_INFO_EMPLOYEE_COL_CANDIDATES);
    const infoSecondmentTextCol = pickColumnName(infoMeta.columns, REPORT09_INFO_SECONDMENT_TEXT_COL_CANDIDATES);
    const infoPosCol = pickColumnName(infoMeta.columns, REPORT09_INFO_POSITION_COL_CANDIDATES);
    const positionIdCol = pickColumnName(positionMeta.columns, REPORT09_POSITION_ID_COL_CANDIDATES);
    const orgCol = pickColumnName(positionMeta.columns, REPORT09_ORG_COL_CANDIDATES);
    const orgTypeCol = pickColumnName(positionMeta.columns, REPORT09_ORG_TYPE_COL_CANDIDATES);
    const levelCol = pickColumnName(positionMeta.columns, REPORT09_LEVEL_COL_CANDIDATES);
    const bsTypeCol = pickColumnName(positionMeta.columns, REPORT09_BS_TYPE_COL_CANDIDATES);
    if (!retireYearCol || !infoPosCol || !positionIdCol || !orgCol || !orgTypeCol || !bsTypeCol) return new Map();

    const unitBgCol = pickColumnName(unitMeta?.columns || new Map<string, string>(), REPORT09_UNIT_BG_COL_CANDIDATES);
    const unitNameCol = pickColumnName(unitMeta?.columns || new Map<string, string>(), REPORT09_UNIT_NAME_COL_CANDIDATES);
    const unitAbbrCol = pickColumnName(unitMeta?.columns || new Map<string, string>(), REPORT09_UNIT_ABBR_COL_CANDIDATES);

    const signPosCol = pickColumnName(positionMeta.columns, REPORT09_SIGN_POS_COL_CANDIDATES);
    const employeeCol = pickColumnName(positionMeta.columns, REPORT09_EMPLOYEE_COL_CANDIDATES);

    const signPosCondition = signPosCol
        ? `AND pos.${escapeSqlIdentifier(signPosCol)} = '100'`
        : '';
    const infoSecondmentCondition = infoSecondmentTextCol
        ? `AND info.${escapeSqlIdentifier(infoSecondmentTextCol)} IN ('Employee', 'EMPLOYEE', 'employee')`
        : '';
    const countDistinctEmployeeExpr = infoEmployeeCol
        ? `info.${escapeSqlIdentifier(infoEmployeeCol)}`
        : employeeCol
            ? `pos.${escapeSqlIdentifier(employeeCol)}`
            : '';
    const countExpr = countDistinctEmployeeExpr
        ? `COUNT(DISTINCT ${countDistinctEmployeeExpr})`
        : 'COUNT(1)';

    const orgKeyExpr = structureIsSecondment === 0
        ? `
            CASE
                WHEN ISNULL(unit.IsSecondment, 0) = 1
                     AND rt.Reportto IS NOT NULL
                     AND rt.Reportto <> ''
                    THEN rt.Reportto
                ELSE pos.${escapeSqlIdentifier(orgCol)}
            END
        `
        : `pos.${escapeSqlIdentifier(orgCol)}`;

    const mappedOrgForUnitJoinExpr = structureIsSecondment === 0
        ? `
            CASE
                WHEN ISNULL(unit.IsSecondment, 0) = 1
                     AND rt.Reportto IS NOT NULL
                     AND rt.Reportto <> ''
                    THEN rt.Reportto
                ELSE pos.${escapeSqlIdentifier(orgCol)}
            END
        `
        : `pos.${escapeSqlIdentifier(orgCol)}`;

    const joinStructureForMapping = `
        LEFT JOIN fn_InterfaceUnit(@EffectiveDate) unit
            ON unit.OrgUnitNo = pos.${escapeSqlIdentifier(orgCol)}
        LEFT JOIN fn_InterfaceReportto(@EffectiveDate) rt
            ON rt.OrgUnitNo = pos.${escapeSqlIdentifier(orgCol)}
        LEFT JOIN fn_InterfaceUnit(@EffectiveDate) mappedUnit
            ON mappedUnit.OrgUnitNo = ${mappedOrgForUnitJoinExpr}
        `;

    const sourceEmployeeExpr = infoEmployeeCol
        ? `info.${escapeSqlIdentifier(infoEmployeeCol)}`
        : employeeCol
            ? `pos.${escapeSqlIdentifier(employeeCol)}`
            : '';

    const effectiveRetireYearExpr = sourceEmployeeExpr
        ? `
            CASE
                WHEN delay.delay_year = ${REPORT09_NON_COUNT_DELAY_YEAR}
                    THEN info.${escapeSqlIdentifier(retireYearCol)}
                WHEN delay.delay_year IS NOT NULL
                    THEN delay.delay_year
                ELSE info.${escapeSqlIdentifier(retireYearCol)}
            END
        `
        : `info.${escapeSqlIdentifier(retireYearCol)}`;

    const joinDelayForOverride = sourceEmployeeExpr
        ? `
        LEFT JOIN (
            SELECT employee_id, delay_year
            FROM (
                SELECT
                    EmployeeID AS employee_id,
                    DelayYear AS delay_year,
                    ROW_NUMBER() OVER (
                        PARTITION BY EmployeeID
                        ORDER BY COALESCE(UpdateDate, CreateDate) DESC,
                                 TRY_CONVERT(bigint, DelayID) DESC
                    ) AS rn
                FROM MP_Delay
                WHERE ISNULL(DelayStatus, 1) = 1
                  AND EmployeeID <> ''
                  AND DelayYear IS NOT NULL
            ) d
            WHERE d.rn = 1
        ) delay
            ON delay.employee_id = ${sourceEmployeeExpr}
        `
        : '';

    const { allowedLevelGroupNos } = await getReport09RetirementLevelFilter(pool, effectiveYear);
    const levelFilterCondition = levelCol && allowedLevelGroupNos.length > 0
        ? `AND pos.${escapeSqlIdentifier(levelCol)} IN (${allowedLevelGroupNos.map((value) => `'${escapeSqlString(value)}'`).join(',')})`
        : '';

    const unitBgExpr = unitBgCol
        ? `unit.${escapeSqlIdentifier(unitBgCol)}`
        : `''`;
    const mappedUnitBgExpr = unitBgCol
        ? `mappedUnit.${escapeSqlIdentifier(unitBgCol)}`
        : `''`;
    const unitNameExpr = unitNameCol
        ? `UPPER(unit.${escapeSqlIdentifier(unitNameCol)})`
        : `''`;
    const unitAbbrExpr = unitAbbrCol
        ? `UPPER(unit.${escapeSqlIdentifier(unitAbbrCol)})`
        : `''`;
    const hoConditions = [
        unitBgCol ? `${unitBgExpr} = '905'` : '',
        unitNameCol ? `${unitNameExpr} IN (N'HO', N'HEAD OFFICE', N'สำนักงานใหญ่')` : '',
        unitAbbrCol ? `${unitAbbrExpr} = N'HO'` : ''
    ].filter(Boolean);
    const isHoExpr = hoConditions.length > 0
        ? `(${hoConditions.join(' OR ')})`
        : '1 = 0';
    const report09BucketExpr = `
        CASE
            WHEN ${isHoExpr} THEN 2
            WHEN ${mappedUnitBgExpr} = '905'
                 AND pos.${escapeSqlIdentifier(bsTypeCol)} IS NULL THEN 2
            WHEN pos.${escapeSqlIdentifier(orgTypeCol)} = 2
                 AND pos.${escapeSqlIdentifier(bsTypeCol)} = 2 THEN 2
            ELSE 1
        END
    `;

    const query = `
        SELECT
            ${orgKeyExpr} AS org_unit_id,
            ${effectiveRetireYearExpr} AS retire_year,
            ${report09BucketExpr} AS bs_type,
            ${countExpr} AS retire_count
        FROM ${infoMeta.fullName} info
        INNER JOIN ${positionMeta.fullName} pos
            ON pos.${escapeSqlIdentifier(positionIdCol)} = info.${escapeSqlIdentifier(infoPosCol)}
        ${joinDelayForOverride}
        ${joinStructureForMapping}
        WHERE ${effectiveRetireYearExpr} BETWEEN @FromYear AND @ToYear
          AND ${orgKeyExpr} <> ''
          ${infoSecondmentCondition}
          ${levelFilterCondition}
          ${signPosCondition}
        GROUP BY
            ${orgKeyExpr},
            ${effectiveRetireYearExpr},
            ${report09BucketExpr}
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

export const getReport09AuditService = async (
    effectiveYear: number
): Promise<{
    metadata: {
        effectiveYear: number;
        displayYears: number[];
        selectedLevelGroupNo: string;
        allowedLevelGroupNos: string[];
        stageDescriptions: Array<{ stage_code: string; stage_name: string; description: string }>;
    };
    rows: Report09AuditRow[];
}> => {
    const safeEffectiveYear = toNumberOrZero(effectiveYear) || (new Date().getFullYear() + 543);
    const effectiveYearAD = safeEffectiveYear > 2500 ? safeEffectiveYear - 543 : safeEffectiveYear;
    const structureDate = new Date(`${effectiveYearAD}-01-01T00:00:00`);
    const displayYears = buildReport09Years(safeEffectiveYear);
    const fromYear = displayYears[0];
    const toYear = displayYears[displayYears.length - 1];
    const structureIsSecondment = 0;
    const pool = await poolPromise;

    const infoMeta = await getTableMeta(pool, REPORT09_INFO_TABLE_CANDIDATES);
    const positionMeta = await getTableMeta(pool, REPORT09_POSITION_TABLE_CANDIDATES);
    const unitMeta = await getObjectMeta(pool, REPORT09_UNIT_FN_CANDIDATES);
    if (!infoMeta || !positionMeta) {
        throw new Error('Report09 source tables are unavailable');
    }

    const retireYearCol = pickColumnName(infoMeta.columns, REPORT09_RETIRE_YEAR_COL_CANDIDATES);
    const infoEmployeeCol = pickColumnName(infoMeta.columns, REPORT09_INFO_EMPLOYEE_COL_CANDIDATES);
    const infoSecondmentTextCol = pickColumnName(infoMeta.columns, REPORT09_INFO_SECONDMENT_TEXT_COL_CANDIDATES);
    const infoPosCol = pickColumnName(infoMeta.columns, REPORT09_INFO_POSITION_COL_CANDIDATES);
    const positionIdCol = pickColumnName(positionMeta.columns, REPORT09_POSITION_ID_COL_CANDIDATES);
    const orgCol = pickColumnName(positionMeta.columns, REPORT09_ORG_COL_CANDIDATES);
    const orgTypeCol = pickColumnName(positionMeta.columns, REPORT09_ORG_TYPE_COL_CANDIDATES);
    const levelCol = pickColumnName(positionMeta.columns, REPORT09_LEVEL_COL_CANDIDATES);
    const bsTypeCol = pickColumnName(positionMeta.columns, REPORT09_BS_TYPE_COL_CANDIDATES);
    if (!retireYearCol || !infoPosCol || !positionIdCol || !orgCol || !orgTypeCol || !bsTypeCol) {
        throw new Error('Report09 required columns are unavailable');
    }

    const unitBgCol = pickColumnName(unitMeta?.columns || new Map<string, string>(), REPORT09_UNIT_BG_COL_CANDIDATES);
    const unitNameCol = pickColumnName(unitMeta?.columns || new Map<string, string>(), REPORT09_UNIT_NAME_COL_CANDIDATES);
    const unitAbbrCol = pickColumnName(unitMeta?.columns || new Map<string, string>(), REPORT09_UNIT_ABBR_COL_CANDIDATES);
    const signPosCol = pickColumnName(positionMeta.columns, REPORT09_SIGN_POS_COL_CANDIDATES);
    const employeeCol = pickColumnName(positionMeta.columns, REPORT09_EMPLOYEE_COL_CANDIDATES);

    const sourceEmployeeExpr = infoEmployeeCol
        ? `LTRIM(RTRIM(CAST(info.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(64))))`
        : employeeCol
            ? `LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(employeeCol)} AS nvarchar(64))))`
            : `LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64))))`;
    const employeeKeyExpr = `NULLIF(${sourceEmployeeExpr}, '')`;
    const originalOrgExpr = `LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(orgCol)} AS nvarchar(32))))`;
    const mappedOrgExpr = structureIsSecondment === 0
        ? `
            CASE
                WHEN ISNULL(srcUnit.IsSecondment, 0) = 1
                     AND rt.Reportto IS NOT NULL
                     AND LTRIM(RTRIM(CAST(rt.Reportto AS nvarchar(32)))) <> ''
                    THEN LTRIM(RTRIM(CAST(rt.Reportto AS nvarchar(32))))
                ELSE ${originalOrgExpr}
            END
        `
        : originalOrgExpr;
    const effectiveRetireYearExpr = `
        CASE
            WHEN delay.delay_year = ${REPORT09_NON_COUNT_DELAY_YEAR}
                THEN TRY_CONVERT(int, info.${escapeSqlIdentifier(retireYearCol)})
            WHEN delay.delay_year IS NOT NULL
                THEN delay.delay_year
            ELSE TRY_CONVERT(int, info.${escapeSqlIdentifier(retireYearCol)})
        END
    `;
    const employeeConditionExpr = infoSecondmentTextCol
        ? `CASE WHEN UPPER(LTRIM(RTRIM(CAST(info.${escapeSqlIdentifier(infoSecondmentTextCol)} AS nvarchar(64))))) = 'EMPLOYEE' THEN 1 ELSE 0 END`
        : '1';
    const signPosConditionExpr = signPosCol
        ? `CASE WHEN TRY_CONVERT(int, pos.${escapeSqlIdentifier(signPosCol)}) = 100 THEN 1 ELSE 0 END`
        : '1';

    const { selectedLevelGroupNo, allowedLevelGroupNos } = await getReport09RetirementLevelFilter(pool, safeEffectiveYear);
    const levelConditionExpr = levelCol && allowedLevelGroupNos.length > 0
        ? `CASE WHEN LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(levelCol)} AS nvarchar(16)))) IN (${allowedLevelGroupNos.map((value) => `'${escapeSqlString(value)}'`).join(',')}) THEN 1 ELSE 0 END`
        : '1';

    const unitBgExpr = unitBgCol
        ? `LTRIM(RTRIM(CAST(srcUnit.${escapeSqlIdentifier(unitBgCol)} AS nvarchar(32))))`
        : `''`;
    const mappedUnitBgExpr = unitBgCol
        ? `LTRIM(RTRIM(CAST(mappedUnit.${escapeSqlIdentifier(unitBgCol)} AS nvarchar(32))))`
        : `''`;
    const unitNameExpr = unitNameCol
        ? `UPPER(LTRIM(RTRIM(CAST(srcUnit.${escapeSqlIdentifier(unitNameCol)} AS nvarchar(255)))))`
        : `''`;
    const unitAbbrExpr = unitAbbrCol
        ? `UPPER(LTRIM(RTRIM(CAST(srcUnit.${escapeSqlIdentifier(unitAbbrCol)} AS nvarchar(255)))))`
        : `''`;
    const mappedUnitNameExpr = unitNameCol
        ? `LTRIM(RTRIM(CAST(mappedUnit.${escapeSqlIdentifier(unitNameCol)} AS nvarchar(255))))`
        : mappedOrgExpr;
    const mappedUnitAbbrExpr = unitAbbrCol
        ? `LTRIM(RTRIM(CAST(mappedUnit.${escapeSqlIdentifier(unitAbbrCol)} AS nvarchar(255))))`
        : mappedOrgExpr;
    const hoConditions = [
        unitBgCol ? `${unitBgExpr} = '905'` : '',
        unitNameCol ? `${unitNameExpr} IN (N'HO', N'HEAD OFFICE', N'สำนักงานใหญ่')` : '',
        unitAbbrCol ? `${unitAbbrExpr} = N'HO'` : ''
    ].filter(Boolean);
    const isHoExpr = hoConditions.length > 0
        ? `(${hoConditions.join(' OR ')})`
        : '1 = 0';
    const report09BucketExpr = `
        CASE
            WHEN ${isHoExpr} THEN N'Support'
            WHEN ${mappedUnitBgExpr} = '905'
                 AND NULLIF(LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(bsTypeCol)} AS nvarchar(32)))), '') IS NULL THEN N'Support'
            WHEN TRY_CONVERT(int, pos.${escapeSqlIdentifier(orgTypeCol)}) = 2
                 AND TRY_CONVERT(int, pos.${escapeSqlIdentifier(bsTypeCol)}) = 2 THEN N'Support'
            ELSE N'BU'
        END
    `;

    const query = `
        ;WITH delay AS (
            SELECT employee_id, delay_year
            FROM (
                SELECT
                    LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(32)))) AS employee_id,
                    TRY_CONVERT(int, DelayYear) AS delay_year,
                    ROW_NUMBER() OVER (
                        PARTITION BY LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(32))))
                        ORDER BY COALESCE(UpdateDate, CreateDate) DESC,
                                 TRY_CONVERT(bigint, DelayID) DESC
                    ) AS rn
                FROM MP_Delay
                WHERE ISNULL(DelayStatus, 1) = 1
                  AND LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(32)))) <> ''
                  AND TRY_CONVERT(int, DelayYear) IS NOT NULL
            ) d
            WHERE d.rn = 1
        ),
        base AS (
            SELECT
                ${employeeKeyExpr} AS employee_key,
                LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) AS position_key,
                ${mappedOrgExpr} AS org_unit_id,
                ${mappedUnitAbbrExpr} AS unit_abbr,
                ${mappedUnitNameExpr} AS unit_name,
                ${effectiveRetireYearExpr} AS retire_year,
                ${report09BucketExpr} AS bs_type,
                ${employeeConditionExpr} AS pass_employee,
                ${signPosConditionExpr} AS pass_signpos,
                ${levelConditionExpr} AS pass_level
            FROM ${infoMeta.fullName} info
            INNER JOIN ${positionMeta.fullName} pos
                ON LTRIM(RTRIM(CAST(pos.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) =
                   LTRIM(RTRIM(CAST(info.${escapeSqlIdentifier(infoPosCol)} AS nvarchar(64))))
            LEFT JOIN delay
                ON delay.employee_id = ${sourceEmployeeExpr}
            LEFT JOIN fn_InterfaceUnit(@EffectiveDate) srcUnit
                ON LTRIM(RTRIM(CAST(srcUnit.OrgUnitNo AS nvarchar(32)))) = ${originalOrgExpr}
            LEFT JOIN fn_InterfaceReportto(@EffectiveDate) rt
                ON LTRIM(RTRIM(CAST(rt.OrgUnitNo AS nvarchar(32)))) = ${originalOrgExpr}
            LEFT JOIN fn_InterfaceUnit(@EffectiveDate) mappedUnit
                ON LTRIM(RTRIM(CAST(mappedUnit.OrgUnitNo AS nvarchar(32)))) = ${mappedOrgExpr}
            WHERE ${effectiveRetireYearExpr} BETWEEN @FromYear AND @ToYear
        )
        SELECT
            stage.stage_code,
            stage.stage_name,
            NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '') AS org_unit_id,
            COALESCE(NULLIF(LTRIM(RTRIM(CAST(base.unit_abbr AS nvarchar(255)))), ''), NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '')) AS unit_abbr,
            COALESCE(NULLIF(LTRIM(RTRIM(CAST(base.unit_name AS nvarchar(255)))), ''), NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '')) AS unit_name,
            base.retire_year,
            base.bs_type,
            COUNT_BIG(1) AS position_rows,
            COUNT(DISTINCT COALESCE(base.employee_key, CONCAT(N'POSITION:', base.position_key))) AS employee_count
        FROM base
        CROSS APPLY (VALUES
            (N'01', N'ช่วงปีเกษียณ', 1),
            (N'02', N'เฉพาะ Employee', base.pass_employee),
            (N'03', N'เฉพาะ SignPos=100', base.pass_employee * base.pass_signpos),
            (N'04', N'เฉพาะ Level ที่ใช้คำนวณ', base.pass_employee * base.pass_signpos * base.pass_level),
            (N'05', N'มีหน่วยงานหลัง map secondment', base.pass_employee * base.pass_signpos * base.pass_level * CASE WHEN NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '') IS NOT NULL THEN 1 ELSE 0 END)
        ) stage(stage_code, stage_name, pass_filter)
        WHERE stage.pass_filter = 1
        GROUP BY
            stage.stage_code,
            stage.stage_name,
            NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), ''),
            COALESCE(NULLIF(LTRIM(RTRIM(CAST(base.unit_abbr AS nvarchar(255)))), ''), NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '')),
            COALESCE(NULLIF(LTRIM(RTRIM(CAST(base.unit_name AS nvarchar(255)))), ''), NULLIF(LTRIM(RTRIM(CAST(base.org_unit_id AS nvarchar(32)))), '')),
            base.retire_year,
            base.bs_type
        ORDER BY
            stage.stage_code,
            org_unit_id,
            base.retire_year,
            base.bs_type
    `;

    const result = await pool.request()
        .input('FromYear', sql.Int, fromYear)
        .input('ToYear', sql.Int, toYear)
        .input('EffectiveDate', sql.DateTime, structureDate)
        .query(query);

    const rows = (Array.isArray(result.recordset) ? result.recordset : [])
        .map((row: Record<string, unknown>): Report09AuditRow => ({
            stage_code: toTrimText(row.stage_code),
            stage_name: toTrimText(row.stage_name),
            org_unit_id: normalizeReport09OrgUnitKey(row.org_unit_id),
            unit_abbr: toTrimText(row.unit_abbr),
            unit_name: toTrimText(row.unit_name),
            retire_year: toNumberOrZero(row.retire_year),
            bs_type: toTrimText(row.bs_type) === 'Support' ? 'Support' : 'BU',
            position_rows: toNumberOrZero(row.position_rows),
            employee_count: toNumberOrZero(row.employee_count)
        }));

    return {
        metadata: {
            effectiveYear: safeEffectiveYear,
            displayYears,
            selectedLevelGroupNo,
            allowedLevelGroupNos,
            stageDescriptions: [
                { stage_code: '01', stage_name: 'ช่วงปีเกษียณ', description: 'Join infodata + InterfacePosition และปีเกษียณอยู่ในช่วง 5 ปีที่แสดง โดยใช้ MP_Delay override แล้ว' },
                { stage_code: '02', stage_name: 'เฉพาะ Employee', description: 'ผ่านเงื่อนไข infodata.Secondment_text = Employee' },
                { stage_code: '03', stage_name: 'เฉพาะ SignPos=100', description: 'ผ่านเงื่อนไข SignPos = 100 ถ้าตารางมี column นี้' },
                { stage_code: '04', stage_name: 'เฉพาะ Level ที่ใช้คำนวณ', description: 'ผ่าน LevelGroupNo ตาม MP_BUSupportRateRemark และ MP_LevelGroup' },
                { stage_code: '05', stage_name: 'มีหน่วยงานหลัง map secondment', description: 'ผ่านทุกเงื่อนไขสุดท้าย และมี OrgUnit หลัง map secondment ไป Reportto' }
            ]
        },
        rows
    };
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

const createDefaultReport09YearRateMap = (displayYears: number[]): Report09YearRateMap => {
    const map: Report09YearRateMap = new Map();
    displayYears.forEach((year) => {
        map.set(year, {
            support: { rate: 1, base: 1 },
            bu: { rate: 1, base: 1 }
        });
    });
    return map;
};

const normalizeReport09RatePart = (value: unknown): number => {
    const parsed = Math.trunc(toNumberOrZero(value));
    return parsed > 0 ? parsed : 1;
};

const getReport09YearRateMap = async (
    pool: any,
    effectiveYear: number,
    displayYears: number[]
): Promise<Report09YearRateMap> => {
    const yearRateMap = createDefaultReport09YearRateMap(displayYears);
    try {
        const effectiveYearAD = effectiveYear > 2500 ? effectiveYear - 543 : effectiveYear;
        const effectiveYearBE = effectiveYearAD + 543;
        const displayYearSet = new Set(displayYears);
        const queryYearList = Array.from(
            new Set(
                displayYears.flatMap((year) => {
                    const yearAD = year > 2500 ? year - 543 : year;
                    const yearBE = yearAD + 543;
                    return [yearAD, yearBE];
                })
            )
        );

        if (!queryYearList.length) return yearRateMap;

        const result = await pool.request()
            .input('EffectiveYearAD', sql.Int, effectiveYearAD)
            .input('EffectiveYearBE', sql.Int, effectiveYearBE)
            .query(`
                SELECT
                    TRY_CONVERT(int, [Year]) AS [Year],
                    TRY_CONVERT(int, TypeRate) AS TypeRate,
                    TRY_CONVERT(int, Rate) AS Rate,
                    TRY_CONVERT(int, Base) AS Base
                FROM MP_BUSupportRate
                WHERE EffectiveYear IN (@EffectiveYearAD, @EffectiveYearBE)
                  AND TRY_CONVERT(int, [Year]) IN (${queryYearList.join(',')})
                  AND ISNULL(TRY_CONVERT(int, BUSupportRateStatus), 1) = 1
            `);

        const rows = Array.isArray(result.recordset) ? result.recordset as Array<Record<string, unknown>> : [];
        rows.forEach((row) => {
            const rawYear = toNumberOrZero(row.Year);
            if (!rawYear) return;
            const yearBE = rawYear > 2500 ? rawYear : rawYear + 543;
            if (!displayYearSet.has(yearBE)) return;

            const typeRate = toNumberOrZero(row.TypeRate) === 2 ? 'support' : 'bu';
            const rate = normalizeReport09RatePart(row.Rate);
            const base = normalizeReport09RatePart(row.Base);

            const current = yearRateMap.get(yearBE) || {
                support: { rate: 1, base: 1 },
                bu: { rate: 1, base: 1 }
            };
            current[typeRate] = { rate, base };
            yearRateMap.set(yearBE, current);
        });

        return yearRateMap;
    } catch {
        return yearRateMap;
    }
};

const calcReport09Cut = (retireCount: number, carryIn: number, rate: number, base: number) => {
    const safeRetire = toNumberOrZero(retireCount);
    const safeCarry = toNumberOrZero(carryIn);
    const safeRate = normalizeReport09RatePart(rate);
    const safeBase = normalizeReport09RatePart(base);

    const total = safeRetire + safeCarry;
    const cut = Math.floor(total / safeRate) * safeBase;
    const carryOut = total % safeRate;

    return { cut, carryOut };
};

const calcReport09CutTotalsByOrg = (
    sourceMap: Report09OrgYearMap,
    orgUnitId: string,
    displayYears: number[],
    yearRateMap: Report09YearRateMap
) => {
    let cutSupport = 0;
    let cutBu = 0;
    let carrySupport = 0;
    let carryBu = 0;

    displayYears.forEach((year) => {
        const values = getReport09OrgYearValue(sourceMap, orgUnitId, year);
        const ratio = yearRateMap.get(year) || {
            support: { rate: 1, base: 1 },
            bu: { rate: 1, base: 1 }
        };

        const supportCut = calcReport09Cut(values.support, carrySupport, ratio.support.rate, ratio.support.base);
        cutSupport += supportCut.cut;
        carrySupport = supportCut.carryOut;

        const buCut = calcReport09Cut(values.bu, carryBu, ratio.bu.rate, ratio.bu.base);
        cutBu += buCut.cut;
        carryBu = buCut.carryOut;
    });

    return { cutSupport, cutBu };
};

const calcReport09CutTotalsForDisplayedRow = (
    row: Record<string, unknown>,
    displayYears: number[],
    yearRateMap: Report09YearRateMap
) => {
    let cutSupport = 0;
    let cutBu = 0;
    let carrySupport = 0;
    let carryBu = 0;

    displayYears.forEach((year) => {
        const ratio = yearRateMap.get(year) || {
            support: { rate: 1, base: 1 },
            bu: { rate: 1, base: 1 }
        };

        const supportCut = calcReport09Cut(toNumberOrZero(row[`y${year}_sup`]), carrySupport, ratio.support.rate, ratio.support.base);
        cutSupport += supportCut.cut;
        carrySupport = supportCut.carryOut;

        const buCut = calcReport09Cut(toNumberOrZero(row[`y${year}_bu`]), carryBu, ratio.bu.rate, ratio.bu.base);
        cutBu += buCut.cut;
        carryBu = buCut.carryOut;

        row[`y${year}_cut_sup`] = supportCut.cut;
        row[`y${year}_cut_bu`] = buCut.cut;
    });

    return { cutSupport, cutBu };
};

const recalculateReport09CutsForDisplayedRows = (
    rows: any[],
    displayYears: number[],
    yearRateMap: Report09YearRateMap
) => {
    const visit = (node: any) => {
        if (!node || typeof node !== 'object') return;

        const { cutSupport, cutBu } = calcReport09CutTotalsForDisplayedRow(node, displayYears, yearRateMap);
        node.cut_support = cutSupport;
        node.cut_bu = cutBu;
        node.cut_total = cutSupport + cutBu;

        if (Array.isArray(node.children)) {
            node.children.forEach((child: any) => visit(child));
        }
    };

    rows.forEach((row) => visit(row));
};

const adjustReport09DisplayedRowsToOwnOnly = (
    rows: any[],
    displayYears: number[]
) => {
    const valueKeys = displayYears.flatMap((year) => [`y${year}_sup`, `y${year}_bu`]);

    const visit = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node.children)) {
            node.children.forEach((child: any) => visit(child));
        }

        const rowKey = String(node.key || '');
        const isSummaryRow = rowKey === 'total' || rowKey.startsWith('bg-');
        if (isSummaryRow || !Array.isArray(node.children) || node.children.length === 0) return;

        valueKeys.forEach((key) => {
            const childSum = node.children.reduce((sum: number, child: any) => sum + toNumberOrZero(child[key]), 0);
            node[key] = Math.max(0, toNumberOrZero(node[key]) - childSum);
        });
    };

    rows.forEach((row) => visit(row));
};

const recalculateReport09SummaryCutsFromDisplayedRows = (rows: any[]) => {
    const isSummaryRow = (node: any) => {
        const rowKey = String(node?.key || '');
        return rowKey === 'total' || rowKey.startsWith('bg-');
    };

    const sumDisplayedDetailCuts = (node: any): { cutSupport: number; cutBu: number } => {
        if (!node || typeof node !== 'object') {
            return { cutSupport: 0, cutBu: 0 };
        }

        let cutSupport = isSummaryRow(node) ? 0 : toNumberOrZero(node.cut_support);
        let cutBu = isSummaryRow(node) ? 0 : toNumberOrZero(node.cut_bu);

        if (Array.isArray(node.children)) {
            node.children.forEach((child: any) => {
                const childTotals = sumDisplayedDetailCuts(child);
                cutSupport += childTotals.cutSupport;
                cutBu += childTotals.cutBu;
            });
        }

        return { cutSupport, cutBu };
    };

    const totalRow = rows.find((row) => String(row?.key || '') === 'total');
    const groupRows = rows.filter((row) => String(row?.key || '').startsWith('bg-'));

    groupRows.forEach((groupRow) => {
        const totals = sumDisplayedDetailCuts(groupRow);
        groupRow.cut_support = totals.cutSupport;
        groupRow.cut_bu = totals.cutBu;
        groupRow.cut_total = totals.cutSupport + totals.cutBu;
    });

    if (totalRow) {
        const cutSupport = groupRows.reduce((sum, groupRow) => sum + toNumberOrZero(groupRow.cut_support), 0);
        const cutBu = groupRows.reduce((sum, groupRow) => sum + toNumberOrZero(groupRow.cut_bu), 0);
        totalRow.cut_support = cutSupport;
        totalRow.cut_bu = cutBu;
        totalRow.cut_total = cutSupport + cutBu;
    }
};

const buildReport09FallbackTree = (
    sourceMap: Report09OrgYearMap,
    displayYears: number[],
    yearRateMap: Report09YearRateMap
) => {
    const rows = Array.from(sourceMap.entries())
        .map(([orgUnitId]) => {
            const row: Record<string, unknown> = {
                key: `org-${orgUnitId}`,
                unit: orgUnitId,
                unit_name: orgUnitId,
                ...createEmptyReport09Node(displayYears)
            };

            displayYears.forEach((year) => {
                const values = getReport09OrgYearValue(sourceMap, orgUnitId, year);
                row[`y${year}_sup`] = values.support;
                row[`y${year}_bu`] = values.bu;
            });

            const { cutSupport, cutBu } = calcReport09CutTotalsByOrg(sourceMap, orgUnitId, displayYears, yearRateMap);
            row.cut_support = cutSupport;
            row.cut_bu = cutBu;
            row.cut_total = cutSupport + cutBu;
            return row;
        })
        .sort((a, b) => toTrimText(a.unit).localeCompare(toTrimText(b.unit), 'th'));

    const grandTotal: Record<string, unknown> = {
        key: 'total',
        unit: 'รวมทุกธุรกิจ',
        unit_name: 'รวมทุกธุรกิจ',
        ...createEmptyReport09Node(displayYears)
    };

    rows.forEach((row) => sumNode(grandTotal, row));
    rows.push(grandTotal);
    recalculateReport09CutsForDisplayedRows(rows, displayYears, yearRateMap);
    return rows;
};

const getReport09GroupName = (groupBg: unknown, fallback: unknown = ''): string => {
    const group = String(groupBg ?? '').trim();
    if (group === '1') return 'สำนักงานใหญ่';
    if (group === '2') return 'กลุ่มธุรกิจปิโตรเลี่ยมขั้นต้นฯ';
    if (group === '3') return 'กลุ่มธุรกิจใหม่และความยั่งยืน';
    if (group === '4') return 'กลุ่มธุรกิจขั้นปลาย';
    return toTrimText(fallback) || 'ไม่ระบุกลุ่มธุรกิจ';
};

const appendReport09MissingStructureRows = async (
    pool: any,
    structureRows: any[],
    sourceMap: Report09OrgYearMap,
    structureDate: Date
) => {
    const existingOrgUnitIds = new Set(
        structureRows
            .map((row) => getReport09OrgUnitNo((row && typeof row === 'object') ? row as Record<string, unknown> : {}))
            .filter(Boolean)
    );
    const missingOrgUnitIds = Array.from(sourceMap.keys()).filter((orgUnitId) => !existingOrgUnitIds.has(orgUnitId));
    if (!missingOrgUnitIds.length) return structureRows;

    const inList = missingOrgUnitIds.map((orgUnitId) => `N'${escapeSqlString(orgUnitId)}'`).join(',');
    const result = await pool.request()
        .input('EffectiveDate', sql.DateTime, structureDate)
        .query(`
            SELECT
                unit.OrgUnitNo,
                unit.UnitAbbr,
                unit.UnitName,
                unit.ParentOrgUnitNo,
                unit.GroupBG,
                bg.BGName,
                unit.IsBelongTo
            FROM fn_InterfaceUnit(@EffectiveDate) unit
            LEFT JOIN MP_BG bg
                ON bg.BGNo = unit.BGNo
               AND @EffectiveDate BETWEEN bg.BeginDate AND bg.EndDate
            WHERE unit.OrgUnitNo IN (${inList})
        `);

    const rows = Array.isArray(result.recordset) ? result.recordset as Array<Record<string, unknown>> : [];
    const rowByOrgUnitId = new Map(
        rows
            .map((row) => [normalizeReport09OrgUnitKey(row.OrgUnitNo), row] as const)
            .filter(([orgUnitId]) => Boolean(orgUnitId))
    );

    const supplementalRows = missingOrgUnitIds.map((orgUnitId) => {
        const unit = rowByOrgUnitId.get(orgUnitId);
        if (!unit) {
            return {
                OrgUnitNo: orgUnitId,
                OrgUnitID: orgUnitId,
                UnitAbbr: orgUnitId,
                DisplayName: orgUnitId,
                UnitName: orgUnitId,
                GroupBGName: 'ไม่ระบุกลุ่มธุรกิจ',
                GrandParent: '',
                GrandParent2: '',
                IsBelongTo: 0
            };
        }

        const unitAbbr = toTrimText(unit.UnitAbbr) || orgUnitId;
        const unitName = toTrimText(unit.UnitName) || unitAbbr;
        return {
            OrgUnitNo: orgUnitId,
            OrgUnitID: orgUnitId,
            UnitAbbr: unitAbbr,
            DisplayName: unitAbbr,
            UnitName: unitName,
            ParentOrgUnitNo: toTrimText(unit.ParentOrgUnitNo),
            GroupBGName: getReport09GroupName(unit.GroupBG, unit.BGName),
            GrandParent: '',
            GrandParent2: '',
            IsBelongTo: toNumberOrZero(unit.IsBelongTo)
        };
    });

    return [...structureRows, ...supplementalRows];
};

const addReport09OrgYearValues = (
    targetMap: Report09OrgYearMap,
    targetOrgUnitId: string,
    sourceYearMap: Map<number, { support: number; bu: number }>
) => {
    if (!targetOrgUnitId) return;
    if (!targetMap.has(targetOrgUnitId)) {
        targetMap.set(targetOrgUnitId, new Map());
    }

    const targetYearMap = targetMap.get(targetOrgUnitId)!;
    sourceYearMap.forEach((sourceValue, year) => {
        const current = targetYearMap.get(year) || { support: 0, bu: 0 };
        current.support += toNumberOrZero(sourceValue.support);
        current.bu += toNumberOrZero(sourceValue.bu);
        targetYearMap.set(year, current);
    });
};

const rollupReport09SourceMapToStructure = async (
    pool: any,
    structureRows: any[],
    sourceMap: Report09OrgYearMap,
    structureDate: Date
): Promise<Report09OrgYearMap> => {
    const structureOrgUnitIds = new Set(
        structureRows
            .map((row) => getReport09OrgUnitNo((row && typeof row === 'object') ? row as Record<string, unknown> : {}))
            .filter(Boolean)
    );
    if (!structureOrgUnitIds.size) return sourceMap;

    const missingOrgUnitIds = Array.from(sourceMap.keys()).filter((orgUnitId) => !structureOrgUnitIds.has(orgUnitId));
    if (!missingOrgUnitIds.length) return sourceMap;

    const unitResult = await pool.request()
        .input('EffectiveDate', sql.DateTime, structureDate)
        .query(`
            SELECT
                unit.OrgUnitNo,
                unit.ParentOrgUnitNo
            FROM fn_InterfaceUnit(@EffectiveDate) unit
        `);

    const parentByOrgUnitId = new Map<string, string>();
    const unitRows = Array.isArray(unitResult.recordset) ? unitResult.recordset as Array<Record<string, unknown>> : [];
    unitRows.forEach((row) => {
        const orgUnitId = normalizeReport09OrgUnitKey(row.OrgUnitNo);
        if (!orgUnitId) return;
        parentByOrgUnitId.set(orgUnitId, normalizeReport09OrgUnitKey(row.ParentOrgUnitNo));
    });

    const rolledMap: Report09OrgYearMap = new Map();
    const resolveDisplayedAncestor = (orgUnitId: string) => {
        let current = orgUnitId;
        const visited = new Set<string>();

        while (current && !visited.has(current)) {
            if (structureOrgUnitIds.has(current)) return current;
            visited.add(current);
            current = parentByOrgUnitId.get(current) || '';
        }

        return '';
    };

    sourceMap.forEach((yearMap, orgUnitId) => {
        const targetOrgUnitId = resolveDisplayedAncestor(orgUnitId) || orgUnitId;
        addReport09OrgYearValues(rolledMap, targetOrgUnitId, yearMap);
    });

    return rolledMap;
};

const buildReport09Tree = (
    flatData: any[],
    sourceMap: Report09OrgYearMap,
    displayYears: number[],
    yearRateMap: Report09YearRateMap
) => {
    const resultTree: any[] = [];
    const group1Map = new Map<string, any>();
    const group2Map = new Map<string, any>();
    const group3Map = new Map<string, any>();
    const unitNameByLabel = new Map<string, string>();
    let keyCounter = 1;

    const normalizeUnitLabel = (value: unknown) => String(value ?? '')
        .replace(/^>\s*/, '')
        .replace(/^→\s*/, '')
        .replace(/ขึ้นตรง$/, '')
        .trim();

    flatData.forEach((raw) => {
        const row = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
        const unitName = toTrimText(row.UnitName || row.unit_name || row.unitname);
        if (!unitName) return;

        const rawAbbr = toTrimText(row.UnitAbbr || row.unit_abbr || row.unitabbr);
        const rawDisplay = toTrimText(row.DisplayName || row.display_name || row.displayname);
        const candidates = [
            rawAbbr,
            rawDisplay,
            normalizeUnitLabel(rawAbbr),
            normalizeUnitLabel(rawDisplay)
        ].filter(Boolean);

        candidates.forEach((label) => {
            if (!unitNameByLabel.has(label)) {
                unitNameByLabel.set(label, unitName);
            }
        });
    });

    const resolveUnitName = (label: unknown) => {
        const raw = toTrimText(label);
        if (!raw) return '';
        return unitNameByLabel.get(raw) || unitNameByLabel.get(normalizeUnitLabel(raw)) || '';
    };

    flatData.forEach((raw) => {
        const row = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
        const bgName = toTrimText(row.GroupBGName);
        if (!bgName) return;

        const grandParent = toTrimText(row.GrandParent);
        const grandParent2 = toTrimText(row.GrandParent2);
        const orgUnitId = getReport09OrgUnitNo(row);

        const leafLabel = toTrimText(row.DisplayName) || toTrimText(row.UnitAbbr) || orgUnitId || '-';
        const leafUnitName = toTrimText(row.UnitName || row.unit_name || row.unitname)
            || resolveUnitName(leafLabel)
            || leafLabel;

        const leafData: Record<string, unknown> = {
            key: `r-${keyCounter++}`,
            unit: leafLabel,
            unit_name: leafUnitName,
            ...createEmptyReport09Node(displayYears),
            _isHiddenLegacy: row.IsBelongTo == 1 || row.IsBelongTo === true || row.IsBelongTo === '1'
        };

        displayYears.forEach((year) => {
            const values = getReport09OrgYearValue(sourceMap, orgUnitId, year);
            leafData[`y${year}_sup`] = values.support;
            leafData[`y${year}_bu`] = values.bu;
        });

        const { cutSupport, cutBu } = calcReport09CutTotalsByOrg(sourceMap, orgUnitId, displayYears, yearRateMap);
        leafData.cut_support = cutSupport;
        leafData.cut_bu = cutBu;
        leafData.cut_total = cutSupport + cutBu;

        if (!group1Map.has(bgName)) {
            const bgNode = {
                key: `bg-${keyCounter++}`,
                unit: bgName,
                unit_name: bgName,
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
                    unit_name: resolveUnitName(grandParent) || grandParent,
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
                        unit_name: resolveUnitName(grandParent2) || grandParent2,
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
        unit_name: 'รวมทุกธุรกิจ',
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

    const fillMissingUnitNames = (node: any) => {
        if (!node || typeof node !== 'object') return;
        const current = toTrimText(node.unit_name);
        const label = toTrimText(node.unit);
        const resolved = resolveUnitName(label);
        if ((!current || current === label) && resolved) {
            node.unit_name = resolved;
        } else if (!current && label) {
            node.unit_name = label;
        }
        if (Array.isArray(node.children)) {
            node.children.forEach((child: any) => fillMissingUnitNames(child));
        }
    };
    resultTree.forEach((bgNode) => fillMissingUnitNames(bgNode));
    adjustReport09DisplayedRowsToOwnOnly(resultTree, displayYears);
    recalculateReport09CutsForDisplayedRows(resultTree, displayYears, yearRateMap);
    recalculateReport09SummaryCutsFromDisplayedRows(resultTree);

    return resultTree;
};

export const getReport09DataService = async (
    effectiveYear: number,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        const safeEffectiveYear = toNumberOrZero(effectiveYear) || (new Date().getFullYear() + 543);
        const safeEmployeeId = normalizeReport09EmployeeIdParam(employeeId);
        const safeUserGroupNo = normalizeReport09UserGroupNoParam(userGroupNo);
        const effectiveYearAD = safeEffectiveYear > 2500 ? safeEffectiveYear - 543 : safeEffectiveYear;
        const structureDate = new Date(`${effectiveYearAD}-01-01T00:00:00`);
        const structureIsSecondment = 0;
        const displayYears = buildReport09Years(safeEffectiveYear);
        const pool = await poolPromise;

        const [retirementMap, yearRateMap, structureRows] = await Promise.all([
            getReport09RetirementMap(pool, safeEffectiveYear, structureDate, structureIsSecondment),
            getReport09YearRateMap(pool, safeEffectiveYear, displayYears),
            (async () => {
                try {
                    const request = pool.request();
                    request.input('Effectivedate', sql.DateTime, structureDate);
                    request.input('EmployeeID', sql.VarChar(8), safeEmployeeId);
                    request.input('UserGroupNo', sql.VarChar(2), safeUserGroupNo);
                    request.input('IsSecondment', sql.Int, structureIsSecondment);
                    const result = await request.execute('mp_Report09Get');
                    return Array.isArray(result.recordset) ? result.recordset : [];
                } catch (spError) {
                    // Temporary compatibility fallback until mp_Report09Get is deployed in every environment.
                    console.warn('mp_Report09Get unavailable, fallback to mp_Report01Get:', spError);
                    const fallbackRequest = pool.request();
                    fallbackRequest.input('Effectivedate', sql.DateTime, structureDate);
                    fallbackRequest.input('EmployeeID', sql.VarChar(8), safeEmployeeId);
                    fallbackRequest.input('UserGroupNo', sql.VarChar(2), safeUserGroupNo);
                    const fallbackResult = await fallbackRequest.execute('mp_Report01Get');
                    return Array.isArray(fallbackResult.recordset) ? fallbackResult.recordset : [];
                }
            })()
        ]);

        if (!structureRows.length) {
            return buildReport09FallbackTree(retirementMap, displayYears, yearRateMap);
        }

        const visibleRetirementMap = await rollupReport09SourceMapToStructure(pool, structureRows, retirementMap, structureDate);
        const tree = buildReport09Tree(structureRows, visibleRetirementMap, displayYears, yearRateMap);
        if (!tree.length) {
            return buildReport09FallbackTree(retirementMap, displayYears, yearRateMap);
        }

        return tree;
    } catch (error) {
        console.error('Error in getReport09DataService:', error);
        throw error;
    }
};

const REPORT10_ALLOWED_LEVEL_CODES = ['1007', '1006', '1005', '1004'] as const;

const mapReport10LevelGroup = (levelCode: string, levelName: string): '010' | '020_030' | '040' | '050' | 'OTHER' => {
    const normalizedLevelCode = toTrimText(levelCode).replace(/\D/g, '');
    if (normalizedLevelCode === '1007' || normalizedLevelCode === '010') return '010';
    if (normalizedLevelCode === '1006' || normalizedLevelCode === '020' || normalizedLevelCode === '030') return '020_030';
    if (normalizedLevelCode === '1005' || normalizedLevelCode === '040') return '040';
    if (normalizedLevelCode === '1004' || normalizedLevelCode === '050') return '050';

    if (levelName.includes('ปธบ') || levelName.includes('กผญ')) return '010';
    if (levelName.includes('รองกรรมการผู้จัดการใหญ่') || levelName.includes('ประธานเจ้าหน้าที่')) return '020_030';
    if (levelName.includes('ผู้ช่วยกรรมการผู้จัดการใหญ่')) return '040';
    if (levelName.includes('ผู้จัดการฝ่าย')) return '050';
    return 'OTHER';
};

const isReport10IncludedLevel = (levelCode: string, levelName: string): boolean =>
    mapReport10LevelGroup(levelCode, levelName) !== 'OTHER';

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
            const levelCode = text('LevelCode', 'levelcode', 'LevelGroupNo', 'levelgroupno');
            const position = text('ตำแหน่ง', 'position', 'LevelName', 'levelname');

            return {
                key: `r10-${index + 1}`,
                level_code: levelCode,
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
        }).filter((row) => isReport10IncludedLevel(row.level_code, row.position));
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

        const allowedLevelList = REPORT10_ALLOWED_LEVEL_CODES
            .map((levelCode) => `N'${levelCode}'`)
            .join(', ');

        const result = await request.query(`
            ;WITH PositionSource AS (
                SELECT p.*
                FROM fn_InterfacePosition(@EffectiveDate) p
                WHERE @EffectiveDate BETWEEN TRY_CONVERT(date, p.BeginDate) AND TRY_CONVERT(date, p.EndDate)
                  AND LTRIM(RTRIM(CAST(p.LevelGroupNo AS nvarchar(16)))) IN (${allowedLevelList})
            ),
            InfoDataByPosition AS (
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
            InfoDataByPositionEmployee AS (
                SELECT
                    i.*,
                    ROW_NUMBER() OVER (
                        PARTITION BY i.POSCODE, i.CODE
                        ORDER BY
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
            ),
            LevelMap AS (
                SELECT N'1007' AS LevelCode, N'ปธบ./กผญ.' AS LevelName, 1 AS SortOrder UNION ALL
                SELECT N'1006', N'ประธานเจ้าหน้าที่/รองกรรมการผู้จัดการใหญ่', 2 UNION ALL
                SELECT N'1005', N'ผู้ช่วยกรรมการผู้จัดการใหญ่', 3 UNION ALL
                SELECT N'1004', N'ผู้จัดการฝ่าย', 4
            )
            SELECT
                COALESCE(iEmployee.POSCODE, iPosition.POSCODE, p.PositionID) AS POSCODE,
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
                COALESCE(iEmployee.CODE, iPosition.CODE) AS InfoEmployeeID,
                COALESCE(iEmployee.FULLNAMETH, iPosition.FULLNAMETH) AS FULLNAMETH,
                COALESCE(iEmployee.POSNAME, iPosition.POSNAME) AS POSNAME,
                JCodeDedup.JCODE,
                LevelMap.LevelCode,
                LevelMap.LevelName,
                LevelMap.SortOrder,
                InterfaceUnit.ParentOrgUnitNo,
                UnitParent.UnitName AS ParentUnitName
            FROM PositionSource p
            LEFT JOIN InfoDataByPositionEmployee iEmployee
                ON iEmployee.POSCODE = p.PositionID
                AND iEmployee.CODE = p.EmployeeID
                AND iEmployee.rn = 1
            LEFT JOIN InfoDataByPosition iPosition
                ON iPosition.POSCODE = p.PositionID
                AND iPosition.rn = 1
            LEFT JOIN JCodeDedup ON JCodeDedup.levelgroup = p.LevelGroupNo
            LEFT JOIN LevelMap ON LevelMap.LevelCode = LTRIM(RTRIM(CAST(p.LevelGroupNo AS nvarchar(16))))
            LEFT JOIN fn_InterfaceUnit(@EffectiveDate) InterfaceUnit ON InterfaceUnit.OrgUnitNo = p.OrgUnitID
            LEFT JOIN fn_InterfaceUnit(@EffectiveDate) UnitParent ON UnitParent.OrgUnitNo = InterfaceUnit.ParentOrgUnitNo
        `);
        const rows = Array.isArray(result.recordset) ? result.recordset : [];

        return rows.map((rawRow, index) => {
            const row = (rawRow && typeof rawRow === 'object') ? (rawRow as Record<string, unknown>) : {};
            const { num, text } = buildRowAccessor(row);

            const levelCode = text('LevelGroupNo', 'levelgroupno', 'LevelCode', 'levelcode');
            const levelName = text('LevelName', 'levelname');
            const orgType = num('OrgType', 'orgtype');
            const poolRsFlag = num('PoolRSFlag', 'poolrsflag');
            const strgFlag = num('StrgFlag', 'strgflag');
            const bsType = num('BSType', 'bstype');
            const specFlag = num('SpecFlag', 'specflag');
            const isSecondment = orgType === 2;
            const isSpecific = specFlag === 1;

            return {
                key: `r10e-${index + 1}`,
                level_group: mapReport10LevelGroup(levelCode, levelName),
                level_group_no: levelCode,
                level_name: levelName,
                position_name: text('POSNAME', 'posname'),
                position_short_name: levelName,
                unit_name: text('UnitName', 'unitname'),
                parent_unit_name: text('ParentUnitName', 'parentunitname'),
                unit_level_no: levelCode,
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
                sign_pos: text('SignPos', 'signpos'),
                strg_flag: strgFlag,
                bs_type: bsType,
                spec_flag: specFlag,
                frame_type: poolRsFlag === 1 ? 'pool' : (orgType === 2 ? 'Secondment' : 'ปตท'),
                strategic: strgFlag === 1 ? 'Y' : 'N',
                business_support: bsType === 1 ? 'Business' : (bsType === 2 ? 'Support' : '-'),
                specific_rate: specFlag === 1 ? 'Y' : 'N',
                group_type: isSecondment ? 'SECONDMENT' : (isSpecific ? 'SPEC' : 'PTT')
            };
        }).filter((row) => isReport10IncludedLevel(row.level_group_no, row.level_name));
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
    const unitNameByLabel = new Map<string, string>();
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

    const normalizeUnitLabel = (value: unknown) => String(value ?? '')
        .replace(/^>\s*/, '')
        .replace(/^→\s*/, '')
        .replace(/ขึ้นตรง$/, '')
        .trim();

    flatData.forEach((raw) => {
        const row = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
        const unitName = toTrimText(readRowValue(row, 'UnitName', 'unit_name', 'unitname'));
        if (!unitName) return;

        const rawAbbr = toTrimText(readRowValue(row, 'UnitAbbr', 'unit_abbr', 'unitabbr'));
        const rawDisplay = toTrimText(readRowValue(row, 'DisplayName', 'display_name', 'displayname'));
        const candidates = [
            rawAbbr,
            rawDisplay,
            normalizeUnitLabel(rawAbbr),
            normalizeUnitLabel(rawDisplay)
        ].filter(Boolean);

        candidates.forEach((label) => {
            if (!unitNameByLabel.has(label)) {
                unitNameByLabel.set(label, unitName);
            }
        });
    });

    const resolveUnitName = (label: unknown) => {
        const raw = toTrimText(label);
        if (!raw) return '';
        return unitNameByLabel.get(raw) || unitNameByLabel.get(normalizeUnitLabel(raw)) || '';
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
                unit_name: toTrimText(bgName),
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

        const rowLabel = toTrimText(readRowValue(rowObj, 'DisplayName', 'display_name', 'displayname'))
            || toTrimText(readRowValue(rowObj, 'UnitAbbr', 'unit_abbr', 'unitabbr'))
            || orgUnitNo
            || '-';
        const rowUnitName = toTrimText(readRowValue(rowObj, 'UnitName', 'unit_name', 'unitname'))
            || resolveUnitName(rowLabel)
            || rowLabel;

        const rowData = {
            key: `r-${keyCounter++}`,
            unit: rowLabel,
            unit_name: rowUnitName,
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
                    unit_name: resolveUnitName(grandParent) || toTrimText(grandParent),
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
                        unit_name: resolveUnitName(grandParent2) || toTrimText(grandParent2),
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
        unit_name: 'รวมทุกธุรกิจ',
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

    const fillMissingUnitNames = (node: any) => {
        if (!node || typeof node !== 'object') return;
        const current = toTrimText(node.unit_name);
        const unitLabel = toTrimText(node.unit);
        const resolved = resolveUnitName(unitLabel);
        if ((!current || current === unitLabel) && resolved) {
            node.unit_name = resolved;
        } else if (!current && unitLabel) {
            node.unit_name = unitLabel;
        }
        if (Array.isArray(node.children)) {
            node.children.forEach((child: any) => fillMissingUnitNames(child));
        }
    };
    resultTree.forEach((bgNode) => fillMissingUnitNames(bgNode));

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
    const unitNameByLabel = new Map<string, string>();

    const normalizeUnitLabel = (value: unknown) => String(value ?? '')
        .replace(/^>\s*/, '')
        .replace(/^→\s*/, '')
        .replace(/ขึ้นตรง$/, '')
        .trim();

    flatData.forEach((row) => {
        const unitName = String(row?.UnitName || '').trim();
        if (!unitName) return;

        const rawAbbr = String(row?.UnitAbbr || '').trim();
        const rawDisplay = String(row?.DisplayName || '').trim();
        const candidates = [
            rawAbbr,
            rawDisplay,
            normalizeUnitLabel(rawAbbr),
            normalizeUnitLabel(rawDisplay)
        ].filter(Boolean);

        candidates.forEach((label) => {
            if (!unitNameByLabel.has(label)) {
                unitNameByLabel.set(label, unitName);
            }
        });
    });

    const resolveUnitName = (label: unknown) => {
        const raw = String(label ?? '').trim();
        if (!raw) return '';
        return unitNameByLabel.get(raw) || unitNameByLabel.get(normalizeUnitLabel(raw)) || '';
    };

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
                unit_name: String(bgName || '').trim(),
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
            unit_name: row.UnitName || resolveUnitName(row.DisplayName || row.UnitAbbr) || '',
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
                    unit_name: resolveUnitName(grandParent),
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
                        unit_name: resolveUnitName(grandParent2),
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
        ...createEmptyNode(),
        unit_name: 'รวมทุกธุรกิจ'
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
        unit_name: '',
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
