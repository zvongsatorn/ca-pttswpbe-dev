import { sql, poolPromise } from '../config/db.js';
import userGroupService from './userGroupService.js';

export interface DelayRecord {
    key: string;
    DelayID: string;
    EmployeeID: string;
    EmployeeName: string;
    PosName: string;
    UnitName?: string;
    BUSupport?: string;
    RetirementYear?: string;
    DelayYear: string;
    DelayStatus: number;
    DelayType?: number;
}

export interface DelayEmployeeOption {
    value: string;
    label: string;
    name: string;
    position: string;
    buSupport: string;
    unitName: string;
    delayType: number;
}

interface DelayUpsertPayload {
    employeeId: string;
    posName: string;
    retirementYear?: number | null;
    delayYear: number;
    delayStatus: number;
    delayType?: number | null;
    userId: string;
}

interface EmployeeDirectoryItem {
    name: string;
    position: string;
}

interface EmployeeOrgMetaItem {
    unitName: string;
    delayType: number | null;
}

type TableMeta = {
    schemaName: string;
    tableName: string;
    fullName: string;
    objectName: string;
    objectType: string;
    parameterCount: number;
    columns: Map<string, string>;
};

type GenericRow = Record<string, unknown>;

const INFO_TABLE_CANDIDATES = ['InfoData', 'infodata'];
const POSITION_TABLE_CANDIDATES = ['fn_InterfacePosition', 'InterfacePosition', 'interfaceposition'];
const INFO_EMPLOYEE_COL_CANDIDATES = ['CODE', 'Code', 'EmployeeID', 'EmployeeId'];
const INFO_FULL_NAME_COL_CANDIDATES = ['FULLNAMETH', 'FullNameTH'];
const INFO_NAME_COL_CANDIDATES = ['FULLNAMETH', 'FullNameTH', 'NameAll', 'Name'];
const INFO_POSITION_NAME_COL_CANDIDATES = ['POSNAME', 'PosName', 'PositionName', 'Position'];
const INFO_POSITION_COL_CANDIDATES = ['POSCODE', 'PosCode', 'PositionID', 'PositionCode'];
const INFO_RETIRE_YEAR_COL_CANDIDATES = ['RETIREYEAR', 'RetireYear'];
const POSITION_ID_COL_CANDIDATES = ['PositionID', 'POSCODE', 'PosCode', 'PositionCode'];
const POSITION_SIGN_POS_COL_CANDIDATES = ['SignPos', 'SignPOS', 'SignPosition', 'SignPosFlag'];
const POSITION_SECONDMENT_TEXT_COL_CANDIDATES = ['Secondment_text', 'Secondment_Text', 'SecondmentText', 'secondment_text'];
const POSITION_BS_TYPE_COL_CANDIDATES = ['BSType', 'BsType', 'BS_Type', 'TypeBS'];
const POSITION_ORG_TYPE_COL_CANDIDATES = ['OrgType', 'ORGTYPE', 'orgtype'];
const POSITION_ORG_COL_CANDIDATES = ['OrgUnitID', 'OrgUnitId', 'OrgUnitNo', 'OrgUnitNO', 'OrgUnit', 'UnitNo', 'UnitCode', 'OrgNo'];
const POSITION_EMPLOYEE_COL_CANDIDATES = ['EmployeeID', 'EmployeeId', 'CODE', 'Code'];
const POSITION_BEGIN_DATE_COL_CANDIDATES = ['BeginDate', 'StartDate', 'FromDate', 'EffectiveStartDate'];
const POSITION_END_DATE_COL_CANDIDATES = ['EndDate', 'ToDate', 'EffectiveEndDate'];
const DELAY_TABLE_CANDIDATES = ['MP_Delay', 'mp_delay'];
const UNIT_TABLE_CANDIDATES = ['fn_InterfaceUnit', 'InterfaceUnit', 'interfaceunit'];
const UNIT_ORG_COL_CANDIDATES = ['OrgUnitNo', 'OrgUnitNO', 'OrgUnitID', 'OrgUnitId', 'OrgNo', 'UnitNo', 'UnitCode'];
const UNIT_NAME_COL_CANDIDATES = ['UnitName', 'OrgUnitName', 'Name'];
const UNIT_ABBR_COL_CANDIDATES = ['UnitAbbr', 'OrgUnitAbbr', 'ShortName', 'Abbr'];
const UNIT_BG_COL_CANDIDATES = ['BGNo', 'BgNo', 'BGNO'];
const NON_COUNT_DELAY_YEAR = 9999;

