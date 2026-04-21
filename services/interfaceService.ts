import ExcelJS from 'exceljs';
import { poolPromise, sql } from '../config/db.js';

const DEFAULT_MAX_UPLOAD_ROWS = 500000;
const parsedMaxUploadRows = Number.parseInt(process.env.INTERFACE_MAX_UPLOAD_ROWS || '', 10);
const MAX_UPLOAD_ROWS = Number.isFinite(parsedMaxUploadRows) && parsedMaxUploadRows > 0
    ? parsedMaxUploadRows
    : DEFAULT_MAX_UPLOAD_ROWS;
const DEFAULT_BULK_BATCH_SIZE = 20000;
const parsedBulkBatchSize = Number.parseInt(process.env.INTERFACE_BULK_BATCH_SIZE || '', 10);
const BULK_BATCH_SIZE = Number.isFinite(parsedBulkBatchSize) && parsedBulkBatchSize > 0
    ? parsedBulkBatchSize
    : DEFAULT_BULK_BATCH_SIZE;
const HRP_TABLE_SCHEMA_CANDIDATES = ['db_owner', 'dbo'] as const;

const REQUIRED_COLUMN_ALIASES = {
    EmailAddr: ['EMAILADDR', 'PERSONALEMAIL', 'EMAIL', 'WORKEMAIL'],
    SEX: ['SEX'],
    UNITCODE: ['UNITCODE'],
    HIRINGDATE: ['HIRINGDATE'],
    ASSIGNDATE: ['ASSIGNDATE'],
    RETIREDATE: ['RETIREDATE'],
    POSCODE: ['POSCODE'],
    FULLNAMETH: ['FULLNAMETH'],
    FULLNAMEENG: ['FULLNAMEENG', 'FULLNAMEENGLISH'],
    CHANGE_DATE: ['CHANGEDATE'],
    CODE: ['CODE'],
    RETIREYEAR: ['RETIREYEAR'],
    POSNAME: ['POSNAME'],
    BAND: ['BAND']
} as const;

type RequiredColumnKey = keyof typeof REQUIRED_COLUMN_ALIASES;
const HRP_FILE_TO_TABLE_MAP = {
    HRP1001O: 'HRP1001',
    HRP1001S: 'HRP1001',
    HRP1002: 'HRP1002'
} as const;

const ALLOWED_HRP_FILE_NAMES = Object.keys(HRP_FILE_TO_TABLE_MAP);

export type HrpTargetTable = (typeof HRP_FILE_TO_TABLE_MAP)[keyof typeof HRP_FILE_TO_TABLE_MAP];

export interface InfoDataImportSummary {
    parsedRows: number;
    insertedRows: number;
    skippedRows: number;
    replaceExisting: boolean;
}

export interface HrpDataImportSummary {
    parsedRows: number;
    insertedRows: number;
    skippedRows: number;
    replaceExisting: boolean;
    targetTable: HrpTargetTable;
    sourceFile: string;
}

interface ParsedDataRow {
    sourceRowNumber: number;
    values: unknown[];
}

interface ParsedTable {
    headers: unknown[];
    rows: ParsedDataRow[];
}

interface HrpTableColumnsMeta {
    schema: string;
    columns: string[];
}

interface InfoDataBulkRow {
    CODE: string | null;
    FULLNAMETH: string | null;
    FULLNAMEENG: string | null;
    SEX: number | null;
    EmailAddr: string | null;
    POSCODE: string | null;
    POSNAME: string | null;
    UNITCODE: string | null;
    HIRINGDATE: string | null;
    ASSIGNDATE: string | null;
    RETIREDATE: string | null;
    RETIREYEAR: number | null;
    BAND: string | null;
    CHANGE_DATE: string | null;
}

