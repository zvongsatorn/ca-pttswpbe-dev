import { sql, poolPromise } from '../config/db.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OUTBOUND_DIR_NAME = 'Outbound';
const OUTBOUND_FILE_NAME = 'Input_ZHROMI040.txt';
const GO_LIVE_DATE = new Date(Date.UTC(2020, 1, 1, 0, 0, 0, 0)); // 01/02/2020

type DbRow = Record<string, unknown>;

export interface HRCenterSendToSapParams {
    effectiveDate: Date;
    employeeId: string;
    orgUnits: string[];
}

export interface HRCenterSendToSapResult {
    resultCode: string; // -1,0,1,2
    fileReady: boolean;
    ftpEnabled: boolean;
    ftpSent: boolean;
    downloadPath: string;
    message: string;
}

const toInt = (value: unknown): number => {
    if (value === null || value === undefined || value === '') return 0;
    const num = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(num) ? num : 0;
};

const toText = (value: unknown): string => String(value ?? '').trim();

const normalizeOrgUnitNo = (value: unknown): string => toText(value).toUpperCase();

const getFirstAvailableValue = (row: DbRow, fieldNames: string[]): unknown => {
    for (const fieldName of fieldNames) {
        if (row[fieldName] !== undefined) return row[fieldName];
    }
    return undefined;
};

const getFieldInt = (row: DbRow, fieldNames: string[]): number => toInt(getFirstAvailableValue(row, fieldNames));
const getFieldText = (row: DbRow, fieldNames: string[]): string => toText(getFirstAvailableValue(row, fieldNames));
const toTimestamp = (value: unknown): number => {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = value instanceof Date ? value : new Date(String(value));
    const ts = parsed.getTime();
    return Number.isFinite(ts) ? ts : 0;
};

const firstDayOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
const endDayOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth() + 1, 0, 0, 0, 0, 0);
const toSqlDateOnly = (date: Date): Date => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0));

const formatSapDate = (date: Date): string => {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `${dd}.${mm}.${yyyy}`;
};

const formatThaiDateSlash = (date: Date): string => {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
};

const isConfigTrue = (value: string): boolean => {
    const v = toText(value).toLowerCase();
    return v === 'true' || v === '1' || v === 'y' || v === 'yes';
};

const getOutboundDir = (): string => path.join(process.cwd(), OUTBOUND_DIR_NAME);
export const getHRCenterSapOutboundFilePath = (): string => path.join(getOutboundDir(), OUTBOUND_FILE_NAME);

const ensureOutboundDirectory = async (): Promise<void> => {
    const dir = getOutboundDir();
    if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
    }
};

const createOrgUnitTable = (orgUnits: string[]): sql.Table => {
    const table = new sql.Table();
    table.columns.add('ORGUNITNO', sql.VarChar(8));
    orgUnits.forEach((orgUnit) => {
        table.rows.add(orgUnit);
    });
    return table;
};

const getConfigValue = async (keyName: string): Promise<string> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('KeyName', sql.NVarChar(200), keyName);
    const result = await request.execute('MP_ConfigGetByKeyName');
    const row = (result.recordset || [])[0] as DbRow | undefined;
    return row ? getFieldText(row, ['Value1']) : '';
};

const maxVersionQuotaExport = async (orgUnitNo: string, effectiveDate: Date): Promise<number> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('p_OrgUnitNo', sql.VarChar(8), orgUnitNo);
    request.input('p_CheckDate', sql.Date, toSqlDateOnly(effectiveDate));
    const result = await request.execute('mp_QuotaExMaxVersion');
    const row = (result.recordset || [])[0] as DbRow | undefined;
    return row ? getFieldInt(row, ['MaxVersion']) : 0;
};

const runPastTransactionOrgQuery = async (effectiveDate: Date, orgUnits: string[]): Promise<DbRow[]> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));

    if (orgUnits.length > 0) {
        request.input('DataTable', createOrgUnitTable(orgUnits));
        const result = await request.execute('mp_PastTransactionGetOrgSelect');
        return (result.recordset || []) as DbRow[];
    }

    const result = await request.execute('mp_PastTransactionGetOrgUnit');
    return (result.recordset || []) as DbRow[];
};

const deleteQuotaByOrgUnit = async (effectiveDate: Date, orgUnitNo: string): Promise<void> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
    request.input('OrgUnitNo', sql.VarChar(8), orgUnitNo);
    await request.execute('mp_QuotaDeleteByEffectiveDateAndOrgUnit');
};