const escapeSqlIdentifier = (value: string): string => `[${value.replace(/]/g, ']]')}]`;
const escapeSqlString = (value: string): string => value.replace(/'/g, "''");
const toTrimText = (value: unknown): string => String(value || '').trim();

const pickColumnName = (columns: Map<string, string>, candidates: string[]): string | null => {
    for (const candidate of candidates) {
        const found = columns.get(candidate.toLowerCase());
        if (found) return found;
    }
    return null;
};

class DelayService {
    private isMissingDelayTypeColumnError(error: unknown): boolean {
        const message = String((error as { message?: unknown })?.message || error || '').toLowerCase();
        return message.includes('invalid column name') && (
            message.includes('orgtype') ||
            message.includes('bstype')
        );
    }

    private async getTableMeta(
        pool: sql.ConnectionPool,
        tableCandidates: string[]
    ): Promise<TableMeta | null> {
        if (!tableCandidates.length) return null;

        const inList = tableCandidates.map((name) => `'${escapeSqlString(name.toLowerCase())}'`).join(',');
        const tableRes = await pool.request().query(`
            SELECT
                o.object_id,
                s.name AS schema_name,
                o.name AS object_name,
                o.type AS object_type,
                ISNULL(params.parameter_count, 0) AS parameter_count
            FROM sys.objects o
            INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
            OUTER APPLY (
                SELECT COUNT(1) AS parameter_count
                FROM sys.parameters p
                WHERE p.object_id = o.object_id
                  AND p.parameter_id > 0
            ) params
            WHERE o.type IN ('U', 'IF', 'TF')
              AND LOWER(o.name) IN (${inList})
        `);

        const rows = Array.isArray(tableRes.recordset)
            ? (tableRes.recordset as GenericRow[])
            : [];
        if (!rows.length) return null;

        const rankTable = (row: GenericRow, candidate: string) => {
            const objectName = toTrimText(row.object_name).toLowerCase();
            const schemaName = toTrimText(row.schema_name).toLowerCase();
            const objectType = toTrimText(row.object_type).toUpperCase();
            const objectExact = objectName === candidate.toLowerCase() ? 0 : 1;
            const schemaRank = schemaName === 'dbo' ? 0 : 1;
            const typeRank = objectType === 'U' ? 0 : 1;
            return objectExact * 100 + schemaRank * 10 + typeRank;
        };

        let selected: GenericRow | null = null;
        for (const candidate of tableCandidates) {
            const matched = rows
                .filter((row) => toTrimText(row.object_name).toLowerCase() === candidate.toLowerCase())
                .sort((a, b) => rankTable(a, candidate) - rankTable(b, candidate));
            if (matched.length > 0) {
                selected = matched[0];
                break;
            }
        }
        if (!selected) {
            selected = [...rows].sort((a, b) => rankTable(a, tableCandidates[0]) - rankTable(b, tableCandidates[0]))[0];
        }

        const schemaName = toTrimText(selected.schema_name);
        const tableName = toTrimText(selected.object_name);
        const objectType = toTrimText(selected.object_type);
        const objectId = Number(selected.object_id || 0);
        const parameterCount = Number(selected.parameter_count || 0);
        if (!schemaName || !tableName) return null;

        const objectName = `${schemaName}.${tableName}`;
        const columnsRes = await pool.request()
            .input('objectId', sql.Int, objectId)
            .query(`
                SELECT c.name
                FROM sys.columns c
                WHERE c.object_id = @objectId
            `);

        const columnRows = Array.isArray(columnsRes.recordset)
            ? (columnsRes.recordset as GenericRow[])
            : [];

        const columns = new Map<string, string>();
        columnRows.forEach((row) => {
            const colName = toTrimText(row.name);
            if (!colName) return;
            columns.set(colName.toLowerCase(), colName);
        });

        return {
            schemaName,
            tableName,
            objectName,
            fullName: `${escapeSqlIdentifier(schemaName)}.${escapeSqlIdentifier(tableName)}`,
            objectType,
            parameterCount: Number.isFinite(parameterCount) ? parameterCount : 0,
            columns
        };
    }

    private buildSqlSource(meta: TableMeta, effectiveDateParamName = '@EffectiveDate'): string {
        if (meta.objectType === 'U') {
            return meta.fullName;
        }

        const paramCount = Number.isFinite(meta.parameterCount) ? Math.max(0, meta.parameterCount) : 0;
        const args = Array.from({ length: paramCount }, () => effectiveDateParamName).join(', ');
        return `${meta.fullName}(${args})`;
    }

    private getFirstNonEmpty(row: GenericRow, keys: string[]): string {
        for (const key of keys) {
            const raw = row[key];
            if (raw === null || raw === undefined) continue;
            const text = String(raw).trim();
            if (text !== '') return text;
        }
        return '';
    }

    private normalizeDelayType(value: unknown): number | null {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        if (!Number.isFinite(parsed)) return null;
        return parsed === 2 ? 2 : 1;
    }

    private getDelayTypeLabel(delayType: unknown): string {
        return this.normalizeDelayType(delayType) === 2 ? 'Support' : 'Business';
    }

    private async getDelayTableMeta(pool: sql.ConnectionPool): Promise<TableMeta | null> {
        return this.getTableMeta(pool, DELAY_TABLE_CANDIDATES);
    }

    private buildDelayTypeExpr(params: {
        positionAlias: string;
        unitAlias: string;
        positionOrgTypeExpr?: string | null;
        positionBsTypeExpr?: string | null;
        positionOrgTypeCol: string | null;
        positionBsTypeCol: string | null;
        unitBgCol: string | null;
        unitNameCol: string | null;
        unitAbbrCol: string | null;
    }): string {
        const positionOrgTypeExpr = params.positionOrgTypeExpr
            ? params.positionOrgTypeExpr
            : params.positionOrgTypeCol
                ? `TRY_CONVERT(int, ${params.positionAlias}.${escapeSqlIdentifier(params.positionOrgTypeCol)})`
                : 'NULL';
        const positionBsTypeExpr = params.positionBsTypeExpr
            ? params.positionBsTypeExpr
            : params.positionBsTypeCol
                ? `TRY_CONVERT(int, ${params.positionAlias}.${escapeSqlIdentifier(params.positionBsTypeCol)})`
                : 'NULL';
        const unitBgExpr = params.unitBgCol
            ? `LTRIM(RTRIM(CAST(${params.unitAlias}.${escapeSqlIdentifier(params.unitBgCol)} AS nvarchar(32))))`
            : 'NULL';
        const safeUnitBgExpr = unitBgExpr === 'NULL' ? "N''" : unitBgExpr;
        const unitNameExpr = params.unitNameCol
            ? `UPPER(LTRIM(RTRIM(CAST(${params.unitAlias}.${escapeSqlIdentifier(params.unitNameCol)} AS nvarchar(255)))))`
            : "N''";
        const unitAbbrExpr = params.unitAbbrCol
            ? `UPPER(LTRIM(RTRIM(CAST(${params.unitAlias}.${escapeSqlIdentifier(params.unitAbbrCol)} AS nvarchar(255)))))`
            : "N''";

        const hoConditions = [
            params.unitBgCol ? `${safeUnitBgExpr} = '905'` : '',
            params.unitNameCol ? `${unitNameExpr} IN (N'HO', N'HEAD OFFICE', N'สำนักงานใหญ่')` : '',
            params.unitAbbrCol ? `${unitAbbrExpr} = N'HO'` : ''
        ].filter(Boolean);
        const isHoExpr = hoConditions.length > 0 ? `(${hoConditions.join(' OR ')})` : '1 = 0';

        return `
            CASE
                WHEN ${isHoExpr} THEN 2
                WHEN ${positionOrgTypeExpr} = 2 AND ${positionBsTypeExpr} = 2 THEN 2
                ELSE 1
            END
        `;
    }

    private normalizeEmployeeRow(row: GenericRow): { employeeId: string; name: string; position: string } | null {
        const employeeId = this.getFirstNonEmpty(row, [
            'EmployeeID', 'employeeID', 'EmployeeId', 'employeeId', 'CODE', 'Code'
        ]);
        if (!employeeId) return null;

        const name = this.getFirstNonEmpty(row, [
            'NameAll', 'nameAll', 'Name', 'name', 'FullName', 'fullName', 'DisplayName', 'FULLNAMETH', 'FULLNAMEENG'
        ]) || employeeId;

        const position = this.getFirstNonEmpty(row, [
            'Position', 'position', 'PosName', 'posName', 'PositionName', 'positionName', 'JobTitle', 'jobTitle'
        ]);

        return { employeeId, name, position };
    }

    private async getEmployeeDirectory(): Promise<Map<string, EmployeeDirectoryItem>> {
        const directory = new Map<string, EmployeeDirectoryItem>();
        const pool = await poolPromise;

        try {
            const result = await pool.request().execute('mp_UserGet');
            const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];

            for (const row of rows) {
                const normalized = this.normalizeEmployeeRow(row);
                if (!normalized) continue;

                directory.set(normalized.employeeId, {
                    name: normalized.name,
                    position: normalized.position
                });
            }
        } catch (error) {
            console.warn('[DelayService.getEmployeeDirectory] mp_UserGet failed, fallback to userGroupService.getAllUsers', error);
        }

        if (directory.size === 0) {
            const fallbackUsers = await userGroupService.getAllUsers();
            for (const user of fallbackUsers) {
                const employeeId = String(user.employeeID || '').trim();
                if (!employeeId) continue;
                directory.set(employeeId, {
                    name: String(user.nameAll || employeeId).trim(),
                    position: ''
                });
            }
        }

        return directory;
    }

    private async getEmployeeOptionsFromInfoData(retireYear?: number, keyword?: string): Promise<DelayEmployeeOption[]> {
        const pool = await poolPromise;
        const infoMeta = await this.getTableMeta(pool, INFO_TABLE_CANDIDATES);
        const positionMeta = await this.getTableMeta(pool, POSITION_TABLE_CANDIDATES);
        const unitMeta = await this.getTableMeta(pool, UNIT_TABLE_CANDIDATES);

        if (!infoMeta || !positionMeta) {
            throw new Error('InfoData/fn_InterfacePosition source not found');
        }
        const infoSource = this.buildSqlSource(infoMeta, '@EffectiveDate');
        const positionSource = this.buildSqlSource(positionMeta, '@EffectiveDate');
        const unitSource = unitMeta ? this.buildSqlSource(unitMeta, '@EffectiveDate') : '';

        const infoEmployeeCol = pickColumnName(infoMeta.columns, INFO_EMPLOYEE_COL_CANDIDATES);
        const infoNameCol = pickColumnName(infoMeta.columns, INFO_NAME_COL_CANDIDATES);
        const infoPositionNameCol = pickColumnName(infoMeta.columns, INFO_POSITION_NAME_COL_CANDIDATES);
        const infoPositionCol = pickColumnName(infoMeta.columns, INFO_POSITION_COL_CANDIDATES);
        const infoRetireYearCol = pickColumnName(infoMeta.columns, INFO_RETIRE_YEAR_COL_CANDIDATES);

        const positionIdCol = pickColumnName(positionMeta.columns, POSITION_ID_COL_CANDIDATES);
        const positionSignPosCol = pickColumnName(positionMeta.columns, POSITION_SIGN_POS_COL_CANDIDATES);
        const positionSecondmentTextCol = pickColumnName(positionMeta.columns, POSITION_SECONDMENT_TEXT_COL_CANDIDATES);
        const positionBsTypeCol = pickColumnName(positionMeta.columns, POSITION_BS_TYPE_COL_CANDIDATES);
        const positionOrgTypeCol = pickColumnName(positionMeta.columns, POSITION_ORG_TYPE_COL_CANDIDATES);
        const positionOrgCol = pickColumnName(positionMeta.columns, POSITION_ORG_COL_CANDIDATES);
        const positionEmployeeCol = pickColumnName(positionMeta.columns, POSITION_EMPLOYEE_COL_CANDIDATES);
        const positionBeginDateCol = pickColumnName(positionMeta.columns, POSITION_BEGIN_DATE_COL_CANDIDATES);
        const positionEndDateCol = pickColumnName(positionMeta.columns, POSITION_END_DATE_COL_CANDIDATES);
        const unitOrgCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_ORG_COL_CANDIDATES) : null;
        const unitNameCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_NAME_COL_CANDIDATES) : null;
        const unitAbbrCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_ABBR_COL_CANDIDATES) : null;
        const unitBgCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_BG_COL_CANDIDATES) : null;

        if (!infoEmployeeCol || !infoNameCol || !infoPositionNameCol || !infoPositionCol || !infoRetireYearCol || !positionIdCol || !positionSignPosCol) {
            throw new Error('InfoData/fn_InterfacePosition required columns not found');
        }

        const positionOrderFields: string[] = [];
        if (positionEndDateCol) {
            positionOrderFields.push(`TRY_CONVERT(date, p.${escapeSqlIdentifier(positionEndDateCol)}) DESC`);
        }
        if (positionBeginDateCol) {
            positionOrderFields.push(`TRY_CONVERT(date, p.${escapeSqlIdentifier(positionBeginDateCol)}) DESC`);
        }
        positionOrderFields.push(`LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) DESC`);
        const positionOrderBy = positionOrderFields.join(', ');

        const keywordLike = `%${(keyword || '').trim()}%`;
        const effectiveDate = new Date();
        const positionSecondmentCondition = positionSecondmentTextCol
            ? `AND UPPER(LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionSecondmentTextCol)} AS nvarchar(64))))) = 'EMPLOYEE'`
            : '';
        const canJoinUnit = Boolean(unitMeta && unitSource && positionOrgCol && unitOrgCol);
        const unitJoinClause = canJoinUnit
            ? `
                LEFT JOIN ${unitSource} u
                    ON LTRIM(RTRIM(CAST(u.${escapeSqlIdentifier(unitOrgCol!)} AS nvarchar(32)))) =
                       LTRIM(RTRIM(CAST(p.org_unit_id AS nvarchar(32))))
            `
            : '';
        const unitNameSelectExpr = canJoinUnit && unitNameCol
            ? `NULLIF(LTRIM(RTRIM(CAST(u.${escapeSqlIdentifier(unitNameCol)} AS nvarchar(200)))), '')`
            : "N''";
        const queryEmployeeOptions = async (
            resolvedPositionOrgTypeCol: string | null,
            resolvedPositionBsTypeCol: string | null
        ) => {
            const delayTypeExpr = this.buildDelayTypeExpr({
                positionAlias: 'p',
                unitAlias: 'u',
                positionOrgTypeExpr: 'TRY_CONVERT(int, p.org_type)',
                positionBsTypeExpr: 'TRY_CONVERT(int, p.bs_type)',
                positionOrgTypeCol: null,
                positionBsTypeCol: null,
                unitBgCol: canJoinUnit ? unitBgCol : null,
                unitNameCol: canJoinUnit ? unitNameCol : null,
                unitAbbrCol: canJoinUnit ? unitAbbrCol : null
            });
            const request = pool.request()
                .input('RetireYear', sql.Int, typeof retireYear === 'number' && Number.isFinite(retireYear) ? retireYear : null)
                .input('KeywordLike', sql.NVarChar(128), keywordLike)
                .input('EffectiveDate', sql.DateTime, effectiveDate);

            const query = `
                ;WITH PositionDedup AS (
                    SELECT
                        LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) AS position_id,
                        ${positionEmployeeCol ? `LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionEmployeeCol)} AS nvarchar(32))))` : "N''"} AS employee_id,
                        ${resolvedPositionOrgTypeCol ? `TRY_CONVERT(int, p.${escapeSqlIdentifier(resolvedPositionOrgTypeCol)})` : 'NULL'} AS org_type,
                        ${resolvedPositionBsTypeCol ? `TRY_CONVERT(int, p.${escapeSqlIdentifier(resolvedPositionBsTypeCol)})` : 'NULL'} AS bs_type,
                        ${positionOrgCol ? `LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionOrgCol)} AS nvarchar(32))))` : "N''"} AS org_unit_id,
                        ROW_NUMBER() OVER (
                            PARTITION BY LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64))))
                            ORDER BY ${positionOrderBy}
                        ) AS rn
                    FROM ${positionSource} p
                    WHERE TRY_CONVERT(int, p.${escapeSqlIdentifier(positionSignPosCol)}) = 100
                      ${positionSecondmentCondition}
                ),
                InfoDataDedup AS (
                    SELECT
                        LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(32)))) AS employee_id,
                        LTRIM(RTRIM(COALESCE(CAST(i.${escapeSqlIdentifier(infoNameCol)} AS nvarchar(200)), N''))) AS employee_name,
                        LTRIM(RTRIM(COALESCE(CAST(i.${escapeSqlIdentifier(infoPositionNameCol)} AS nvarchar(200)), N''))) AS pos_name,
                        LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoPositionCol)} AS nvarchar(64)))) AS position_id,
                        TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) AS retire_year,
                        ROW_NUMBER() OVER (
                            PARTITION BY LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoPositionCol)} AS nvarchar(64))))
                            ORDER BY TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) DESC,
                                     LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(32)))) DESC
                        ) AS rn
                    FROM ${infoSource} i
                    WHERE (@RetireYear IS NULL OR TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) = @RetireYear)
                )
                SELECT
                    src.employee_id,
                    MAX(src.employee_name) AS employee_name,
                    MAX(src.pos_name) AS pos_name,
                    MAX(src.unit_name) AS unit_name,
                    MAX(src.delay_type) AS delay_type,
                    CASE WHEN MAX(src.delay_type) = 2 THEN 'Support' ELSE 'Business' END AS bu_support
                FROM (
                    SELECT
                        COALESCE(NULLIF(i.employee_id, ''), NULLIF(p.employee_id, '')) AS employee_id,
                        NULLIF(i.employee_name, '') AS employee_name,
                        NULLIF(i.pos_name, '') AS pos_name,
                        ${unitNameSelectExpr} AS unit_name,
                        ${delayTypeExpr} AS delay_type
                    FROM PositionDedup p
                    INNER JOIN InfoDataDedup i ON i.position_id = p.position_id AND i.rn = 1
                    ${unitJoinClause}
                    WHERE p.rn = 1
                ) src
                WHERE src.employee_id IS NOT NULL
                  AND src.employee_id <> ''
                  AND (
                        @KeywordLike = '%%'
                        OR src.employee_id LIKE @KeywordLike
                        OR COALESCE(src.employee_name, '') LIKE @KeywordLike
                        OR COALESCE(src.pos_name, '') LIKE @KeywordLike
                      )
                GROUP BY src.employee_id
                ORDER BY src.employee_id ASC
            `;

            return request.query(query);
        };

        let result;
        try {
            result = await queryEmployeeOptions(positionOrgTypeCol, positionBsTypeCol);
        } catch (error) {
            if (!this.isMissingDelayTypeColumnError(error)) throw error;
            result = await queryEmployeeOptions(null, null);
        }
        const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];

        return rows
            .map((row) => {
                const employeeId = this.getFirstNonEmpty(row, ['employee_id', 'EmployeeID']);
                if (!employeeId) return null;

                const name = this.getFirstNonEmpty(row, ['employee_name', 'EmployeeName']) || employeeId;
                const position = this.getFirstNonEmpty(row, ['pos_name', 'PosName']);
                const buSupport = this.getFirstNonEmpty(row, ['bu_support', 'BUSupport']);
                const unitName = this.getFirstNonEmpty(row, ['unit_name', 'UnitName']);
                const delayType = this.normalizeDelayType(this.getFirstNonEmpty(row, ['delay_type', 'DelayType'])) || 1;

                return {
                    value: employeeId,
                    label: `${employeeId} - ${name}`,
                    name,
                    position,
                    buSupport: buSupport || '-',
                    unitName: unitName || '-',
                    delayType
                };
            })
            .filter((item): item is DelayEmployeeOption => item !== null);
    }

    async getRetireYearOptions(): Promise<number[]> {
        const pool = await poolPromise;

        try {
            const infoMeta = await this.getTableMeta(pool, INFO_TABLE_CANDIDATES);
            const positionMeta = await this.getTableMeta(pool, POSITION_TABLE_CANDIDATES);

            if (infoMeta && positionMeta) {
                const infoSource = this.buildSqlSource(infoMeta, '@EffectiveDate');
                const positionSource = this.buildSqlSource(positionMeta, '@EffectiveDate');
                const infoRetireYearCol = pickColumnName(infoMeta.columns, INFO_RETIRE_YEAR_COL_CANDIDATES);
                const infoPositionCol = pickColumnName(infoMeta.columns, INFO_POSITION_COL_CANDIDATES);
                const positionIdCol = pickColumnName(positionMeta.columns, POSITION_ID_COL_CANDIDATES);
                const positionSignPosCol = pickColumnName(positionMeta.columns, POSITION_SIGN_POS_COL_CANDIDATES);
                const positionSecondmentTextCol = pickColumnName(positionMeta.columns, POSITION_SECONDMENT_TEXT_COL_CANDIDATES);
                const positionSecondmentCondition = positionSecondmentTextCol
                    ? `AND UPPER(LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionSecondmentTextCol)} AS nvarchar(64))))) = 'EMPLOYEE'`
                    : '';

                if (infoRetireYearCol && infoPositionCol && positionIdCol && positionSignPosCol) {
                    const result = await pool.request()
                        .input('EffectiveDate', sql.DateTime, new Date())
                        .query(`
                        SELECT DISTINCT
                            TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) AS retire_year
                        FROM ${infoSource} i
                        INNER JOIN ${positionSource} p
                            ON LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) =
                               LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoPositionCol)} AS nvarchar(64))))
                        WHERE TRY_CONVERT(int, p.${escapeSqlIdentifier(positionSignPosCol)}) = 100
                          ${positionSecondmentCondition}
                          AND TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) IS NOT NULL
                        ORDER BY TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) ASC
                    `);

                    const years = Array.isArray(result.recordset)
                        ? (result.recordset as GenericRow[])
                            .map((row) => Number.parseInt(String(row.retire_year), 10))
                            .filter((year) => Number.isFinite(year))
                        : [];

                    if (years.length > 0) {
                        return years;
                    }
                }
            }
        } catch (error) {
            console.warn('[DelayService.getRetireYearOptions] InfoData/interfaceposition source unavailable, fallback to MP_Delay', error);
        }

        try {
            const fallbackResult = await pool.request().query(`
                SELECT DISTINCT
                    TRY_CONVERT(int, DelayYear) AS retire_year
                FROM MP_Delay
                WHERE TRY_CONVERT(int, DelayYear) IS NOT NULL
                  AND TRY_CONVERT(int, DelayYear) <> ${NON_COUNT_DELAY_YEAR}
                ORDER BY TRY_CONVERT(int, DelayYear) ASC
            `);

            return Array.isArray(fallbackResult.recordset)
                ? (fallbackResult.recordset as GenericRow[])
                    .map((row) => Number.parseInt(String(row.retire_year), 10))
                    .filter((year) => Number.isFinite(year))
                : [];
        } catch (error) {
            console.warn('[DelayService.getRetireYearOptions] MP_Delay fallback failed', error);
            return [];
        }
    }

    private async getEmployeeProfile(employeeId: string): Promise<{ retireYear: number | null; delayType: number | null; posName: string | null }> {
        const normalizedEmployeeId = toTrimText(employeeId);
        if (!normalizedEmployeeId) return { retireYear: null, delayType: null, posName: null };

        const pool = await poolPromise;
        const infoMeta = await this.getTableMeta(pool, INFO_TABLE_CANDIDATES);
        const positionMeta = await this.getTableMeta(pool, POSITION_TABLE_CANDIDATES);
        const unitMeta = await this.getTableMeta(pool, UNIT_TABLE_CANDIDATES);
        if (!infoMeta || !positionMeta) return { retireYear: null, delayType: null, posName: null };
        const infoSource = this.buildSqlSource(infoMeta, '@EffectiveDate');
        const positionSource = this.buildSqlSource(positionMeta, '@EffectiveDate');
        const unitSource = unitMeta ? this.buildSqlSource(unitMeta, '@EffectiveDate') : '';

        const infoEmployeeCol = pickColumnName(infoMeta.columns, INFO_EMPLOYEE_COL_CANDIDATES);
        const infoPositionNameCol = pickColumnName(infoMeta.columns, INFO_POSITION_NAME_COL_CANDIDATES);
        const infoPositionCol = pickColumnName(infoMeta.columns, INFO_POSITION_COL_CANDIDATES);
        const infoRetireYearCol = pickColumnName(infoMeta.columns, INFO_RETIRE_YEAR_COL_CANDIDATES);
        const positionIdCol = pickColumnName(positionMeta.columns, POSITION_ID_COL_CANDIDATES);
        const positionSignPosCol = pickColumnName(positionMeta.columns, POSITION_SIGN_POS_COL_CANDIDATES);
        const positionSecondmentTextCol = pickColumnName(positionMeta.columns, POSITION_SECONDMENT_TEXT_COL_CANDIDATES);
        const positionBsTypeCol = pickColumnName(positionMeta.columns, POSITION_BS_TYPE_COL_CANDIDATES);
        const positionOrgTypeCol = pickColumnName(positionMeta.columns, POSITION_ORG_TYPE_COL_CANDIDATES);
        const positionOrgCol = pickColumnName(positionMeta.columns, POSITION_ORG_COL_CANDIDATES);
        const positionEmployeeCol = pickColumnName(positionMeta.columns, POSITION_EMPLOYEE_COL_CANDIDATES);
        const positionBeginDateCol = pickColumnName(positionMeta.columns, POSITION_BEGIN_DATE_COL_CANDIDATES);
        const positionEndDateCol = pickColumnName(positionMeta.columns, POSITION_END_DATE_COL_CANDIDATES);
        const unitOrgCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_ORG_COL_CANDIDATES) : null;
        const unitNameCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_NAME_COL_CANDIDATES) : null;
        const unitAbbrCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_ABBR_COL_CANDIDATES) : null;
        const unitBgCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_BG_COL_CANDIDATES) : null;

        if (!infoEmployeeCol || !infoPositionCol || !infoRetireYearCol || !positionIdCol || !positionSignPosCol) {
            return { retireYear: null, delayType: null, posName: null };
        }

        const positionOrderFields: string[] = [];
        if (positionEndDateCol) {
            positionOrderFields.push(`TRY_CONVERT(date, p.${escapeSqlIdentifier(positionEndDateCol)}) DESC`);
        }
        if (positionBeginDateCol) {
            positionOrderFields.push(`TRY_CONVERT(date, p.${escapeSqlIdentifier(positionBeginDateCol)}) DESC`);
        }
        positionOrderFields.push(`LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) DESC`);
        const positionOrderBy = positionOrderFields.join(', ');

        const positionEmpMatch = positionEmployeeCol
            ? `
                OR LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionEmployeeCol)} AS nvarchar(32)))) = @EmployeeID
            `
            : '';
        const positionSecondmentCondition = positionSecondmentTextCol
            ? `AND UPPER(LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionSecondmentTextCol)} AS nvarchar(64))))) = 'EMPLOYEE'`
            : '';
        const canJoinUnit = Boolean(unitMeta && unitSource && positionOrgCol && unitOrgCol);
        const unitJoinClause = canJoinUnit
            ? `
                LEFT JOIN ${unitSource} u
                    ON LTRIM(RTRIM(CAST(u.${escapeSqlIdentifier(unitOrgCol!)} AS nvarchar(32)))) =
                       LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionOrgCol!)} AS nvarchar(32))))
            `
            : '';
        const queryEmployeeProfile = async (
            resolvedPositionOrgTypeCol: string | null,
            resolvedPositionBsTypeCol: string | null
        ) => {
            const delayTypeExpr = this.buildDelayTypeExpr({
                positionAlias: 'p',
                unitAlias: 'u',
                positionOrgTypeCol: resolvedPositionOrgTypeCol,
                positionBsTypeCol: resolvedPositionBsTypeCol,
                unitBgCol: canJoinUnit ? unitBgCol : null,
                unitNameCol: canJoinUnit ? unitNameCol : null,
                unitAbbrCol: canJoinUnit ? unitAbbrCol : null
            });

            return pool.request()
                .input('EmployeeID', sql.VarChar(32), normalizedEmployeeId)
                .input('EffectiveDate', sql.DateTime, new Date())
                .query(`
                    SELECT TOP 1
                        TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) AS retire_year,
                        ${infoPositionNameCol ? `NULLIF(LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoPositionNameCol)} AS nvarchar(200)))), '')` : "N''"} AS pos_name,
                        ${delayTypeExpr} AS delay_type
                    FROM ${infoSource} i
                    INNER JOIN ${positionSource} p
                        ON LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) =
                           LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoPositionCol)} AS nvarchar(64))))
                    ${unitJoinClause}
                    WHERE TRY_CONVERT(int, p.${escapeSqlIdentifier(positionSignPosCol)}) = 100
                      ${positionSecondmentCondition}
                      AND (
                        LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(32)))) = @EmployeeID
                        ${positionEmpMatch}
                      )
                      AND TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) IS NOT NULL
                    ORDER BY TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) DESC,
                             ${positionOrderBy}
                `);
        };

        let result;
        try {
            result = await queryEmployeeProfile(positionOrgTypeCol, positionBsTypeCol);
        } catch (error) {
            if (!this.isMissingDelayTypeColumnError(error)) throw error;
            result = await queryEmployeeProfile(null, null);
        }

        const retireYearRaw = result.recordset?.[0]?.retire_year;
        const retireYear = Number.parseInt(String(retireYearRaw), 10);
        const delayType = this.normalizeDelayType(result.recordset?.[0]?.delay_type);
        const posName = this.getFirstNonEmpty(result.recordset?.[0] || {}, ['pos_name', 'PosName']) || null;
        return {
            retireYear: Number.isFinite(retireYear) ? retireYear : null,
            delayType,
            posName
        };
    }

    private async getEmployeeNameMapFromInfoData(employeeIds: string[]): Promise<Map<string, string>> {
        const uniqueIds = Array.from(new Set(employeeIds.map((id) => toTrimText(id)).filter(Boolean)));
        const nameMap = new Map<string, string>();
        if (!uniqueIds.length) return nameMap;
        try {
            const pool = await poolPromise;
            const infoMeta = await this.getTableMeta(pool, INFO_TABLE_CANDIDATES);
            if (!infoMeta) return nameMap;

            const infoSource = this.buildSqlSource(infoMeta, '@EffectiveDate');
            const infoEmployeeCol = pickColumnName(infoMeta.columns, INFO_EMPLOYEE_COL_CANDIDATES);
            const infoFullNameCol =
                pickColumnName(infoMeta.columns, INFO_FULL_NAME_COL_CANDIDATES) ||
                pickColumnName(infoMeta.columns, INFO_NAME_COL_CANDIDATES);

            if (!infoEmployeeCol || !infoFullNameCol) return nameMap;

            const request = pool.request()
                .input('EmployeeIdsCsv', sql.NVarChar(sql.MAX), uniqueIds.join(','))
                .input('EffectiveDate', sql.DateTime, new Date());

            const result = await request.query(`
                ;WITH target_ids AS (
                    SELECT DISTINCT LTRIM(RTRIM(value)) AS employee_id
                    FROM STRING_SPLIT(@EmployeeIdsCsv, ',')
                    WHERE LTRIM(RTRIM(value)) <> ''
                )
                SELECT
                    src.employee_id,
                    MAX(src.employee_name) AS employee_name
                FROM (
                    SELECT
                        LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(32)))) AS employee_id,
                        LTRIM(RTRIM(COALESCE(CAST(i.${escapeSqlIdentifier(infoFullNameCol)} AS nvarchar(200)), N''))) AS employee_name
                    FROM ${infoSource} i
                    INNER JOIN target_ids t
                        ON t.employee_id = LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(32))))
                ) src
                WHERE src.employee_id <> ''
                  AND src.employee_name <> ''
                GROUP BY src.employee_id
            `);

            const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
            rows.forEach((row) => {
                const employeeId = this.getFirstNonEmpty(row, ['employee_id', 'EmployeeID']);
                const employeeName = this.getFirstNonEmpty(row, ['employee_name', 'EmployeeName']);
                if (!employeeId || !employeeName) return;
                nameMap.set(employeeId, employeeName);
            });
        } catch (error) {
            console.warn('[DelayService.getEmployeeNameMapFromInfoData] fallback to employee directory name', error);
        }

        return nameMap;
    }

    private async getEmployeePositionMapFromInfoData(employeeIds: string[]): Promise<Map<string, string>> {
        const uniqueIds = Array.from(new Set(employeeIds.map((id) => toTrimText(id)).filter(Boolean)));
        const positionMap = new Map<string, string>();
        if (!uniqueIds.length) return positionMap;

        try {
            const pool = await poolPromise;
            const infoMeta = await this.getTableMeta(pool, INFO_TABLE_CANDIDATES);
            if (!infoMeta) return positionMap;

            const infoSource = this.buildSqlSource(infoMeta, '@EffectiveDate');
            const infoEmployeeCol = pickColumnName(infoMeta.columns, INFO_EMPLOYEE_COL_CANDIDATES);
            const infoPositionNameCol = pickColumnName(infoMeta.columns, INFO_POSITION_NAME_COL_CANDIDATES);

            if (!infoEmployeeCol || !infoPositionNameCol) return positionMap;

            const result = await pool.request()
                .input('EmployeeIdsCsv', sql.NVarChar(sql.MAX), uniqueIds.join(','))
                .input('EffectiveDate', sql.DateTime, new Date())
                .query(`
                    ;WITH target_ids AS (
                        SELECT DISTINCT LTRIM(RTRIM(value)) AS employee_id
                        FROM STRING_SPLIT(@EmployeeIdsCsv, ',')
                        WHERE LTRIM(RTRIM(value)) <> ''
                    )
                    SELECT
                        src.employee_id,
                        MAX(src.pos_name) AS pos_name
                    FROM (
                        SELECT
                            LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(32)))) AS employee_id,
                            LTRIM(RTRIM(COALESCE(CAST(i.${escapeSqlIdentifier(infoPositionNameCol)} AS nvarchar(200)), N''))) AS pos_name
                        FROM ${infoSource} i
                        INNER JOIN target_ids t
                            ON t.employee_id = LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(32))))
                    ) src
                    WHERE src.employee_id <> ''
                      AND src.pos_name <> ''
                    GROUP BY src.employee_id
                `);

            const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
            rows.forEach((row) => {
                const employeeId = this.getFirstNonEmpty(row, ['employee_id', 'EmployeeID']);
                const posName = this.getFirstNonEmpty(row, ['pos_name', 'PosName']);
                if (!employeeId || !posName) return;
                positionMap.set(employeeId, posName);
            });
        } catch (error) {
            console.warn('[DelayService.getEmployeePositionMapFromInfoData] fallback to employee directory position', error);
        }

        return positionMap;
    }

    private async getEmployeeOrgMetaMap(employeeIds: string[]): Promise<Map<string, EmployeeOrgMetaItem>> {
        const uniqueIds = Array.from(new Set(employeeIds.map((id) => toTrimText(id)).filter(Boolean)));
        const metaMap = new Map<string, EmployeeOrgMetaItem>();
        if (!uniqueIds.length) return metaMap;

        try {
            const pool = await poolPromise;
            const infoMeta = await this.getTableMeta(pool, INFO_TABLE_CANDIDATES);
            const positionMeta = await this.getTableMeta(pool, POSITION_TABLE_CANDIDATES);
            const unitMeta = await this.getTableMeta(pool, UNIT_TABLE_CANDIDATES);
            if (!infoMeta || !positionMeta) return metaMap;

            const infoSource = this.buildSqlSource(infoMeta, '@EffectiveDate');
            const positionSource = this.buildSqlSource(positionMeta, '@EffectiveDate');
            const unitSource = unitMeta ? this.buildSqlSource(unitMeta, '@EffectiveDate') : '';

            const infoEmployeeCol = pickColumnName(infoMeta.columns, INFO_EMPLOYEE_COL_CANDIDATES);
            const infoPositionCol = pickColumnName(infoMeta.columns, INFO_POSITION_COL_CANDIDATES);
            const infoRetireYearCol = pickColumnName(infoMeta.columns, INFO_RETIRE_YEAR_COL_CANDIDATES);
            const positionIdCol = pickColumnName(positionMeta.columns, POSITION_ID_COL_CANDIDATES);
            const positionSignPosCol = pickColumnName(positionMeta.columns, POSITION_SIGN_POS_COL_CANDIDATES);
            const positionSecondmentTextCol = pickColumnName(positionMeta.columns, POSITION_SECONDMENT_TEXT_COL_CANDIDATES);
            const positionBsTypeCol = pickColumnName(positionMeta.columns, POSITION_BS_TYPE_COL_CANDIDATES);
            const positionOrgTypeCol = pickColumnName(positionMeta.columns, POSITION_ORG_TYPE_COL_CANDIDATES);
            const positionOrgCol = pickColumnName(positionMeta.columns, POSITION_ORG_COL_CANDIDATES);
            const positionEmployeeCol = pickColumnName(positionMeta.columns, POSITION_EMPLOYEE_COL_CANDIDATES);
            const positionBeginDateCol = pickColumnName(positionMeta.columns, POSITION_BEGIN_DATE_COL_CANDIDATES);
            const positionEndDateCol = pickColumnName(positionMeta.columns, POSITION_END_DATE_COL_CANDIDATES);
            const unitOrgCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_ORG_COL_CANDIDATES) : null;
            const unitNameCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_NAME_COL_CANDIDATES) : null;
            const unitAbbrCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_ABBR_COL_CANDIDATES) : null;
            const unitBgCol = unitMeta ? pickColumnName(unitMeta.columns, UNIT_BG_COL_CANDIDATES) : null;

            if (!infoEmployeeCol || !infoPositionCol || !positionIdCol || !positionSignPosCol) {
                return metaMap;
            }

            const positionOrderFields: string[] = [];
            if (positionEndDateCol) {
                positionOrderFields.push(`TRY_CONVERT(date, p.${escapeSqlIdentifier(positionEndDateCol)}) DESC`);
            }
            if (positionBeginDateCol) {
                positionOrderFields.push(`TRY_CONVERT(date, p.${escapeSqlIdentifier(positionBeginDateCol)}) DESC`);
            }
            positionOrderFields.push(`LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) DESC`);
            const positionOrderBy = positionOrderFields.join(', ');

            const positionSecondmentCondition = positionSecondmentTextCol
                ? `AND UPPER(LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionSecondmentTextCol)} AS nvarchar(64))))) = 'EMPLOYEE'`
                : '';
            const canJoinUnit = Boolean(unitMeta && unitSource && positionOrgCol && unitOrgCol);
            const unitJoinClause = canJoinUnit
                ? `
                    LEFT JOIN ${unitSource} u
                        ON LTRIM(RTRIM(CAST(u.${escapeSqlIdentifier(unitOrgCol!)} AS nvarchar(32)))) =
                           LTRIM(RTRIM(CAST(p.org_unit_id AS nvarchar(32))))
                `
                : '';
            const unitNameSelectExpr = canJoinUnit && unitNameCol
                ? `NULLIF(LTRIM(RTRIM(CAST(u.${escapeSqlIdentifier(unitNameCol)} AS nvarchar(200)))), '')`
                : "N''";
            const queryEmployeeOrgMeta = async (
                resolvedPositionOrgTypeCol: string | null,
                resolvedPositionBsTypeCol: string | null
            ) => {
                const delayTypeExpr = this.buildDelayTypeExpr({
                    positionAlias: 'p',
                    unitAlias: 'u',
                    positionOrgTypeExpr: 'TRY_CONVERT(int, p.org_type)',
                    positionBsTypeExpr: 'TRY_CONVERT(int, p.bs_type)',
                    positionOrgTypeCol: null,
                    positionBsTypeCol: null,
                    unitBgCol: canJoinUnit ? unitBgCol : null,
                    unitNameCol: canJoinUnit ? unitNameCol : null,
                    unitAbbrCol: canJoinUnit ? unitAbbrCol : null
                });

                return pool.request()
                    .input('EmployeeIdsCsv', sql.NVarChar(sql.MAX), uniqueIds.join(','))
                    .input('EffectiveDate', sql.DateTime, new Date())
                    .query(`
                        ;WITH target_ids AS (
                            SELECT DISTINCT LTRIM(RTRIM(value)) AS employee_id
                            FROM STRING_SPLIT(@EmployeeIdsCsv, ',')
                            WHERE LTRIM(RTRIM(value)) <> ''
                        ),
                        PositionDedup AS (
                            SELECT
                                LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64)))) AS position_id,
                                ${positionEmployeeCol ? `LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionEmployeeCol)} AS nvarchar(32))))` : "N''"} AS employee_id,
                                ${resolvedPositionOrgTypeCol ? `TRY_CONVERT(int, p.${escapeSqlIdentifier(resolvedPositionOrgTypeCol)})` : 'NULL'} AS org_type,
                                ${resolvedPositionBsTypeCol ? `TRY_CONVERT(int, p.${escapeSqlIdentifier(resolvedPositionBsTypeCol)})` : 'NULL'} AS bs_type,
                                ${positionOrgCol ? `LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionOrgCol)} AS nvarchar(32))))` : "N''"} AS org_unit_id,
                                ROW_NUMBER() OVER (
                                    PARTITION BY LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionIdCol)} AS nvarchar(64))))
                                    ORDER BY ${positionOrderBy}
                                ) AS rn
                            FROM ${positionSource} p
                            WHERE TRY_CONVERT(int, p.${escapeSqlIdentifier(positionSignPosCol)}) = 100
                              ${positionSecondmentCondition}
                        ),
                        InfoDataDedup AS (
                            SELECT
                                LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(32)))) AS employee_id,
                                LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoPositionCol)} AS nvarchar(64)))) AS position_id,
                                ${infoRetireYearCol ? `TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)})` : 'NULL'} AS retire_year,
                                ROW_NUMBER() OVER (
                                    PARTITION BY LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoPositionCol)} AS nvarchar(64))))
                                    ORDER BY ${infoRetireYearCol ? `TRY_CONVERT(int, i.${escapeSqlIdentifier(infoRetireYearCol)}) DESC,` : ''} LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(infoEmployeeCol)} AS nvarchar(32)))) DESC
                                ) AS rn
                            FROM ${infoSource} i
                        )
                        SELECT
                            src.employee_id,
                            MAX(src.unit_name) AS unit_name,
                            MAX(src.delay_type) AS delay_type
                        FROM (
                            SELECT
                                COALESCE(NULLIF(i.employee_id, ''), NULLIF(p.employee_id, '')) AS employee_id,
                                ${unitNameSelectExpr} AS unit_name,
                                ${delayTypeExpr} AS delay_type
                            FROM PositionDedup p
                            INNER JOIN InfoDataDedup i
                                ON i.position_id = p.position_id
                               AND i.rn = 1
                            ${unitJoinClause}
                            WHERE p.rn = 1
                        ) src
                        INNER JOIN target_ids t ON t.employee_id = src.employee_id
                        GROUP BY src.employee_id
                    `);
            };

            let result;
            try {
                result = await queryEmployeeOrgMeta(positionOrgTypeCol, positionBsTypeCol);
            } catch (error) {
                if (!this.isMissingDelayTypeColumnError(error)) throw error;
                result = await queryEmployeeOrgMeta(null, null);
            }

            const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
            rows.forEach((row) => {
                const employeeId = this.getFirstNonEmpty(row, ['employee_id', 'EmployeeID']);
                if (!employeeId) return;

                metaMap.set(employeeId, {
                    unitName: this.getFirstNonEmpty(row, ['unit_name', 'UnitName']),
                    delayType: this.normalizeDelayType(this.getFirstNonEmpty(row, ['delay_type', 'DelayType']))
                });
            });
        } catch (error) {
            console.warn('[DelayService.getEmployeeOrgMetaMap] fallback to default org meta', error);
        }

        return metaMap;
    }

    private mapDelayRows(
        rows: GenericRow[],
        directory: Map<string, EmployeeDirectoryItem>,
        infoNameMap: Map<string, string> = new Map(),
        infoPositionMap: Map<string, string> = new Map(),
        orgMetaMap: Map<string, EmployeeOrgMetaItem> = new Map()
    ): DelayRecord[] {
        return rows.map((row) => {
            const delayId = this.getFirstNonEmpty(row, ['DelayID']);
            const employeeId = this.getFirstNonEmpty(row, ['EmployeeID']);
            const employeeInfo = directory.get(employeeId);
            const employeeOrgMeta = orgMetaMap.get(employeeId);

            const delayStatusRaw = this.getFirstNonEmpty(row, ['DelayStatus']);
            const delayStatus = Number.parseInt(delayStatusRaw, 10);
            const delayType =
                this.normalizeDelayType(this.getFirstNonEmpty(row, ['DelayType'])) ??
                employeeOrgMeta?.delayType ??
                null;

            const posNameFromTable = this.getFirstNonEmpty(row, ['PosName']);
            const posName = posNameFromTable || infoPositionMap.get(employeeId) || employeeInfo?.position || '';

            return {
                key: delayId,
                DelayID: delayId,
                EmployeeID: employeeId,
                EmployeeName: infoNameMap.get(employeeId) || employeeInfo?.name || employeeId,
                PosName: posName,
                UnitName: employeeOrgMeta?.unitName || '',
                BUSupport: delayType ? this.getDelayTypeLabel(delayType) : '',
                RetirementYear: this.getFirstNonEmpty(row, ['RetirementYear']),
                DelayYear: this.getFirstNonEmpty(row, ['DelayYear']),
                DelayStatus: Number.isNaN(delayStatus) ? 0 : delayStatus,
                DelayType: delayType ?? undefined
            };
        });
    }

    private async getDelayById(delayId: string): Promise<DelayRecord | null> {
        const pool = await poolPromise;
        const delayMeta = await this.getDelayTableMeta(pool);
        const hasRetirementYear = Boolean(delayMeta?.columns.get('retirementyear'));
        const hasDelayType = Boolean(delayMeta?.columns.get('delaytype'));
        const result = await pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .query(`
                SELECT
                    CAST(DelayID AS varchar(18)) AS DelayID,
                    LTRIM(RTRIM(CAST(EmployeeID AS varchar(20)))) AS EmployeeID,
                    LTRIM(RTRIM(COALESCE(PosName, ''))) AS PosName,
                    ${hasRetirementYear ? 'CAST(RetirementYear AS int)' : 'NULL'} AS RetirementYear,
                    CAST(DelayYear AS int) AS DelayYear,
                    CAST(DelayStatus AS int) AS DelayStatus,
                    ${hasDelayType ? 'CAST(DelayType AS int)' : 'NULL'} AS DelayType
                FROM MP_Delay
                WHERE CAST(DelayID AS varchar(18)) = @DelayID
            `);

        const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
        if (rows.length === 0) return null;

        const employeeIds = rows.map((row) => this.getFirstNonEmpty(row, ['EmployeeID']));
        const [directory, infoNameMap, infoPositionMap, orgMetaMap] = await Promise.all([
            this.getEmployeeDirectory(),
            this.getEmployeeNameMapFromInfoData(employeeIds),
            this.getEmployeePositionMapFromInfoData(employeeIds),
            this.getEmployeeOrgMetaMap(employeeIds)
        ]);
        return this.mapDelayRows(rows, directory, infoNameMap, infoPositionMap, orgMetaMap)[0] || null;
    }

    async getDelayData(delayYear?: number): Promise<DelayRecord[]> {
        const pool = await poolPromise;
        const delayMeta = await this.getDelayTableMeta(pool);
        const hasRetirementYear = Boolean(delayMeta?.columns.get('retirementyear'));
        const hasDelayType = Boolean(delayMeta?.columns.get('delaytype'));
        const request = pool.request();

        let query = `
            SELECT
                CAST(DelayID AS varchar(18)) AS DelayID,
                LTRIM(RTRIM(CAST(EmployeeID AS varchar(20)))) AS EmployeeID,
                LTRIM(RTRIM(COALESCE(PosName, ''))) AS PosName,
                ${hasRetirementYear ? 'CAST(RetirementYear AS int)' : 'NULL'} AS RetirementYear,
                CAST(DelayYear AS int) AS DelayYear,
                CAST(DelayStatus AS int) AS DelayStatus,
                ${hasDelayType ? 'CAST(DelayType AS int)' : 'NULL'} AS DelayType
            FROM MP_Delay
            WHERE ISNULL(DelayStatus, 1) = 1
        `;

        if (typeof delayYear === 'number' && Number.isFinite(delayYear)) {
            request.input('SelectedYear', sql.Int, delayYear);
            query += hasRetirementYear
                ? ' AND RetirementYear = @SelectedYear'
                : ' AND DelayYear = @SelectedYear';
        }

        query += hasRetirementYear
            ? ' ORDER BY RetirementYear DESC, DelayYear DESC, EmployeeID ASC, DelayID ASC'
            : ' ORDER BY DelayYear DESC, EmployeeID ASC, DelayID ASC';

        const result = await request.query(query);
        const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
        const employeeIds = rows.map((row) => this.getFirstNonEmpty(row, ['EmployeeID']));
        const [directory, infoNameMap, infoPositionMap, orgMetaMap] = await Promise.all([
            this.getEmployeeDirectory(),
            this.getEmployeeNameMapFromInfoData(employeeIds),
            this.getEmployeePositionMapFromInfoData(employeeIds),
            this.getEmployeeOrgMetaMap(employeeIds)
        ]);
        return this.mapDelayRows(rows, directory, infoNameMap, infoPositionMap, orgMetaMap);
    }

    async getEmployeeOptions(keyword?: string, retireYear?: number): Promise<DelayEmployeeOption[]> {
        const normalizedKeyword = (keyword || '').trim().toLowerCase();

        try {
            return await this.getEmployeeOptionsFromInfoData(retireYear, keyword);
        } catch (error) {
            console.warn('[DelayService.getEmployeeOptions] InfoData/interfaceposition source unavailable, fallback to employee directory', error);
        }

        const directory = await this.getEmployeeDirectory();
        const options = Array.from(directory.entries())
            .map(([employeeId, info]) => {
                const name = info.name || employeeId;
                return {
                    value: employeeId,
                    label: `${employeeId} - ${name}`,
                    name,
                    position: info.position || '',
                    buSupport: '-',
                    unitName: '-',
                    delayType: 1
                };
            })
            .filter((item) => {
                if (!normalizedKeyword) return true;
                return item.value.toLowerCase().includes(normalizedKeyword) || item.name.toLowerCase().includes(normalizedKeyword);
            })
            .sort((a, b) => a.value.localeCompare(b.value));

        return options;
    }

    async createDelayRecord(payload: DelayUpsertPayload): Promise<{ success: boolean; message?: string; data?: DelayRecord | null }> {
        const pool = await poolPromise;
        const delayMeta = await this.getDelayTableMeta(pool);
        const hasRetirementYear = Boolean(delayMeta?.columns.get('retirementyear'));
        const hasDelayType = Boolean(delayMeta?.columns.get('delaytype'));
        const profile = await this.getEmployeeProfile(payload.employeeId);
        const actualRetireYear = profile.retireYear;
        const retireYear = payload.retirementYear ?? actualRetireYear ?? null;
        const delayType = this.normalizeDelayType(payload.delayType) ?? profile.delayType ?? 1;
        const posName = toTrimText(payload.posName) || toTrimText(profile.posName);

        if (actualRetireYear !== null && payload.delayYear === actualRetireYear) {
            return { success: false, message: `ปีที่ทดต้องไม่เท่าปีเกษียณ (${actualRetireYear})` };
        }

        const duplicateCheck = await pool.request()
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('DelayYear', sql.Int, payload.delayYear)
            .query(`
                SELECT TOP 1 1 AS Found
                FROM MP_Delay
                WHERE EmployeeID = @EmployeeID
                  AND DelayYear = @DelayYear
                  AND ISNULL(DelayStatus, 1) = 1
            `);

        if ((duplicateCheck.recordset || []).length > 0) {
            return { success: false, message: 'พนักงานรายนี้มีข้อมูลปีที่ทดนี้แล้ว' };
        }

        const now = new Date();
        const insertColumns = [
            'EmployeeID', 'PosName',
            ...(hasRetirementYear ? ['RetirementYear'] : []),
            'DelayYear', 'DelayStatus',
            ...(hasDelayType ? ['DelayType'] : []),
            'CreateBy', 'CreateDate'
        ];
        const insertValues = [
            '@EmployeeID', '@PosName',
            ...(hasRetirementYear ? ['@RetirementYear'] : []),
            '@DelayYear', '@DelayStatus',
            ...(hasDelayType ? ['@DelayType'] : []),
            '@UserID', '@Now'
        ];
        const insertResult = await pool.request()
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('PosName', sql.VarChar(100), posName)
            .input('RetirementYear', sql.Int, retireYear)
            .input('DelayYear', sql.Int, payload.delayYear)
            .input('DelayStatus', sql.Int, payload.delayStatus)
            .input('DelayType', sql.Int, delayType)
            .input('UserID', sql.VarChar(10), payload.userId)
            .input('Now', sql.DateTime, now)
            .query(`
                INSERT INTO MP_Delay
                (
                    ${insertColumns.join(', ')}
                )
                VALUES
                (
                    ${insertValues.join(', ')}
                );

                SELECT CAST(SCOPE_IDENTITY() AS varchar(18)) AS DelayID;
            `);

        const createdDelayId = String(insertResult.recordset?.[0]?.DelayID || '').trim();
        if (!createdDelayId) {
            return { success: false, message: 'ไม่สามารถสร้างเลขที่รายการ Delay ได้' };
        }

        const created = await this.getDelayById(createdDelayId);
        return { success: true, data: created };
    }

    async updateDelayRecord(delayId: string, payload: DelayUpsertPayload): Promise<{ success: boolean; message?: string; data?: DelayRecord | null }> {
        const pool = await poolPromise;
        const delayMeta = await this.getDelayTableMeta(pool);
        const hasRetirementYear = Boolean(delayMeta?.columns.get('retirementyear'));
        const hasDelayType = Boolean(delayMeta?.columns.get('delaytype'));
        const profile = await this.getEmployeeProfile(payload.employeeId);
        const actualRetireYear = profile.retireYear;
        const retireYear = payload.retirementYear ?? actualRetireYear ?? null;
        const delayType = this.normalizeDelayType(payload.delayType) ?? profile.delayType ?? 1;
        const posName = toTrimText(payload.posName) || toTrimText(profile.posName);

        if (actualRetireYear !== null && payload.delayYear === actualRetireYear) {
            return { success: false, message: `ปีที่ทดต้องไม่เท่าปีเกษียณ (${actualRetireYear})` };
        }

        const duplicateCheck = await pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('DelayYear', sql.Int, payload.delayYear)
            .query(`
                SELECT TOP 1 1 AS Found
                FROM MP_Delay
                WHERE EmployeeID = @EmployeeID
                  AND DelayYear = @DelayYear
                  AND ISNULL(DelayStatus, 1) = 1
                  AND CAST(DelayID AS varchar(18)) <> @DelayID
            `);

        if ((duplicateCheck.recordset || []).length > 0) {
            return { success: false, message: 'พนักงานรายนี้มีข้อมูลปีที่ทดนี้แล้ว' };
        }

        const now = new Date();
        const updateAssignments = [
            'EmployeeID = @EmployeeID',
            'PosName = @PosName',
            ...(hasRetirementYear ? ['RetirementYear = @RetirementYear'] : []),
            'DelayYear = @DelayYear',
            'DelayStatus = @DelayStatus',
            ...(hasDelayType ? ['DelayType = @DelayType'] : []),
            'UpdateBy = @UserID',
            'UpdateDate = @Now'
        ];
        const updateResult = await pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('PosName', sql.VarChar(100), posName)
            .input('RetirementYear', sql.Int, retireYear)
            .input('DelayYear', sql.Int, payload.delayYear)
            .input('DelayStatus', sql.Int, payload.delayStatus)
            .input('DelayType', sql.Int, delayType)
            .input('UserID', sql.VarChar(10), payload.userId)
            .input('Now', sql.DateTime, now)
            .query(`
                UPDATE MP_Delay
                SET
                    ${updateAssignments.join(',\n                    ')}
                WHERE CAST(DelayID AS varchar(18)) = @DelayID
                  AND ISNULL(DelayStatus, 1) = 1
            `);

        const affected = updateResult.rowsAffected?.[0] || 0;
        if (affected === 0) {
            return { success: false, message: 'ไม่พบข้อมูลที่ต้องการแก้ไข' };
        }

        const updated = await this.getDelayById(delayId);
        return { success: true, data: updated };
    }

    async deleteDelayRecord(delayId: string, userId: string): Promise<{ success: boolean; message?: string }> {
        const pool = await poolPromise;
        const now = new Date();
        const deleteResult = await pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .input('UserID', sql.VarChar(10), userId)
            .input('Now', sql.DateTime, now)
            .query(`
                UPDATE MP_Delay
                SET
                    DelayStatus = 0,
                    UpdateBy = @UserID,
                    UpdateDate = @Now
                WHERE CAST(DelayID AS varchar(18)) = @DelayID
                  AND ISNULL(DelayStatus, 1) = 1
            `);

        const affected = deleteResult.rowsAffected?.[0] || 0;
        if (affected === 0) {
            return { success: false, message: 'ไม่พบข้อมูลที่ต้องการลบ' };
        }

        return { success: true };
    }
}

export default new DelayService();