const normalizeHeader = (value: unknown): string =>
    String(value || '')
        .trim()
        .replace(/^\uFEFF/, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase();

const unwrapExcelCell = (value: unknown): unknown => {
    if (value && typeof value === 'object') {
        const asObject = value as {
            result?: unknown;
            text?: unknown;
            richText?: Array<{ text?: string }>;
        };

        if (asObject.result !== undefined) return asObject.result;
        if (asObject.text !== undefined) return asObject.text;

        if (Array.isArray(asObject.richText)) {
            return asObject.richText.map((part) => part.text || '').join('');
        }
    }

    return value;
};

const cleanCellText = (value: unknown): string => {
    const raw = unwrapExcelCell(value);

    if (raw === null || raw === undefined) return '';
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return raw.toISOString().slice(0, 10);
    }

    let text = String(raw).trim();
    if (!text) return '';

    if (text.startsWith('="') && text.endsWith('"')) {
        text = text.slice(2, -1);
    }

    if (text.startsWith('"') && text.endsWith('"')) {
        text = text.slice(1, -1);
    }

    text = text.replace(/""/g, '"').trim();
    return text;
};

const toNullableText = (value: unknown, maxLength: number): string | null => {
    const text = cleanCellText(value);
    if (!text) return null;
    return text.slice(0, maxLength);
};

const toNullableUnlimitedText = (value: unknown): string | null => {
    const text = cleanCellText(value);
    if (!text) return null;
    return text;
};

const toNullableEmail = (value: unknown, maxLength = 100): string | null => {
    const text = cleanCellText(value);
    if (!text) return null;

    const cleaned = text
        .replace(/^mailto:/i, '')
        .replace(/^[='"\s]+/, '')
        .replace(/[='"\s]+$/, '')
        .trim();

    if (!cleaned) return null;

    const match = cleaned.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match?.[0]) {
        return match[0].slice(0, maxLength);
    }

    if (cleaned.includes('@')) {
        return cleaned.slice(0, maxLength);
    }

    return null;
};

const toNullableInt = (value: unknown): number | null => {
    const text = cleanCellText(value).replace(/,/g, '');
    if (!text) return null;

    const parsed = Number.parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const toExcelSerialDate = (serial: number): string | null => {
    if (!Number.isFinite(serial)) return null;

    const utcMillis = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(utcMillis);
    if (Number.isNaN(d.getTime())) return null;

    return d.toISOString().slice(0, 10);
};

const toNullableDate = (value: unknown): string | null => {
    const raw = unwrapExcelCell(value);

    if (raw === null || raw === undefined || raw === '') return null;

    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return raw.toISOString().slice(0, 10);
    }

    if (typeof raw === 'number') {
        return toExcelSerialDate(raw);
    }

    const text = cleanCellText(raw);
    if (!text) return null;

    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
        return text.slice(0, 10);
    }

    if (/^\d{4}\/\d{2}\/\d{2}/.test(text)) {
        return text.slice(0, 10).replace(/\//g, '-');
    }

    if (/^\d{8}$/.test(text)) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }

    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) {
        const [left, middle, right] = text.split('/').map((part) => Number.parseInt(part, 10));
        if (!Number.isFinite(left) || !Number.isFinite(middle) || !Number.isFinite(right)) return null;

        let year = right;
        if (year > 2400) year -= 543;
        if (year < 100) year += 2000;

        const day = left;
        const month = middle;

        const d = new Date(Date.UTC(year, month - 1, day));
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
    }

    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;

    return parsed.toISOString().slice(0, 10);
};

const isEmptyRow = (values: unknown[]): boolean => {
    return values.every((value) => cleanCellText(value) === '');
};

const parseCsvText = (text: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;

    const source = text.replace(/^\uFEFF/, '');

    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];

        if (ch === '"') {
            if (inQuotes && source[i + 1] === '"') {
                currentField += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === ',' && !inQuotes) {
            currentRow.push(currentField);
            currentField = '';
            continue;
        }

        if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && source[i + 1] === '\n') i += 1;
            currentRow.push(currentField);
            rows.push(currentRow);
            currentRow = [];
            currentField = '';
            continue;
        }

        currentField += ch;
    }

    currentRow.push(currentField);
    rows.push(currentRow);

    return rows;
};

const decodeCsvBuffer = (buffer: Uint8Array): string => {
    const utf8 = Buffer.from(buffer).toString('utf8');
    if (!utf8.includes('\uFFFD')) return utf8;

    try {
        const decoder = new TextDecoder('windows-874');
        return decoder.decode(buffer);
    } catch {
        return utf8;
    }
};