const genQuotaByOrgUnitAll = async (effectiveDate: Date, orgUnitNo: string): Promise<void> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
    request.input('OrgUnitNo', sql.VarChar(8), orgUnitNo);
    const result = await request.execute('mp_HRCenter_SendSAPByOrgUnitAll');
    const rows = (result.recordset || []) as DbRow[];

    for (const row of rows) {
        const poolRsFlag = getFieldInt(row, ['PoolRsFlag']);
        const orgType = poolRsFlag === 2 ? 2 : 1;
        const orgFlag = 1;

        const insertReq = new sql.Request(pool);
        insertReq.input('OrgUnitNo', sql.VarChar(8), getFieldText(row, ['OrgUnitNo']));
        insertReq.input('Month', sql.Int, effectiveDate.getMonth() + 1);
        insertReq.input('Year', sql.Int, effectiveDate.getFullYear());
        insertReq.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
        insertReq.input('L9901', sql.Int, getFieldInt(row, ['Level4_8']));
        insertReq.input('L9902', sql.Int, getFieldInt(row, ['Level9_10']));
        insertReq.input('L9903', sql.Int, getFieldInt(row, ['Level11_13']));
        insertReq.input('L9904', sql.Int, getFieldInt(row, ['Level14_15']));
        insertReq.input('L9905', sql.Int, getFieldInt(row, ['Level16_17']));
        insertReq.input('L9906', sql.Int, getFieldInt(row, ['Level18_19']));
        insertReq.input('L9907', sql.Int, getFieldInt(row, ['Level20']));
        insertReq.input('L9908', sql.Int, getFieldInt(row, ['LevelContract']));
        insertReq.input('L9910', sql.Int, getFieldInt(row, ['LevelContractSub']));
        insertReq.input('L9909', sql.NVarChar(500), getFieldText(row, ['note', 'Remark']));
        insertReq.input('OrgType', sql.Int, orgType);
        insertReq.input('OrgFlag', sql.Int, orgFlag);
        insertReq.input('PoolRsFlag', sql.Int, poolRsFlag);
        insertReq.input('StrgFlag', sql.Int, getFieldInt(row, ['StrgFlag']));
        insertReq.input('BSType', sql.Int, getFieldInt(row, ['BSType']));
        insertReq.input('SpecFlag', sql.Int, getFieldInt(row, ['SpecFlag']));
        insertReq.input('CreateBy', sql.VarChar(20), 'System');
        insertReq.input('CreateDate', sql.DateTime, new Date());
        insertReq.input('UpdateBy', sql.VarChar(20), 'System');
        insertReq.input('UpdateDate', sql.DateTime, new Date());
        await insertReq.execute('mp_QuotaNImportAll');
    }
};

const processPastTransactionChanges = async (effectiveDate: Date, employeeId: string, orgUnits: string[]): Promise<void> => {
    const rows = await runPastTransactionOrgQuery(effectiveDate, orgUnits);
    if (rows.length === 0) return;

    for (const row of rows) {
        const orgUnitNo = getFieldText(row, ['OrgUnitNo']);
        const changeMonth = getFieldInt(row, ['FirstChangeEffectiveMonth']);
        const changeYear = getFieldInt(row, ['FirstChangeEffectiveYear']);
        if (!orgUnitNo || changeMonth < 1 || changeMonth > 12 || changeYear <= 0) continue;

        let changeEffectiveDate = new Date(changeYear, changeMonth - 1, 1, 0, 0, 0, 0);
        while (changeEffectiveDate < effectiveDate) {
            if (changeEffectiveDate > GO_LIVE_DATE) {
                await deleteQuotaByOrgUnit(changeEffectiveDate, orgUnitNo);
                await genQuotaByOrgUnitAll(changeEffectiveDate, orgUnitNo);
                await genQuotaExportByOrgUnit(changeEffectiveDate, orgUnitNo, employeeId);
            }
            changeEffectiveDate = new Date(changeEffectiveDate.getFullYear(), changeEffectiveDate.getMonth() + 1, 1, 0, 0, 0, 0);
        }
    }
};

