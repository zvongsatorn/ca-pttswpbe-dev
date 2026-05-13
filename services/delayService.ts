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

type EmployeeProfileResult = {
    retireYear: number | null;
    delayType: number | null;
    posName: string | null;
};

type EmployeeProfileColumns = {
    infoEmployeeCol: string | null;
    infoNameCol: string | null;
    infoPositionNameCol: string | null;
    infoPositionCol: string | null;
    infoRetireYearCol: string | null;
    positionIdCol: string | null;
    positionSignPosCol: string | null;
    positionSecondmentTextCol: string | null;
    positionBsTypeCol: string | null;
    positionOrgTypeCol: string | null;
    positionOrgCol: string | null;
    positionEmployeeCol: string | null;
    positionBeginDateCol: string | null;
    positionEndDateCol: string | null;
    unitOrgCol: string | null;
    unitNameCol: string | null;
    unitAbbrCol: string | null;
    unitBgCol: string | null;
};

type EmployeeProfileQueryContext = {
    pool: sql.ConnectionPool;
    normalizedEmployeeId: string;
    infoSource: string;
    positionSource: string;
    unitSource: string;
    canJoinUnit: boolean;
    unitJoinClause: string;
    positionEmpMatch: string;
    positionSecondmentCondition: string;
    columns: EmployeeProfileColumns;
};

type EmployeeOrgMetaQueryContext = {
    pool: sql.ConnectionPool;
    uniqueIds: string[];
    infoSource: string;
    positionSource: string;
    canJoinUnit: boolean;
    unitJoinClause: string;
    unitNameSelectExpr: string;
    positionSecondmentCondition: string;
    columns: EmployeeProfileColumns;
};

type EmployeeOptionsQueryContext = EmployeeOrgMetaQueryContext & {
    retireYear?: number;
    keywordLike: string;
    effectiveDate: Date;
};

const INFO_TABLE_CANDIDATES = ['InfoData', 'infodata'];
const POSITION_TABLE_CANDIDATES = ['fn_InterfacePosition', 'InterfacePosition', 'interfaceposition'];
const DELAY_METADATA_SCHEMA_CANDIDATES = ['dbo', 'db_owner'];
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

const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const escapeSqlIdentifier = (value: string): string => {
    if (!SQL_IDENTIFIER_PATTERN.test(value)) {
        throw new Error(`Unsupported SQL identifier: ${value}`);
    }
    return `[${value}]`;
};

const buildAllowedObjectFullName = (
    schemaName: string,
    objectName: string,
    allowedSchemas: string[],
    allowedObjects: string[]
): string => {
    const normalizedSchema = schemaName.trim().toLowerCase();
    const normalizedObject = objectName.trim().toLowerCase();
    const matchedSchema = allowedSchemas.find((schema) => schema === schemaName)
        || allowedSchemas.find((schema) => schema.toLowerCase() === normalizedSchema);
    const matchedObject = allowedObjects.find((object) => object === objectName)
        || allowedObjects.find((object) => object.toLowerCase() === normalizedObject);

    if (!matchedSchema || !matchedObject) {
        throw new Error(`Unsupported delay object source: ${schemaName}.${objectName}`);
    }

    return `${escapeSqlIdentifier(matchedSchema)}.${escapeSqlIdentifier(matchedObject)}`;
};
const toTrimText = (value: unknown): string => String(value || '').trim();

type SqlInputParam = {
    name: string;
    type: unknown;
    value: unknown;
};

const buildSqlInParams = (
    values: unknown[],
    prefix: string,
    type: unknown = sql.NVarChar(128)
): { placeholders: string; params: SqlInputParam[] } => {
    const params = values.map((value, index) => ({
        name: `${prefix}${index}`,
        type,
        value
    }));

    return {
        placeholders: params.map((param) => `@${param.name}`).join(','),
        params
    };
};

const bindSqlInputParams = (request: sql.Request, params: SqlInputParam[]) => {
    params.forEach((param) => request.input(param.name, param.type as any, param.value));
    return request;
};

const SQL_FRAGMENT_PATTERN = /^[A-Za-z0-9_\[\]@().=,\s]+$/;

const buildSqlFragmentList = (parts: string[]): string => {
    if (!parts.length) throw new Error('Empty SQL fragment list');
    parts.forEach((part) => {
        if (!SQL_FRAGMENT_PATTERN.test(part)) {
            throw new Error(`Unsupported SQL fragment: ${part}`);
        }
    });
    return parts.join(', ');
};