const parseCsvBuffer = (buffer: Uint8Array): ParsedTable => {
    const text = decodeCsvBuffer(buffer);
    const matrix = parseCsvText(text);

    if (matrix.length === 0) {
        return { headers: [], rows: [] };
    }

    const headers = matrix[0] || [];
    const rows = matrix
        .slice(1)
        .map((values, index) => ({
            sourceRowNumber: index + 2,
            values
        }))
        .filter((row) => !isEmptyRow(row.values));

    return { headers, rows };
};

const parseXlsxBuffer = async (buffer: Uint8Array): Promise<ParsedTable> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer) as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        return { headers: [], rows: [] };
    }

    let headers: unknown[] = [];
    const rows: ParsedDataRow[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const values = (row.values as unknown[]).slice(1);

        if (rowNumber === 1) {
            headers = values;
            return;
        }

        if (isEmptyRow(values)) return;

        rows.push({
            sourceRowNumber: rowNumber,
            values
        });
    });

    return { headers, rows };
};

const toHeaderIndex = (headers: unknown[]): Map<string, number> => {
    const headerIndex = new Map<string, number>();

    headers.forEach((header, index) => {
        const key = normalizeHeader(header);
        if (key && !headerIndex.has(key)) {
            headerIndex.set(key, index);
        }
    });

    return headerIndex;
};

const resolveColumnIndex = (headers: unknown[]): Map<RequiredColumnKey, number> => {
    const headerIndex = toHeaderIndex(headers);

    const resolved = new Map<RequiredColumnKey, number>();

    (Object.keys(REQUIRED_COLUMN_ALIASES) as RequiredColumnKey[]).forEach((columnKey) => {
        const aliases = REQUIRED_COLUMN_ALIASES[columnKey];
        const matched = aliases.find((alias) => headerIndex.has(alias));
        if (matched) {
            resolved.set(columnKey, headerIndex.get(matched)!);
        }
    });

    return resolved;
};

const buildRowsForInsert = (
    parsed: ParsedTable,
    resolvedColumnIndex: Map<RequiredColumnKey, number>
): { rows: InfoDataBulkRow[]; skippedRows: number } => {
    const rows: InfoDataBulkRow[] = [];
    let skippedRows = 0;

    for (const row of parsed.rows) {
        const getByColumn = (column: RequiredColumnKey): unknown => {
            const idx = resolvedColumnIndex.get(column);
            if (idx === undefined) return undefined;
            return row.values[idx];
        };

        const mapped: InfoDataBulkRow = {
            CODE: toNullableText(getByColumn('CODE'), 8),
            FULLNAMETH: toNullableText(getByColumn('FULLNAMETH'), 100),
            FULLNAMEENG: toNullableText(getByColumn('FULLNAMEENG'), 100),
            SEX: toNullableInt(getByColumn('SEX')),
            EmailAddr: toNullableEmail(getByColumn('EmailAddr')),
            POSCODE: toNullableText(getByColumn('POSCODE'), 8),
            POSNAME: toNullableText(getByColumn('POSNAME'), 100),
            UNITCODE: toNullableText(getByColumn('UNITCODE'), 8),
            HIRINGDATE: toNullableDate(getByColumn('HIRINGDATE')),
            ASSIGNDATE: toNullableDate(getByColumn('ASSIGNDATE')),
            RETIREDATE: toNullableDate(getByColumn('RETIREDATE')),
            RETIREYEAR: toNullableInt(getByColumn('RETIREYEAR')),
            BAND: toNullableText(getByColumn('BAND'), 3),
            CHANGE_DATE: toNullableDate(getByColumn('CHANGE_DATE'))
        };

        const hasAnyValue = Object.values(mapped).some((value) => value !== null && value !== '');
        if (!hasAnyValue) {
            skippedRows += 1;
            continue;
        }

        rows.push(mapped);
    }

    return { rows, skippedRows };
};

const getRowBatches = <TRow>(rows: TRow[], batchSize: number): TRow[][] => {
    if (rows.length === 0) return [];

    const batches: TRow[][] = [];
    for (let start = 0; start < rows.length; start += batchSize) {
        batches.push(rows.slice(start, start + batchSize));
    }
    return batches;
};