const insertQuotaExportRows = async (rows: DbRow[], effectiveDate: Date, employeeId: string): Promise<string> => {
    const pool = await poolPromise;
    let countWrongOrgUnit = 0;

    for (const row of rows) {
        const orgUnitNo = getFieldText(row, ['OrgUnitNo']);
        if (!orgUnitNo) continue;

        const level20 = getFieldInt(row, ['Level20']);
        const level18_19 = getFieldInt(row, ['Level18_19']);
        const level16_17 = getFieldInt(row, ['Level16_17']);
        const level14_15 = getFieldInt(row, ['Level14_15']);
        const level11_13 = getFieldInt(row, ['Level11_13']);
        const level9_10 = getFieldInt(row, ['Level9_10']);
        const level4_8 = getFieldInt(row, ['Level4_8']);
        const levelContract = getFieldInt(row, ['LevelContract']);
        const levelContractSub = getFieldInt(row, ['LevelContractSub']);
        const remark = getFieldText(row, ['note', 'Remark']);

        const versionQuota = (await maxVersionQuotaExport(orgUnitNo, effectiveDate)) + 1;
        const beginDate = firstDayOfMonth(effectiveDate);
        const endDate = endDayOfMonth(effectiveDate);

        const req = new sql.Request(pool);
        req.input('OrgUnitNo', sql.VarChar(8), orgUnitNo);
        req.input('BeginDate', sql.Date, toSqlDateOnly(beginDate));
        req.input('EndDate', sql.Date, toSqlDateOnly(endDate));
        req.input('Version', sql.Int, versionQuota);
        req.input('Level20Amount', sql.Int, level20);
        req.input('Level18_19Amount', sql.Int, level18_19);
        req.input('Level16_17Amount', sql.Int, level16_17);
        req.input('Level14_15Amount', sql.Int, level14_15);
        req.input('Level11_13Amount', sql.Int, level11_13);
        req.input('Level9_10Amount', sql.Int, level9_10);
        req.input('Level4_8Amount', sql.Int, level4_8);
        req.input('LevelContractAmount', sql.Int, levelContract);
        req.input('LevelContractSubAmount', sql.Int, levelContractSub);
        req.input('Remark', sql.NVarChar(500), remark);
        req.input('CreateBy', sql.VarChar(20), employeeId);
        req.input('CreateDate', sql.DateTime, new Date());
        await req.execute('mp_QuotaExInsert');

        if (
            level20 < 0 ||
            level18_19 < 0 ||
            level16_17 < 0 ||
            level14_15 < 0 ||
            level11_13 < 0 ||
            level9_10 < 0 ||
            level4_8 < 0 ||
            levelContract < 0 ||
            levelContractSub < 0
        ) {
            countWrongOrgUnit += 1;
        }
    }

    return countWrongOrgUnit > 0 ? '-1' : '1';
};

const genQuotaExport = async (effectiveDate: Date, employeeId: string, orgUnits: string[]): Promise<string> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));

    let rows: DbRow[] = [];
    if (orgUnits.length > 0) {
        request.input('DataTable', createOrgUnitTable(orgUnits));
        const result = await request.execute('mp_HRCenter_SendSAPSelect');
        rows = (result.recordset || []) as DbRow[];
    } else {
        const result = await request.execute('mp_HRCenter_SendSAP');
        rows = (result.recordset || []) as DbRow[];
    }

    return insertQuotaExportRows(rows, effectiveDate, employeeId);
};

const genQuotaExportByOrgUnit = async (effectiveDate: Date, orgUnitNo: string, employeeId: string): Promise<string> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
    request.input('OrgUnitNo', sql.VarChar(8), orgUnitNo);
    const result = await request.execute('mp_HRCenter_SendSAPByOrgUnit');
    const rows = (result.recordset || []) as DbRow[];
    return insertQuotaExportRows(rows, effectiveDate, employeeId);
};

const pickLatestQuotaRowsByOrgUnit = (rows: DbRow[]): DbRow[] => {
    const latestByOrgUnit = new Map<string, { row: DbRow; version: number; timestamp: number; index: number }>();

    rows.forEach((row, index) => {
        const orgUnitNo = getFieldText(row, ['OrgUnitNo']);
        if (!orgUnitNo) return;

        const version = getFieldInt(row, ['Version']);
        const timestamp = Math.max(
            toTimestamp(getFirstAvailableValue(row, ['CreateDate'])),
            toTimestamp(getFirstAvailableValue(row, ['UpdateDate'])),
            toTimestamp(getFirstAvailableValue(row, ['BeginDate']))
        );

        const current = latestByOrgUnit.get(orgUnitNo);
        if (!current) {
            latestByOrgUnit.set(orgUnitNo, { row, version, timestamp, index });
            return;
        }

        const shouldReplace =
            version > current.version ||
            (version === current.version && timestamp > current.timestamp) ||
            (version === current.version && timestamp === current.timestamp && index > current.index);

        if (shouldReplace) {
            latestByOrgUnit.set(orgUnitNo, { row, version, timestamp, index });
        }
    });

    return Array.from(latestByOrgUnit.values())
        .sort((a, b) => a.index - b.index)
        .map((item) => item.row);
};