const pickColumnName = (columns: Map<string, string>, candidates: string[]): string | null => {
    for (const candidate of candidates) {
        const found = columns.get(candidate.toLowerCase());
        if (found === candidate) return candidate;
    }

    for (const candidate of candidates) {
        const found = columns.get(candidate.toLowerCase());
        if (found && SQL_IDENTIFIER_PATTERN.test(found)) return found;
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

    private rankTableCandidate(row: GenericRow, candidate: string): number {
        const objectName = toTrimText(row.object_name).toLowerCase();
        const schemaName = toTrimText(row.schema_name).toLowerCase();
        const objectType = toTrimText(row.object_type).toUpperCase();
        const objectExact = objectName === candidate.toLowerCase() ? 0 : 1;
        const schemaRank = schemaName === 'dbo' ? 0 : 1;
        const typeRank = objectType === 'U' ? 0 : 1;
        return objectExact * 100 + schemaRank * 10 + typeRank;
    }

    private selectTableMetaRow(rows: GenericRow[], tableCandidates: string[]): GenericRow | null {
        for (const candidate of tableCandidates) {
            const matched = rows
                .filter((row) => toTrimText(row.object_name).toLowerCase() === candidate.toLowerCase())
                .sort((a, b) => this.rankTableCandidate(a, candidate) - this.rankTableCandidate(b, candidate));
            if (matched.length > 0) {
                return matched[0];
            }
        }

        return [...rows].sort((a, b) => this.rankTableCandidate(a, tableCandidates[0]) - this.rankTableCandidate(b, tableCandidates[0]))[0] || null;
    }

    private async getTableMeta(
        pool: sql.ConnectionPool,
        tableCandidates: string[]
    ): Promise<TableMeta | null> {
        if (!tableCandidates.length) return null;

        const { placeholders: objectPlaceholders, params: objectParams } = buildSqlInParams(tableCandidates.map((name) => name.toLowerCase()), 'delayObject');
        const { placeholders: schemaPlaceholders, params: schemaParams } = buildSqlInParams(DELAY_METADATA_SCHEMA_CANDIDATES, 'delaySchema');
        const tableRequest = bindSqlInputParams(pool.request(), [...objectParams, ...schemaParams]);
        const tableRes = await tableRequest.query(`
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
              AND LOWER(o.name) IN (${objectPlaceholders})
              AND s.name IN (${schemaPlaceholders})
        `);

        const rows = Array.isArray(tableRes.recordset)
            ? (tableRes.recordset as GenericRow[])
            : [];
        if (!rows.length) return null;

        const selected = this.selectTableMetaRow(rows, tableCandidates);
        if (!selected) return null;

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

        const fullName = buildAllowedObjectFullName(
            schemaName,
            tableName,
            DELAY_METADATA_SCHEMA_CANDIDATES,
            tableCandidates
        );

        return {
            schemaName,
            tableName,
            objectName,
            fullName,
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
        if (paramCount === 0) {
            return `${meta.fullName}()`;
        }
        if (paramCount === 1) {
            return `${meta.fullName}(${effectiveDateParamName})`;
        }

        throw new Error(`Unsupported delay function parameter count: ${meta.objectName}`);
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
        let positionOrgTypeExpr = params.positionOrgTypeExpr || 'NULL';
        if (!params.positionOrgTypeExpr && params.positionOrgTypeCol) {
            positionOrgTypeExpr = 'TRY_CONVERT(int, ' + params.positionAlias + '.' + escapeSqlIdentifier(params.positionOrgTypeCol) + ')';
        }

        let positionBsTypeExpr = params.positionBsTypeExpr || 'NULL';
        if (!params.positionBsTypeExpr && params.positionBsTypeCol) {
            positionBsTypeExpr = 'TRY_CONVERT(int, ' + params.positionAlias + '.' + escapeSqlIdentifier(params.positionBsTypeCol) + ')';
        }
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

        const columns = this.pickEmployeeProfileColumns(infoMeta, positionMeta, unitMeta);
        if (!this.hasRequiredEmployeeOptionsColumns(columns)) {
            throw new Error('InfoData/fn_InterfacePosition required columns not found');
        }

        const result = await this.queryEmployeeOptionsWithFallback(this.buildEmployeeOptionsContext({
            pool,
            retireYear,
            keyword,
            infoMeta,
            positionMeta,
            unitMeta,
            columns
        }));
        const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];

        return rows
            .map((row) => this.mapEmployeeOptionRow(row))
            .filter((item): item is DelayEmployeeOption => item !== null);
    }

    private mapRetireYearRows(rows: unknown): number[] {
        return Array.isArray(rows)
            ? (rows as GenericRow[])
                .map((row) => Number.parseInt(String(row.retire_year), 10))
                .filter((year) => Number.isFinite(year))
            : [];
    }

    private async getRetireYearOptionsFromInfoData(pool: sql.ConnectionPool): Promise<number[]> {
        const infoMeta = await this.getTableMeta(pool, INFO_TABLE_CANDIDATES);
        const positionMeta = await this.getTableMeta(pool, POSITION_TABLE_CANDIDATES);
        if (!infoMeta || !positionMeta) return [];

        const infoSource = this.buildSqlSource(infoMeta, "@EffectiveDate");
        const positionSource = this.buildSqlSource(positionMeta, "@EffectiveDate");
        const infoRetireYearCol = pickColumnName(infoMeta.columns, INFO_RETIRE_YEAR_COL_CANDIDATES);
        const infoPositionCol = pickColumnName(infoMeta.columns, INFO_POSITION_COL_CANDIDATES);
        const positionIdCol = pickColumnName(positionMeta.columns, POSITION_ID_COL_CANDIDATES);
        const positionSignPosCol = pickColumnName(positionMeta.columns, POSITION_SIGN_POS_COL_CANDIDATES);
        if (!infoRetireYearCol || !infoPositionCol || !positionIdCol || !positionSignPosCol) return [];

        const positionSecondmentTextCol = pickColumnName(positionMeta.columns, POSITION_SECONDMENT_TEXT_COL_CANDIDATES);
        const positionSecondmentCondition = positionSecondmentTextCol
            ? `AND UPPER(LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(positionSecondmentTextCol)} AS nvarchar(64))))) = ${String.fromCharCode(39)}EMPLOYEE${String.fromCharCode(39)}`
            : "";
        const result = await pool.request()
            .input("EffectiveDate", sql.DateTime, new Date())
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

        return this.mapRetireYearRows(result.recordset);
    }

    private async getRetireYearOptionsFromDelayTable(pool: sql.ConnectionPool): Promise<number[]> {
        const fallbackResult = await pool.request().query(`
            SELECT DISTINCT
                TRY_CONVERT(int, DelayYear) AS retire_year
            FROM MP_Delay
            WHERE TRY_CONVERT(int, DelayYear) IS NOT NULL
              AND TRY_CONVERT(int, DelayYear) <> ${NON_COUNT_DELAY_YEAR}
            ORDER BY TRY_CONVERT(int, DelayYear) ASC
        `);

        return this.mapRetireYearRows(fallbackResult.recordset);
    }

    async getRetireYearOptions(): Promise<number[]> {
        const pool = await poolPromise;

        try {
            const years = await this.getRetireYearOptionsFromInfoData(pool);
            if (years.length > 0) return years;
        } catch (error) {
            console.warn("[DelayService.getRetireYearOptions] InfoData/interfaceposition source unavailable, fallback to MP_Delay", error);
        }

        try {
            return await this.getRetireYearOptionsFromDelayTable(pool);
        } catch (error) {
            console.warn("[DelayService.getRetireYearOptions] MP_Delay fallback failed", error);
            return [];
        }
    }

    private getEmptyEmployeeProfile(): EmployeeProfileResult {
        return { retireYear: null, delayType: null, posName: null };
    }

    private hasRequiredEmployeeOptionsColumns(columns: EmployeeProfileColumns): boolean {
        return Boolean(
            columns.infoEmployeeCol &&
            columns.infoNameCol &&
            columns.infoPositionNameCol &&
            columns.infoPositionCol &&
            columns.infoRetireYearCol &&
            columns.positionIdCol &&
            columns.positionSignPosCol
        );
    }

    private buildEmployeeOptionsContext(params: {
        pool: sql.ConnectionPool;
        retireYear?: number;
        keyword?: string;
        infoMeta: TableMeta;
        positionMeta: TableMeta;
        unitMeta: TableMeta | null;
        columns: EmployeeProfileColumns;
    }): EmployeeOptionsQueryContext {
        return {
            ...this.buildEmployeeOrgMetaContext({
                pool: params.pool,
                uniqueIds: [],
                infoMeta: params.infoMeta,
                positionMeta: params.positionMeta,
                unitMeta: params.unitMeta,
                columns: params.columns
            }),
            retireYear: params.retireYear,
            keywordLike: `%${(params.keyword || '').trim()}%`,
            effectiveDate: new Date()
        };
    }

    private buildEmployeeOptionsQuery(
        context: EmployeeOptionsQueryContext,
        resolvedPositionOrgTypeCol: string | null,
        resolvedPositionBsTypeCol: string | null
    ): string {
        const columns = context.columns;
        const positionOrderBy = this.buildEmployeeProfilePositionOrderBy(columns);
        const delayTypeExpr = this.buildDelayTypeExpr({
            positionAlias: 'p',
            unitAlias: 'u',
            positionOrgTypeExpr: 'TRY_CONVERT(int, p.org_type)',
            positionBsTypeExpr: 'TRY_CONVERT(int, p.bs_type)',
            positionOrgTypeCol: null,
            positionBsTypeCol: null,
            unitBgCol: context.canJoinUnit ? columns.unitBgCol : null,
            unitNameCol: context.canJoinUnit ? columns.unitNameCol : null,
            unitAbbrCol: context.canJoinUnit ? columns.unitAbbrCol : null
        });

        return `
            ;WITH PositionDedup AS (
                SELECT
                    LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(columns.positionIdCol!)} AS nvarchar(64)))) AS position_id,
                    ${columns.positionEmployeeCol ? `LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(columns.positionEmployeeCol)} AS nvarchar(32))))` : "N''"} AS employee_id,
                    ${resolvedPositionOrgTypeCol ? `TRY_CONVERT(int, p.${escapeSqlIdentifier(resolvedPositionOrgTypeCol)})` : 'NULL'} AS org_type,
                    ${resolvedPositionBsTypeCol ? `TRY_CONVERT(int, p.${escapeSqlIdentifier(resolvedPositionBsTypeCol)})` : 'NULL'} AS bs_type,
                    ${columns.positionOrgCol ? `LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(columns.positionOrgCol)} AS nvarchar(32))))` : "N''"} AS org_unit_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(columns.positionIdCol!)} AS nvarchar(64))))
                        ORDER BY ${positionOrderBy}
                    ) AS rn
                FROM ${context.positionSource} p
                WHERE TRY_CONVERT(int, p.${escapeSqlIdentifier(columns.positionSignPosCol!)}) = 100
                  ${context.positionSecondmentCondition}
            ),
            InfoDataDedup AS (
                SELECT
                    LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(columns.infoEmployeeCol!)} AS nvarchar(32)))) AS employee_id,
                    LTRIM(RTRIM(COALESCE(CAST(i.${escapeSqlIdentifier(columns.infoNameCol!)} AS nvarchar(200)), N''))) AS employee_name,
                    LTRIM(RTRIM(COALESCE(CAST(i.${escapeSqlIdentifier(columns.infoPositionNameCol!)} AS nvarchar(200)), N''))) AS pos_name,
                    LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(columns.infoPositionCol!)} AS nvarchar(64)))) AS position_id,
                    TRY_CONVERT(int, i.${escapeSqlIdentifier(columns.infoRetireYearCol!)}) AS retire_year,
                    ROW_NUMBER() OVER (
                        PARTITION BY LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(columns.infoPositionCol!)} AS nvarchar(64))))
                        ORDER BY TRY_CONVERT(int, i.${escapeSqlIdentifier(columns.infoRetireYearCol!)}) DESC,
                                 LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(columns.infoEmployeeCol!)} AS nvarchar(32)))) DESC
                    ) AS rn
                FROM ${context.infoSource} i
                WHERE (@RetireYear IS NULL OR TRY_CONVERT(int, i.${escapeSqlIdentifier(columns.infoRetireYearCol!)}) = @RetireYear)
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
                    ${context.unitNameSelectExpr} AS unit_name,
                    ${delayTypeExpr} AS delay_type
                FROM PositionDedup p
                INNER JOIN InfoDataDedup i ON i.position_id = p.position_id AND i.rn = 1
                ${context.unitJoinClause}
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
    }

    private queryEmployeeOptions(
        context: EmployeeOptionsQueryContext,
        resolvedPositionOrgTypeCol: string | null,
        resolvedPositionBsTypeCol: string | null
    ) {
        return context.pool.request()
            .input('RetireYear', sql.Int, typeof context.retireYear === 'number' && Number.isFinite(context.retireYear) ? context.retireYear : null)
            .input('KeywordLike', sql.NVarChar(128), context.keywordLike)
            .input('EffectiveDate', sql.DateTime, context.effectiveDate)
            .query(this.buildEmployeeOptionsQuery(context, resolvedPositionOrgTypeCol, resolvedPositionBsTypeCol));
    }

    private async queryEmployeeOptionsWithFallback(context: EmployeeOptionsQueryContext) {
        try {
            return await this.queryEmployeeOptions(context, context.columns.positionOrgTypeCol, context.columns.positionBsTypeCol);
        } catch (error) {
            if (!this.isMissingDelayTypeColumnError(error)) throw error;
            return this.queryEmployeeOptions(context, null, null);
        }
    }

    private mapEmployeeOptionRow(row: GenericRow): DelayEmployeeOption | null {
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
    }

    private pickEmployeeProfileColumns(
        infoMeta: TableMeta,
        positionMeta: TableMeta,
        unitMeta: TableMeta | null
    ): EmployeeProfileColumns {
        return {
            infoEmployeeCol: pickColumnName(infoMeta.columns, INFO_EMPLOYEE_COL_CANDIDATES),
            infoNameCol: pickColumnName(infoMeta.columns, INFO_NAME_COL_CANDIDATES),
            infoPositionNameCol: pickColumnName(infoMeta.columns, INFO_POSITION_NAME_COL_CANDIDATES),
            infoPositionCol: pickColumnName(infoMeta.columns, INFO_POSITION_COL_CANDIDATES),
            infoRetireYearCol: pickColumnName(infoMeta.columns, INFO_RETIRE_YEAR_COL_CANDIDATES),
            positionIdCol: pickColumnName(positionMeta.columns, POSITION_ID_COL_CANDIDATES),
            positionSignPosCol: pickColumnName(positionMeta.columns, POSITION_SIGN_POS_COL_CANDIDATES),
            positionSecondmentTextCol: pickColumnName(positionMeta.columns, POSITION_SECONDMENT_TEXT_COL_CANDIDATES),
            positionBsTypeCol: pickColumnName(positionMeta.columns, POSITION_BS_TYPE_COL_CANDIDATES),
            positionOrgTypeCol: pickColumnName(positionMeta.columns, POSITION_ORG_TYPE_COL_CANDIDATES),
            positionOrgCol: pickColumnName(positionMeta.columns, POSITION_ORG_COL_CANDIDATES),
            positionEmployeeCol: pickColumnName(positionMeta.columns, POSITION_EMPLOYEE_COL_CANDIDATES),
            positionBeginDateCol: pickColumnName(positionMeta.columns, POSITION_BEGIN_DATE_COL_CANDIDATES),
            positionEndDateCol: pickColumnName(positionMeta.columns, POSITION_END_DATE_COL_CANDIDATES),
            unitOrgCol: unitMeta ? pickColumnName(unitMeta.columns, UNIT_ORG_COL_CANDIDATES) : null,
            unitNameCol: unitMeta ? pickColumnName(unitMeta.columns, UNIT_NAME_COL_CANDIDATES) : null,
            unitAbbrCol: unitMeta ? pickColumnName(unitMeta.columns, UNIT_ABBR_COL_CANDIDATES) : null,
            unitBgCol: unitMeta ? pickColumnName(unitMeta.columns, UNIT_BG_COL_CANDIDATES) : null
        };
    }

    private hasRequiredEmployeeProfileColumns(columns: EmployeeProfileColumns): boolean {
        return Boolean(
            columns.infoEmployeeCol &&
            columns.infoPositionCol &&
            columns.infoRetireYearCol &&
            columns.positionIdCol &&
            columns.positionSignPosCol
        );
    }

    private buildEmployeeProfilePositionOrderBy(columns: EmployeeProfileColumns): string {
        const positionOrderFields: string[] = [];
        if (columns.positionEndDateCol) {
            positionOrderFields.push('TRY_CONVERT(date, p.' + escapeSqlIdentifier(columns.positionEndDateCol) + ') DESC');
        }
        if (columns.positionBeginDateCol) {
            positionOrderFields.push('TRY_CONVERT(date, p.' + escapeSqlIdentifier(columns.positionBeginDateCol) + ') DESC');
        }
        positionOrderFields.push('LTRIM(RTRIM(CAST(p.' + escapeSqlIdentifier(columns.positionIdCol!) + ' AS nvarchar(64)))) DESC');
        return buildSqlFragmentList(positionOrderFields);
    }

    private buildEmployeeOrgInfoOrderBy(columns: EmployeeProfileColumns): string {
        const infoOrderFields: string[] = [];
        if (columns.infoRetireYearCol) {
            infoOrderFields.push('TRY_CONVERT(int, i.' + escapeSqlIdentifier(columns.infoRetireYearCol) + ') DESC');
        }
        infoOrderFields.push('LTRIM(RTRIM(CAST(i.' + escapeSqlIdentifier(columns.infoEmployeeCol!) + ' AS nvarchar(32)))) DESC');
        return buildSqlFragmentList(infoOrderFields);
    }

    private buildEmployeeProfileUnitJoinClause(
        unitSource: string,
        canJoinUnit: boolean,
        columns: EmployeeProfileColumns
    ): string {
        if (!canJoinUnit) return '';
        return [
            'LEFT JOIN ' + unitSource + ' u',
            '    ON LTRIM(RTRIM(CAST(u.' + escapeSqlIdentifier(columns.unitOrgCol!) + ' AS nvarchar(32)))) =',
            '       LTRIM(RTRIM(CAST(p.' + escapeSqlIdentifier(columns.positionOrgCol!) + ' AS nvarchar(32))))'
        ].join('\n');
    }

    private buildEmployeeProfileQueryContext(params: {
        pool: sql.ConnectionPool;
        normalizedEmployeeId: string;
        infoMeta: TableMeta;
        positionMeta: TableMeta;
        unitMeta: TableMeta | null;
        columns: EmployeeProfileColumns;
    }): EmployeeProfileQueryContext {
        const infoSource = this.buildSqlSource(params.infoMeta, '@EffectiveDate');
        const positionSource = this.buildSqlSource(params.positionMeta, '@EffectiveDate');
        const unitSource = params.unitMeta ? this.buildSqlSource(params.unitMeta, '@EffectiveDate') : '';
        const canJoinUnit = Boolean(params.unitMeta && unitSource && params.columns.positionOrgCol && params.columns.unitOrgCol);
        const positionEmpMatch = params.columns.positionEmployeeCol
            ? 'OR LTRIM(RTRIM(CAST(p.' + escapeSqlIdentifier(params.columns.positionEmployeeCol) + ' AS nvarchar(32)))) = @EmployeeID'
            : '';
        const positionSecondmentCondition = params.columns.positionSecondmentTextCol
            ? "AND UPPER(LTRIM(RTRIM(CAST(p." + escapeSqlIdentifier(params.columns.positionSecondmentTextCol) + " AS nvarchar(64))))) = 'EMPLOYEE'"
            : '';

        return {
            pool: params.pool,
            normalizedEmployeeId: params.normalizedEmployeeId,
            infoSource,
            positionSource,
            unitSource,
            canJoinUnit,
            unitJoinClause: this.buildEmployeeProfileUnitJoinClause(unitSource, canJoinUnit, params.columns),
            positionEmpMatch,
            positionSecondmentCondition,
            columns: params.columns
        };
    }

    private buildEmployeeProfileQuery(
        context: EmployeeProfileQueryContext,
        resolvedPositionOrgTypeCol: string | null,
        resolvedPositionBsTypeCol: string | null
    ): string {
        const columns = context.columns;
        const positionOrderBy = this.buildEmployeeProfilePositionOrderBy(columns);
        const delayTypeExpr = this.buildDelayTypeExpr({
            positionAlias: 'p',
            unitAlias: 'u',
            positionOrgTypeCol: resolvedPositionOrgTypeCol,
            positionBsTypeCol: resolvedPositionBsTypeCol,
            unitBgCol: context.canJoinUnit ? columns.unitBgCol : null,
            unitNameCol: context.canJoinUnit ? columns.unitNameCol : null,
            unitAbbrCol: context.canJoinUnit ? columns.unitAbbrCol : null
        });
        const posNameExpr = columns.infoPositionNameCol
            ? "NULLIF(LTRIM(RTRIM(CAST(i." + escapeSqlIdentifier(columns.infoPositionNameCol) + " AS nvarchar(200)))), '')"
            : "N''";

        return [
            'SELECT TOP 1',
            '    TRY_CONVERT(int, i.' + escapeSqlIdentifier(columns.infoRetireYearCol!) + ') AS retire_year,',
            '    ' + posNameExpr + ' AS pos_name,',
            '    ' + delayTypeExpr + ' AS delay_type',
            'FROM ' + context.infoSource + ' i',
            'INNER JOIN ' + context.positionSource + ' p',
            '    ON LTRIM(RTRIM(CAST(p.' + escapeSqlIdentifier(columns.positionIdCol!) + ' AS nvarchar(64)))) =',
            '       LTRIM(RTRIM(CAST(i.' + escapeSqlIdentifier(columns.infoPositionCol!) + ' AS nvarchar(64))))',
            context.unitJoinClause,
            'WHERE TRY_CONVERT(int, p.' + escapeSqlIdentifier(columns.positionSignPosCol!) + ') = 100',
            '  ' + context.positionSecondmentCondition,
            '  AND (',
            '    LTRIM(RTRIM(CAST(i.' + escapeSqlIdentifier(columns.infoEmployeeCol!) + ' AS nvarchar(32)))) = @EmployeeID',
            '    ' + context.positionEmpMatch,
            '  )',
            '  AND TRY_CONVERT(int, i.' + escapeSqlIdentifier(columns.infoRetireYearCol!) + ') IS NOT NULL',
            'ORDER BY TRY_CONVERT(int, i.' + escapeSqlIdentifier(columns.infoRetireYearCol!) + ') DESC,',
            '         ' + positionOrderBy
        ].join('\n');
    }

    private queryEmployeeProfile(
        context: EmployeeProfileQueryContext,
        resolvedPositionOrgTypeCol: string | null,
        resolvedPositionBsTypeCol: string | null
    ) {
        return context.pool.request()
            .input('EmployeeID', sql.VarChar(32), context.normalizedEmployeeId)
            .input('EffectiveDate', sql.DateTime, new Date())
            .query(this.buildEmployeeProfileQuery(context, resolvedPositionOrgTypeCol, resolvedPositionBsTypeCol));
    }

    private async queryEmployeeProfileWithFallback(context: EmployeeProfileQueryContext) {
        try {
            return await this.queryEmployeeProfile(
                context,
                context.columns.positionOrgTypeCol,
                context.columns.positionBsTypeCol
            );
        } catch (error) {
            if (!this.isMissingDelayTypeColumnError(error)) throw error;
            return this.queryEmployeeProfile(context, null, null);
        }
    }

    private mapEmployeeProfileResult(row: GenericRow | undefined): EmployeeProfileResult {
        const retireYearRaw = row?.retire_year;
        const retireYear = Number.parseInt(String(retireYearRaw), 10);
        return {
            retireYear: Number.isFinite(retireYear) ? retireYear : null,
            delayType: this.normalizeDelayType(row?.delay_type),
            posName: this.getFirstNonEmpty(row || {}, ['pos_name', 'PosName']) || null
        };
    }

    private async getEmployeeProfile(employeeId: string): Promise<EmployeeProfileResult> {
        const normalizedEmployeeId = toTrimText(employeeId);
        if (!normalizedEmployeeId) return this.getEmptyEmployeeProfile();

        const pool = await poolPromise;
        const infoMeta = await this.getTableMeta(pool, INFO_TABLE_CANDIDATES);
        const positionMeta = await this.getTableMeta(pool, POSITION_TABLE_CANDIDATES);
        const unitMeta = await this.getTableMeta(pool, UNIT_TABLE_CANDIDATES);
        if (!infoMeta || !positionMeta) return this.getEmptyEmployeeProfile();

        const columns = this.pickEmployeeProfileColumns(infoMeta, positionMeta, unitMeta);
        if (!this.hasRequiredEmployeeProfileColumns(columns)) return this.getEmptyEmployeeProfile();

        const context = this.buildEmployeeProfileQueryContext({
            pool,
            normalizedEmployeeId,
            infoMeta,
            positionMeta,
            unitMeta,
            columns
        });
        const result = await this.queryEmployeeProfileWithFallback(context);
        return this.mapEmployeeProfileResult(result.recordset?.[0]);
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

    private hasRequiredEmployeeOrgMetaColumns(columns: EmployeeProfileColumns): boolean {
        return Boolean(
            columns.infoEmployeeCol &&
            columns.infoPositionCol &&
            columns.positionIdCol &&
            columns.positionSignPosCol
        );
    }

    private buildEmployeeOrgMetaUnitJoinClause(
        unitSource: string,
        canJoinUnit: boolean,
        columns: EmployeeProfileColumns
    ): string {
        if (!canJoinUnit) return '';
        return [
            'LEFT JOIN ' + unitSource + ' u',
            '    ON LTRIM(RTRIM(CAST(u.' + escapeSqlIdentifier(columns.unitOrgCol!) + ' AS nvarchar(32)))) =',
            '       LTRIM(RTRIM(CAST(p.org_unit_id AS nvarchar(32))))'
        ].join('\n');
    }

    private buildEmployeeOrgMetaContext(params: {
        pool: sql.ConnectionPool;
        uniqueIds: string[];
        infoMeta: TableMeta;
        positionMeta: TableMeta;
        unitMeta: TableMeta | null;
        columns: EmployeeProfileColumns;
    }): EmployeeOrgMetaQueryContext {
        const infoSource = this.buildSqlSource(params.infoMeta, '@EffectiveDate');
        const positionSource = this.buildSqlSource(params.positionMeta, '@EffectiveDate');
        const unitSource = params.unitMeta ? this.buildSqlSource(params.unitMeta, '@EffectiveDate') : '';
        const canJoinUnit = Boolean(params.unitMeta && unitSource && params.columns.positionOrgCol && params.columns.unitOrgCol);
        const positionSecondmentCondition = params.columns.positionSecondmentTextCol
            ? "AND UPPER(LTRIM(RTRIM(CAST(p." + escapeSqlIdentifier(params.columns.positionSecondmentTextCol) + " AS nvarchar(64))))) = 'EMPLOYEE'"
            : '';
        const unitNameSelectExpr = canJoinUnit && params.columns.unitNameCol
            ? "NULLIF(LTRIM(RTRIM(CAST(u." + escapeSqlIdentifier(params.columns.unitNameCol) + " AS nvarchar(200)))), '')"
            : "N''";

        return {
            pool: params.pool,
            uniqueIds: params.uniqueIds,
            infoSource,
            positionSource,
            canJoinUnit,
            unitJoinClause: this.buildEmployeeOrgMetaUnitJoinClause(unitSource, canJoinUnit, params.columns),
            unitNameSelectExpr,
            positionSecondmentCondition,
            columns: params.columns
        };
    }

    private buildEmployeeOrgMetaQuery(
        context: EmployeeOrgMetaQueryContext,
        resolvedPositionOrgTypeCol: string | null,
        resolvedPositionBsTypeCol: string | null
    ): string {
        const columns = context.columns;
        const positionOrderBy = this.buildEmployeeProfilePositionOrderBy(columns);
        const infoOrderBy = this.buildEmployeeOrgInfoOrderBy(columns);
        const delayTypeExpr = this.buildDelayTypeExpr({
            positionAlias: 'p',
            unitAlias: 'u',
            positionOrgTypeExpr: 'TRY_CONVERT(int, p.org_type)',
            positionBsTypeExpr: 'TRY_CONVERT(int, p.bs_type)',
            positionOrgTypeCol: null,
            positionBsTypeCol: null,
            unitBgCol: context.canJoinUnit ? columns.unitBgCol : null,
            unitNameCol: context.canJoinUnit ? columns.unitNameCol : null,
            unitAbbrCol: context.canJoinUnit ? columns.unitAbbrCol : null
        });

        return `
            ;WITH target_ids AS (
                SELECT DISTINCT LTRIM(RTRIM(value)) AS employee_id
                FROM STRING_SPLIT(@EmployeeIdsCsv, ',')
                WHERE LTRIM(RTRIM(value)) <> ''
            ),
            PositionDedup AS (
                SELECT
                    LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(columns.positionIdCol!)} AS nvarchar(64)))) AS position_id,
                    ${columns.positionEmployeeCol ? `LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(columns.positionEmployeeCol)} AS nvarchar(32))))` : "N''"} AS employee_id,
                    ${resolvedPositionOrgTypeCol ? `TRY_CONVERT(int, p.${escapeSqlIdentifier(resolvedPositionOrgTypeCol)})` : 'NULL'} AS org_type,
                    ${resolvedPositionBsTypeCol ? `TRY_CONVERT(int, p.${escapeSqlIdentifier(resolvedPositionBsTypeCol)})` : 'NULL'} AS bs_type,
                    ${columns.positionOrgCol ? `LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(columns.positionOrgCol)} AS nvarchar(32))))` : "N''"} AS org_unit_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY LTRIM(RTRIM(CAST(p.${escapeSqlIdentifier(columns.positionIdCol!)} AS nvarchar(64))))
                        ORDER BY ${positionOrderBy}
                    ) AS rn
                FROM ${context.positionSource} p
                WHERE TRY_CONVERT(int, p.${escapeSqlIdentifier(columns.positionSignPosCol!)}) = 100
                  ${context.positionSecondmentCondition}
            ),
            InfoDataDedup AS (
                SELECT
                    LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(columns.infoEmployeeCol!)} AS nvarchar(32)))) AS employee_id,
                    LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(columns.infoPositionCol!)} AS nvarchar(64)))) AS position_id,
                    ${columns.infoRetireYearCol ? `TRY_CONVERT(int, i.${escapeSqlIdentifier(columns.infoRetireYearCol)})` : 'NULL'} AS retire_year,
                    ROW_NUMBER() OVER (
                        PARTITION BY LTRIM(RTRIM(CAST(i.${escapeSqlIdentifier(columns.infoPositionCol!)} AS nvarchar(64))))
                        ORDER BY ${infoOrderBy}
                    ) AS rn
                FROM ${context.infoSource} i
            )
            SELECT
                src.employee_id,
                MAX(src.unit_name) AS unit_name,
                MAX(src.delay_type) AS delay_type
            FROM (
                SELECT
                    COALESCE(NULLIF(i.employee_id, ''), NULLIF(p.employee_id, '')) AS employee_id,
                    ${context.unitNameSelectExpr} AS unit_name,
                    ${delayTypeExpr} AS delay_type
                FROM PositionDedup p
                INNER JOIN InfoDataDedup i
                    ON i.position_id = p.position_id
                   AND i.rn = 1
                ${context.unitJoinClause}
                WHERE p.rn = 1
            ) src
            INNER JOIN target_ids t ON t.employee_id = src.employee_id
            GROUP BY src.employee_id
        `;
    }

    private queryEmployeeOrgMeta(
        context: EmployeeOrgMetaQueryContext,
        resolvedPositionOrgTypeCol: string | null,
        resolvedPositionBsTypeCol: string | null
    ) {
        return context.pool.request()
            .input('EmployeeIdsCsv', sql.NVarChar(sql.MAX), context.uniqueIds.join(','))
            .input('EffectiveDate', sql.DateTime, new Date())
            .query(this.buildEmployeeOrgMetaQuery(context, resolvedPositionOrgTypeCol, resolvedPositionBsTypeCol));
    }

    private async queryEmployeeOrgMetaWithFallback(context: EmployeeOrgMetaQueryContext) {
        try {
            return await this.queryEmployeeOrgMeta(context, context.columns.positionOrgTypeCol, context.columns.positionBsTypeCol);
        } catch (error) {
            if (!this.isMissingDelayTypeColumnError(error)) throw error;
            return this.queryEmployeeOrgMeta(context, null, null);
        }
    }

    private addEmployeeOrgMetaRows(metaMap: Map<string, EmployeeOrgMetaItem>, rows: GenericRow[]) {
        rows.forEach((row) => {
            const employeeId = this.getFirstNonEmpty(row, ['employee_id', 'EmployeeID']);
            if (!employeeId) return;

            metaMap.set(employeeId, {
                unitName: this.getFirstNonEmpty(row, ['unit_name', 'UnitName']),
                delayType: this.normalizeDelayType(this.getFirstNonEmpty(row, ['delay_type', 'DelayType']))
            });
        });
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

            const columns = this.pickEmployeeProfileColumns(infoMeta, positionMeta, unitMeta);
            if (!this.hasRequiredEmployeeOrgMetaColumns(columns)) return metaMap;

            const result = await this.queryEmployeeOrgMetaWithFallback(this.buildEmployeeOrgMetaContext({
                pool,
                uniqueIds,
                infoMeta,
                positionMeta,
                unitMeta,
                columns
            }));
            const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
            this.addEmployeeOrgMetaRows(metaMap, rows);
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

    private buildInsertDelaySql(hasRetirementYear: boolean, hasDelayType: boolean): string {
        if (hasRetirementYear && hasDelayType) {
            return `
                INSERT INTO MP_Delay
                    (EmployeeID, PosName, RetirementYear, DelayYear, DelayStatus, DelayType, CreateBy, CreateDate)
                VALUES
                    (@EmployeeID, @PosName, @RetirementYear, @DelayYear, @DelayStatus, @DelayType, @UserID, @Now);

                SELECT CAST(SCOPE_IDENTITY() AS varchar(18)) AS DelayID;
            `;
        }

        if (hasRetirementYear) {
            return `
                INSERT INTO MP_Delay
                    (EmployeeID, PosName, RetirementYear, DelayYear, DelayStatus, CreateBy, CreateDate)
                VALUES
                    (@EmployeeID, @PosName, @RetirementYear, @DelayYear, @DelayStatus, @UserID, @Now);

                SELECT CAST(SCOPE_IDENTITY() AS varchar(18)) AS DelayID;
            `;
        }

        if (hasDelayType) {
            return `
                INSERT INTO MP_Delay
                    (EmployeeID, PosName, DelayYear, DelayStatus, DelayType, CreateBy, CreateDate)
                VALUES
                    (@EmployeeID, @PosName, @DelayYear, @DelayStatus, @DelayType, @UserID, @Now);

                SELECT CAST(SCOPE_IDENTITY() AS varchar(18)) AS DelayID;
            `;
        }

        return `
            INSERT INTO MP_Delay
                (EmployeeID, PosName, DelayYear, DelayStatus, CreateBy, CreateDate)
            VALUES
                (@EmployeeID, @PosName, @DelayYear, @DelayStatus, @UserID, @Now);

            SELECT CAST(SCOPE_IDENTITY() AS varchar(18)) AS DelayID;
        `;
    }

    private buildUpdateDelaySql(hasRetirementYear: boolean, hasDelayType: boolean): string {
        if (hasRetirementYear && hasDelayType) {
            return `
                UPDATE MP_Delay
                SET EmployeeID = @EmployeeID,
                    PosName = @PosName,
                    RetirementYear = @RetirementYear,
                    DelayYear = @DelayYear,
                    DelayStatus = @DelayStatus,
                    DelayType = @DelayType,
                    UpdateBy = @UserID,
                    UpdateDate = @Now
                WHERE CAST(DelayID AS varchar(18)) = @DelayID
                  AND ISNULL(DelayStatus, 1) = 1
            `;
        }

        if (hasRetirementYear) {
            return `
                UPDATE MP_Delay
                SET EmployeeID = @EmployeeID,
                    PosName = @PosName,
                    RetirementYear = @RetirementYear,
                    DelayYear = @DelayYear,
                    DelayStatus = @DelayStatus,
                    UpdateBy = @UserID,
                    UpdateDate = @Now
                WHERE CAST(DelayID AS varchar(18)) = @DelayID
                  AND ISNULL(DelayStatus, 1) = 1
            `;
        }

        if (hasDelayType) {
            return `
                UPDATE MP_Delay
                SET EmployeeID = @EmployeeID,
                    PosName = @PosName,
                    DelayYear = @DelayYear,
                    DelayStatus = @DelayStatus,
                    DelayType = @DelayType,
                    UpdateBy = @UserID,
                    UpdateDate = @Now
                WHERE CAST(DelayID AS varchar(18)) = @DelayID
                  AND ISNULL(DelayStatus, 1) = 1
            `;
        }

        return `
            UPDATE MP_Delay
            SET EmployeeID = @EmployeeID,
                PosName = @PosName,
                DelayYear = @DelayYear,
                DelayStatus = @DelayStatus,
                UpdateBy = @UserID,
                UpdateDate = @Now
            WHERE CAST(DelayID AS varchar(18)) = @DelayID
              AND ISNULL(DelayStatus, 1) = 1
        `;
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
        const insertRequest = pool.request()
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('PosName', sql.VarChar(100), posName)
            .input('RetirementYear', sql.Int, retireYear)
            .input('DelayYear', sql.Int, payload.delayYear)
            .input('DelayStatus', sql.Int, payload.delayStatus)
            .input('DelayType', sql.Int, delayType)
            .input('UserID', sql.VarChar(10), payload.userId)
            .input('Now', sql.DateTime, now);
        const insertResult = await insertRequest.query(this.buildInsertDelaySql(hasRetirementYear, hasDelayType));

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
        const updateRequest = pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('PosName', sql.VarChar(100), posName)
            .input('RetirementYear', sql.Int, retireYear)
            .input('DelayYear', sql.Int, payload.delayYear)
            .input('DelayStatus', sql.Int, payload.delayStatus)
            .input('DelayType', sql.Int, delayType)
            .input('UserID', sql.VarChar(10), payload.userId)
            .input('Now', sql.DateTime, now);
        const updateResult = await updateRequest.query(this.buildUpdateDelaySql(hasRetirementYear, hasDelayType));

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