const insertInfoDataRows = async (rows: InfoDataBulkRow[], replaceExisting: boolean): Promise<void> => {
    const pool = await poolPromise;
    if (replaceExisting) {
        await pool.request().query('DELETE FROM [dbo].[InfoData]');
    }

    const batches = getRowBatches(rows, BULK_BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batchRows = batches[batchIndex];
        if (batchRows.length === 0) continue;

        console.info(`[InterfaceImport][InfoData] Batch ${batchIndex + 1}/${batches.length} (${batchRows.length.toLocaleString()} rows)`);

        const table = new sql.Table('dbo.InfoData');
        table.create = false;

        table.columns.add('CODE', sql.VarChar(8), { nullable: true });
        table.columns.add('FULLNAMETH', sql.NVarChar(100), { nullable: true });
        table.columns.add('FULLNAMEENG', sql.NVarChar(100), { nullable: true });
        table.columns.add('SEX', sql.Int, { nullable: true });
        table.columns.add('EmailAddr', sql.NVarChar(100), { nullable: true });
        table.columns.add('POSCODE', sql.VarChar(8), { nullable: true });
        table.columns.add('POSNAME', sql.NVarChar(100), { nullable: true });
        table.columns.add('UNITCODE', sql.VarChar(8), { nullable: true });
        table.columns.add('HIRINGDATE', sql.Date, { nullable: true });
        table.columns.add('ASSIGNDATE', sql.Date, { nullable: true });
        table.columns.add('RETIREDATE', sql.Date, { nullable: true });
        table.columns.add('RETIREYEAR', sql.Int, { nullable: true });
        table.columns.add('BAND', sql.VarChar(3), { nullable: true });
        table.columns.add('CHANGE_DATE', sql.Date, { nullable: true });

        batchRows.forEach((row) => {
            table.rows.add(
                row.CODE,
                row.FULLNAMETH,
                row.FULLNAMEENG,
                row.SEX,
                row.EmailAddr,
                row.POSCODE,
                row.POSNAME,
                row.UNITCODE,
                row.HIRINGDATE,
                row.ASSIGNDATE,
                row.RETIREDATE,
                row.RETIREYEAR,
                row.BAND,
                row.CHANGE_DATE
            );
        });

        await pool.request().bulk(table);
    }
};

const quoteIdentifier = (identifier: string): string => {
    return `[${identifier.replace(/]/g, ']]')}]`;
};

const normalizeFileBaseName = (fileName: string): string => {
    const rawName = fileName.split(/[\\/]/).pop() || fileName;
    const dotIndex = rawName.lastIndexOf('.');
    const baseName = dotIndex >= 0 ? rawName.slice(0, dotIndex) : rawName;
    return baseName.trim().toUpperCase();
};

const parseRequestedTargetTable = (value: unknown): HrpTargetTable | null => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim().toUpperCase();
    if (text === 'HRP1001' || text === 'HRP1002') return text;
    return null;
};

export const resolveRequestedHrpTargetTable = (value: unknown): HrpTargetTable | null => {
    return parseRequestedTargetTable(value);
};

const resolveHrpTargetTableFromFileName = (
    fileName: string,
    requestedTargetTable: HrpTargetTable | null
): HrpTargetTable => {
    const normalizedFileBase = normalizeFileBaseName(fileName);
    const mappedTable = HRP_FILE_TO_TABLE_MAP[normalizedFileBase as keyof typeof HRP_FILE_TO_TABLE_MAP];

    if (!mappedTable) {
        throw new Error(
            `ชื่อไฟล์ไม่รองรับ: ${fileName}. รองรับเฉพาะ ${ALLOWED_HRP_FILE_NAMES.map((name) => `${name}.csv`).join(', ')}`
        );
    }

    if (requestedTargetTable && mappedTable !== requestedTargetTable) {
        throw new Error(`ไฟล์ ${fileName} ไม่ตรงกับแท็บ ${requestedTargetTable}`);
    }

    return mappedTable;
};