const exportText = async (effectiveDate: Date, orgUnits: string[]): Promise<string> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('p_CheckDate', sql.Date, toSqlDateOnly(effectiveDate));

    let rows: DbRow[] = [];
    if (orgUnits.length > 0) {
        request.input('DataTable', createOrgUnitTable(orgUnits));
        const result = await request.execute('mp_QuotaExportDuringCreateDateByOrg');
        rows = (result.recordset || []) as DbRow[];
    } else {
        const result = await request.execute('mp_QuotaExportDuringCreateDate');
        rows = (result.recordset || []) as DbRow[];
    }

    const latestRows = pickLatestQuotaRowsByOrgUnit(rows);
    const selectedOrgSet = orgUnits.length > 0
        ? new Set(orgUnits.map(normalizeOrgUnitNo).filter(Boolean))
        : null;
    const exportRows = selectedOrgSet
        ? latestRows.filter((row) => selectedOrgSet.has(normalizeOrgUnitNo(getFieldText(row, ['OrgUnitNo']))))
        : latestRows;

    const lines: string[] = [];
    for (const row of exportRows) {
        const orgUnitNo = getFieldText(row, ['OrgUnitNo']);
        if (!orgUnitNo) continue;

        const beginDateRaw = getFirstAvailableValue(row, ['BeginDate']);
        const beginDate = beginDateRaw ? new Date(String(beginDateRaw)) : firstDayOfMonth(effectiveDate);
        const beginDateText = formatSapDate(beginDate);
        const endDateText = '31.12.9999';

        const fields = [
            orgUnitNo,
            beginDateText,
            endDateText,
            String(getFieldInt(row, ['Level20'])),
            String(getFieldInt(row, ['Level18_19'])),
            String(getFieldInt(row, ['Level16_17'])),
            String(getFieldInt(row, ['Level14_15'])),
            String(getFieldInt(row, ['Level11_13'])),
            String(getFieldInt(row, ['Level9_10'])),
            String(getFieldInt(row, ['Level4_8'])),
            String(getFieldInt(row, ['LevelContract'])),
            String(getFieldInt(row, ['LevelContractSub'])),
            getFieldText(row, ['Remark', 'note']).replace(/\r?\n/g, '#')
        ];

        lines.push(fields.join('\t'));
    }

    return lines.join('\r\n');
};

const sendSapStatusAll = async (effectiveDate: Date, sendBy: string): Promise<void> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
    request.input('SendBy', sql.VarChar(20), sendBy);
    await request.execute('mp_HRCenter_SendSAPStatusAll');
};

const sendSapStatusByOrg = async (effectiveDate: Date, sendBy: string, orgUnits: string[]): Promise<void> => {
    if (orgUnits.length === 0) return;
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('DataTable', createOrgUnitTable(orgUnits));
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
    request.input('SendBy', sql.VarChar(20), sendBy);
    await request.execute('mp_HRCenter_SendSAPStatusByOrg');
};