const getDatabaseTableColumns = async (tableName: HrpTargetTable): Promise<HrpTableColumnsMeta> => {
    const pool = await poolPromise;

    const result = await pool.request()
        .input('tableName', sql.NVarChar(128), tableName)
        .query(`
            SELECT TABLE_SCHEMA, COLUMN_NAME, ORDINAL_POSITION
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = @tableName
              AND TABLE_SCHEMA IN (${HRP_TABLE_SCHEMA_CANDIDATES.map((schema) => `'${schema}'`).join(', ')})
            ORDER BY ORDINAL_POSITION
        `);

    type RawSchemaColumnRow = {
        TABLE_SCHEMA?: unknown;
        COLUMN_NAME?: unknown;
        ORDINAL_POSITION?: unknown;
    };

    const rows = result.recordset as RawSchemaColumnRow[];
    const bySchema = new Map<string, Array<{ name: string; ordinal: number }>>();

    rows.forEach((row) => {
        const schema = String(row.TABLE_SCHEMA || '').trim();
        const columnName = String(row.COLUMN_NAME || '').trim();
        const ordinal = Number(row.ORDINAL_POSITION) || 0;
        if (!schema || !columnName) return;

        if (!bySchema.has(schema)) {
            bySchema.set(schema, []);
        }
        bySchema.get(schema)!.push({ name: columnName, ordinal });
    });

    const chosenSchema = HRP_TABLE_SCHEMA_CANDIDATES.find((candidate) => bySchema.has(candidate))
        || Array.from(bySchema.keys())[0];

    if (!chosenSchema) {
        throw new Error(
            `ไม่พบคอลัมน์ของตาราง ${tableName} (schemas ที่ตรวจ: ${HRP_TABLE_SCHEMA_CANDIDATES.join(', ')})`
        );
    }

    const columns = (bySchema.get(chosenSchema) || [])
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((item) => item.name);

    if (columns.length === 0) {
        throw new Error(`ไม่พบคอลัมน์ของตาราง ${chosenSchema}.${tableName}`);
    }

    return { schema: chosenSchema, columns };
};

const resolveDatabaseColumnIndex = (
    headers: unknown[],
    databaseColumns: string[]
): Map<string, number> => {
    const headerIndex = toHeaderIndex(headers);
    const resolved = new Map<string, number>();

    databaseColumns.forEach((columnName) => {
        const normalizedColumn = normalizeHeader(columnName);
        const matchedIndex = headerIndex.get(normalizedColumn);
        if (matchedIndex !== undefined) {
            resolved.set(columnName, matchedIndex);
        }
    });

    return resolved;
};

const buildHrpRowsForInsert = (
    parsed: ParsedTable,
    targetColumns: string[],
    resolvedColumnIndex: Map<string, number>
): { rows: Array<Array<string | null>>; skippedRows: number } => {
    const rows: Array<Array<string | null>> = [];
    let skippedRows = 0;

    for (const row of parsed.rows) {
        const mappedRow = targetColumns.map((columnName) => {
            const idx = resolvedColumnIndex.get(columnName);
            if (idx === undefined) return null;
            return toNullableUnlimitedText(row.values[idx]);
        });

        const hasAnyValue = mappedRow.some((value) => value !== null && value !== '');
        if (!hasAnyValue) {
            skippedRows += 1;
            continue;
        }

        rows.push(mappedRow);
    }

    return { rows, skippedRows };
};

const insertHrpRows = async (
    schema: string,
    tableName: HrpTargetTable,
    columns: string[],
    rows: Array<Array<string | null>>,
    replaceExisting: boolean
): Promise<void> => {
    const pool = await poolPromise;
    if (replaceExisting) {
        await pool.request().query(
            `DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`
        );
    }

    const batches = getRowBatches(rows, BULK_BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batchRows = batches[batchIndex];
        if (batchRows.length === 0) continue;

        console.info(`[InterfaceImport][${tableName}] Batch ${batchIndex + 1}/${batches.length} (${batchRows.length.toLocaleString()} rows)`);

        const table = new sql.Table(`${schema}.${tableName}`);
        table.create = false;

        columns.forEach((columnName) => {
            table.columns.add(columnName, sql.NVarChar(sql.MAX), { nullable: true });
        });

        batchRows.forEach((row) => {
            table.rows.add(...row);
        });

        await pool.request().bulk(table);
    }
};

const parseFileToTable = async (buffer: Uint8Array, fileName: string): Promise<ParsedTable> => {
    const extension = fileName.toLowerCase().split('.').pop() || '';

    if (extension === 'csv' || extension === 'txt') {
        return parseCsvBuffer(buffer);
    }

    if (extension === 'xlsx' || extension === 'xlsm' || extension === 'xltx') {
        return parseXlsxBuffer(buffer);
    }

    throw new Error('รองรับเฉพาะไฟล์ .csv และ .xlsx เท่านั้น');
};

export const importInfoDataFromFile = async (
    fileBuffer: ArrayBuffer,
    fileName: string,
    replaceExisting: boolean
): Promise<InfoDataImportSummary> => {
    const parsed = await parseFileToTable(new Uint8Array(fileBuffer), fileName);

    if (!parsed.headers.length) {
        throw new Error('ไม่พบ header ในไฟล์ที่อัปโหลด');
    }

    if (parsed.rows.length > MAX_UPLOAD_ROWS) {
        throw new Error(`จำนวนแถวเกินกำหนดสูงสุด (${MAX_UPLOAD_ROWS.toLocaleString()})`);
    }

    const resolvedColumnIndex = resolveColumnIndex(parsed.headers);
    const missingColumns = (Object.keys(REQUIRED_COLUMN_ALIASES) as RequiredColumnKey[])
        .filter((column) => !resolvedColumnIndex.has(column));

    if (missingColumns.length > 0) {
        throw new Error(`ไม่พบคอลัมน์ที่จำเป็น: ${missingColumns.join(', ')}`);
    }

    const { rows, skippedRows } = buildRowsForInsert(parsed, resolvedColumnIndex);
    if (rows.length === 0) {
        throw new Error('ไม่พบข้อมูลสำหรับนำเข้า กรุณาตรวจสอบไฟล์ที่อัปโหลด');
    }

    await insertInfoDataRows(rows, replaceExisting);

    return {
        parsedRows: parsed.rows.length,
        insertedRows: rows.length,
        skippedRows,
        replaceExisting
    };
};

export const importHrpDataFromFile = async (
    fileBuffer: ArrayBuffer,
    fileName: string,
    replaceExisting: boolean,
    requestedTargetTable: HrpTargetTable | null = null
): Promise<HrpDataImportSummary> => {
    const parsed = await parseFileToTable(new Uint8Array(fileBuffer), fileName);
    const targetTable = resolveHrpTargetTableFromFileName(fileName, requestedTargetTable);

    if (!parsed.headers.length) {
        throw new Error('ไม่พบ header ในไฟล์ที่อัปโหลด');
    }

    if (parsed.rows.length > MAX_UPLOAD_ROWS) {
        throw new Error(`จำนวนแถวเกินกำหนดสูงสุด (${MAX_UPLOAD_ROWS.toLocaleString()})`);
    }

    const tableMeta = await getDatabaseTableColumns(targetTable);
    const resolvedColumnIndex = resolveDatabaseColumnIndex(parsed.headers, tableMeta.columns);
    const missingColumns = tableMeta.columns.filter((columnName) => !resolvedColumnIndex.has(columnName));

    if (missingColumns.length > 0) {
        throw new Error(`ไม่พบคอลัมน์ที่จำเป็นในไฟล์: ${missingColumns.join(', ')}`);
    }

    const { rows, skippedRows } = buildHrpRowsForInsert(parsed, tableMeta.columns, resolvedColumnIndex);
    if (rows.length === 0) {
        throw new Error('ไม่พบข้อมูลสำหรับนำเข้า กรุณาตรวจสอบไฟล์ที่อัปโหลด');
    }

    await insertHrpRows(tableMeta.schema, targetTable, tableMeta.columns, rows, replaceExisting);

    return {
        parsedRows: parsed.rows.length,
        insertedRows: rows.length,
        skippedRows,
        replaceExisting,
        targetTable,
        sourceFile: fileName
    };
};