const uploadFileToFtp = async (localFilePath: string): Promise<void> => {
    const username = await getConfigValue('SendToSAP_username');
    const password = await getConfigValue('SendToSAP_password');
    const hostip = await getConfigValue('SendToSAP_hostip');
    const port = toText(await getConfigValue('SendToSAP_port'));
    const remotefile = await getConfigValue('SendToSAP_remotefile');

    if (!username || !password || !hostip || !remotefile) {
        throw new Error('Missing FTP configuration.');
    }

    const host = hostip.replace(/^ftp:\/\//i, '').replace(/\/+$/, '');
    const remotePath = remotefile.startsWith('/') ? remotefile : `/${remotefile}`;
    const ftpUrl = `ftp://${host}${port ? `:${port}` : ''}${remotePath}`;

    const args = [
        '--fail',
        '--silent',
        '--show-error',
        '--ftp-create-dirs',
        '--max-time',
        '120',
        '--user',
        `${username}:${password}`,
        '--upload-file',
        localFilePath,
        ftpUrl
    ];

    await execFileAsync('curl', args);
};

export const sendHRCenterToSapService = async (params: HRCenterSendToSapParams): Promise<HRCenterSendToSapResult> => {
    const effectiveDate = firstDayOfMonth(params.effectiveDate);
    const employeeId = toText(params.employeeId) || 'SYSTEM';
    const orgUnits = Array.from(new Set((params.orgUnits || []).map(normalizeOrgUnitNo).filter(Boolean)));
    const sendType = orgUnits.length > 0 ? 1 : 0;

    const sendSapFtpConfig = await getConfigValue('SendSapFTP');
    const ftpEnabled = isConfigTrue(sendSapFtpConfig);

    let resultCode = '1';
    let message = '';
    let fileReady = false;
    let ftpSent = false;

    await processPastTransactionChanges(effectiveDate, employeeId, orgUnits);

    resultCode = await genQuotaExport(effectiveDate, employeeId, orgUnits);

    if (resultCode !== '-1') {
        const textfile = await exportText(effectiveDate, orgUnits);

        if (sendType === 0) {
            await sendSapStatusAll(effectiveDate, employeeId);
        } else {
            await sendSapStatusByOrg(effectiveDate, employeeId, orgUnits);
        }

        try {
            await ensureOutboundDirectory();
            const outboundFilePath = getHRCenterSapOutboundFilePath();
            await fs.promises.writeFile(outboundFilePath, textfile, { encoding: 'utf8' });
            fileReady = true;
        } catch (error) {
            resultCode = '0';
            message = 'เขียนไฟล์ที่จะนำส่งระบบ SAP ไม่สำเร็จ โปรดติดต่อ Admin';
        }

        if (resultCode !== '0' && ftpEnabled) {
            try {
                await uploadFileToFtp(getHRCenterSapOutboundFilePath());
                ftpSent = true;
            } catch (error) {
                resultCode = '2';
                message = 'ส่งไฟล์ FTP ไม่สำเร็จ แต่สามารถดาวน์โหลดไฟล์ได้';
            }
        }
    } else if (sendType === 1) {
        await sendSapStatusByOrg(effectiveDate, employeeId, orgUnits);
    }

    if (!message) {
        if (resultCode === '1') {
            message = ftpEnabled
                ? 'นำส่งเข้าบันทึกที่ระบบ SAP เสร็จสิ้น'
                : 'สร้างไฟล์สำเร็จ (ไม่ส่ง FTP ตามค่า SendSapFTP)';
        } else if (resultCode === '-1') {
            message = 'มีหน่วยงานที่ค่ากรอบติดลบ โปรดตรวจสอบก่อนนำส่งเข้าบันทึกที่ระบบ SAP';
        } else if (resultCode === '0') {
            message = 'เขียนไฟล์ที่จะนำส่งระบบ SAP ไม่สำเร็จ โปรดติดต่อ Admin';
        }
    }

    return {
        resultCode,
        fileReady,
        ftpEnabled,
        ftpSent,
        downloadPath: '/api/transactions/hrcenter/sap-file',
        message
    };
};

export const getHRCenterSapMinusService = async (effectiveDate: Date): Promise<DbRow[]> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(firstDayOfMonth(effectiveDate)));
    const result = await request.execute('mp_QuotaExCheckMinus');
    return (result.recordset || []) as DbRow[];
};

export const getHRCenterSapOutboundFileBufferService = async (): Promise<{ fileName: string; content: Buffer }> => {
    const filePath = getHRCenterSapOutboundFilePath();
    const content = await fs.promises.readFile(filePath);
    return {
        fileName: OUTBOUND_FILE_NAME,
        content
    };
};

export const getHRCenterSapOutboundFileMetaService = async (): Promise<{ fileName: string; filePath: string; exists: boolean; modifiedAt?: string }> => {
    const filePath = getHRCenterSapOutboundFilePath();
    try {
        const stat = await fs.promises.stat(filePath);
        return {
            fileName: OUTBOUND_FILE_NAME,
            filePath,
            exists: stat.isFile(),
            modifiedAt: formatThaiDateSlash(stat.mtime)
        };
    } catch {
        return {
            fileName: OUTBOUND_FILE_NAME,
            filePath,
            exists: false
        };
    }
};
