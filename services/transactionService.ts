import { sql, poolPromise } from '../config/db.js';
import { resetSentSapStatusForTransactions } from './sapSendStatusService.js';

export interface DraftTransactionPayload {
    transactionType: number;
    effectiveMonth: string;
    effectiveYear: string;
    poolRsFlag: number;
    strgFlag: number;
    bsType: number;
    specFlag: number;
    unitReceive: string;
    remark: string;
    lineStaffFlag: number;
    policyFlag: number;
    pastFlag: number;

    // detail
    levelGroupTo: string;
    levelGroupFrom: string;
    amount: number;
    conclusionNo: string;
    conclusionDate: string;
    unitTransfer: string;
    transferInd: number;
    refTransactionNo?: string | null;
    
    
    // files
    fileName?: string;
    fileUrl?: string; // from upload
    refId?: string | number | null; // TransactionFileID for existing files

    // names for description
    unitReceiveName?: string;
    unitTransferName?: string;
    levelGroupFromName?: string;
    levelGroupToName?: string;
}

const toSqlDateOnly = (value: Date | string): Date => {
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
        const now = new Date();
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0));
    }
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0));
};

// Helper: look up a unit's display name via mp_UnitNameGet
const getUnitName = async (pool: typeof sql.ConnectionPool.prototype, effectiveDate: Date, unitNo: string): Promise<string> => {
    if (!unitNo) return '';
    try {
        const req = new sql.Request(pool);
        req.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
        req.input('UnitNo', sql.VarChar(8), unitNo);
        const res = await req.execute('mp_UnitNameGet');
        if (res.recordset && res.recordset.length > 0) {
            return res.recordset[0].UnitName || res.recordset[0].UnitShortName || unitNo;
        }
    } catch {
        // fallback to unit code
    }
    return unitNo;
};

interface RemarkInsertParams {
    transactionNo: string;
    orgUnitNo: string;
    note: string;
    status: number;
    createBy: string;
    createDate: Date;
}

interface UnitSnapshot {
    orgUnitNo: string;
    unitName: string;
    unitAbbr: string;
    parentOrgUnitNo: string;
    bgNo: string;
}

interface StructureChangeRemark {
    unitNo: string;
    unitName: string;
    remark: string;
}

export interface CreateApprovedStructureRemarkParams {
    effectiveDate: Date;
    createBy: string;
}

export interface CreateApprovedStructureRemarkResult {
    success: boolean;
    effectiveDate: string;
    previousEffectiveDate: string;
    totalDetected: number;
    insertedCount: number;
    skippedCount: number;
    changes: Array<{
        unitNo: string;
        unitName: string;
        remark: string;
        action: 'INSERTED' | 'SKIPPED_EXISTING';
    }>;
}

const toMonthStart = (date: Date): Date => {
    return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
};

const toIsoDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const normalizeText = (value: unknown): string => {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
};

const toFiniteNumber = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toTimestamp = (value: unknown): number => {
    const parsed = new Date(String(value ?? '')).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeComparable = (value: unknown): string => normalizeText(value).toLowerCase();

const truncateText = (value: string, maxLength: number): string => {
    if (!value) return '';
    return value.length > maxLength ? value.substring(0, maxLength) : value;
};

const storedProcedureParameterSupportCache = new Map<string, boolean>();

const supportsStoredProcedureParameter = async (
    pool: typeof sql.ConnectionPool.prototype,
    procedureName: string,
    parameterName: string
): Promise<boolean> => {
    const normalizedParam = parameterName.startsWith('@') ? parameterName : `@${parameterName}`;
    const cacheKey = `${procedureName.toLowerCase()}:${normalizedParam.toLowerCase()}`;
    const cached = storedProcedureParameterSupportCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
        const request = new sql.Request(pool);
        request.input('SpecificName', sql.NVarChar(128), procedureName);
        request.input('ParameterName', sql.NVarChar(128), normalizedParam);
        const result = await request.query(`
            SELECT TOP 1 1 AS ExistsFlag
            FROM INFORMATION_SCHEMA.PARAMETERS
            WHERE SPECIFIC_SCHEMA = 'dbo'
              AND SPECIFIC_NAME = @SpecificName
              AND PARAMETER_NAME = @ParameterName
        `);
        const supported = (result.recordset || []).length > 0;
        storedProcedureParameterSupportCache.set(cacheKey, supported);
        return supported;
    } catch (error) {
        console.warn(`[transactionService] Failed to inspect parameter support for ${procedureName}.${normalizedParam}:`, error);
        storedProcedureParameterSupportCache.set(cacheKey, false);
        return false;
    }
};

const buildRemarkInsertRequest = (
    transaction: sql.Transaction,
    payload: RemarkInsertParams,
    includeRemarkFlag: boolean
) => {
    const request = new sql.Request(transaction);
    request.input('TransactionNo', sql.VarChar(10), payload.transactionNo);
    request.input('OrgUnitNo', sql.VarChar(8), payload.orgUnitNo || '');
    if (includeRemarkFlag) {
        request.input('RemarkFlag', sql.Int, 1);
    }
    request.input('Note', sql.NVarChar(500), truncateText(payload.note, 500));
    request.input('Status', sql.Int, payload.status);
    request.input('CreateBy', sql.VarChar(20), payload.createBy.substring(0, 20));
    request.input('CreateDate', sql.DateTime, payload.createDate);
    return request;
};

const executeRemarkInsert = async (
    transaction: sql.Transaction,
    payload: RemarkInsertParams,
    includeRemarkFlag: boolean
) => {
    await buildRemarkInsertRequest(transaction, payload, includeRemarkFlag).execute('mp_RemarkInsert');
};

const generateTransactionNo = async (
    transaction: sql.Transaction,
    effectiveDate: Date
): Promise<string> => {
    const year = effectiveDate.getFullYear();
    const month = effectiveDate.getMonth() + 1;
    const adYY = String(year).slice(-2);
    const mm = String(month).padStart(2, '0');
    const prefix = `TR${adYY}${mm}`;

    const lastTrRes = await new sql.Request(transaction)
        .input('Prefix', sql.VarChar(10), prefix)
        .execute('mp_TransactionsLastNoGet');

    let runningNumber = 1;
    if (lastTrRes.recordset && lastTrRes.recordset.length > 0 && lastTrRes.recordset[0].TransactionNo) {
        const lastTrNo = String(lastTrRes.recordset[0].TransactionNo);
        const lastRunningStr = lastTrNo.substring(prefix.length);
        const parsed = Number.parseInt(lastRunningStr, 10);
        if (Number.isFinite(parsed)) {
            runningNumber = parsed + 1;
        }
    }

    return `${prefix}${String(runningNumber).padStart(4, '0')}`;
};

const generateDocumentNo = async (
    transaction: sql.Transaction,
    baseDate: Date
): Promise<string> => {
    const adYY = String(baseDate.getFullYear()).slice(-2);
    const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
    const prefix = `DA${adYY}${mm}`;

    const lastDocReq = new sql.Request(transaction);
    lastDocReq.input('Prefix', sql.VarChar(10), prefix);
    const lastDocRes = await lastDocReq.execute('mp_DocumentLastNoGet');

    let runningNumber = 1;
    if (lastDocRes.recordset && lastDocRes.recordset.length > 0 && lastDocRes.recordset[0].DocumentNo) {
        const lastDocNo = String(lastDocRes.recordset[0].DocumentNo);
        const lastRunningStr = lastDocNo.substring(prefix.length);
        const parsed = Number.parseInt(lastRunningStr, 10);
        if (Number.isFinite(parsed)) {
            runningNumber = parsed + 1;
        }
    }

    return `${prefix}${String(runningNumber).padStart(4, '0')}`;
};

const getUnitSnapshotByEffectiveDate = async (
    pool: typeof sql.ConnectionPool.prototype,
    effectiveDate: Date
): Promise<UnitSnapshot[]> => {
    const request = new sql.Request(pool);
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
    const result = await request.execute('mp_UnitGetByEffectiveDate');

    return (result.recordset || []).map((row: any) => ({
        orgUnitNo: normalizeText(row?.OrgUnitNo),
        unitName: normalizeText(row?.UnitName),
        unitAbbr: normalizeText(row?.UnitAbbr),
        parentOrgUnitNo: normalizeText(row?.ParentOrgUnitNo),
        bgNo: normalizeText(row?.BGNo),
    }));
};

const getBgNameMapByEffectiveDate = async (
    pool: typeof sql.ConnectionPool.prototype,
    effectiveDate: Date
): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    try {
        const request = new sql.Request(pool);
        request.input('p_CheckDate', sql.DateTime, effectiveDate);
        const result = await request.execute('mp_BGGetByEffectivePeriod');
        (result.recordset || []).forEach((row: any) => {
            const bgNo = normalizeText(row?.BGNo);
            const bgName = normalizeText(row?.BGName);
            if (bgNo) {
                map.set(bgNo, bgName || bgNo);
            }
        });
    } catch (error) {
        console.warn('[transactionService] Failed to resolve BG names by effective date:', error);
    }
    return map;
};

const getUnitDisplayLabel = (unit: UnitSnapshot | undefined): string => {
    if (!unit) return '';
    const abbr = normalizeText(unit.unitAbbr);
    const name = normalizeText(unit.unitName);
    if (abbr && name && abbr !== name) return `${abbr} (${name})`;
    return abbr || name || unit.orgUnitNo || '';
};

const getParentLabel = (
    parentNo: string,
    currentMap: Map<string, UnitSnapshot>,
    previousMap: Map<string, UnitSnapshot>
): string => {
    const normalized = normalizeText(parentNo);
    if (!normalized) return '-';
    const currentLabel = getUnitDisplayLabel(currentMap.get(normalized));
    if (currentLabel) return currentLabel;
    const previousLabel = getUnitDisplayLabel(previousMap.get(normalized));
    if (previousLabel) return previousLabel;
    return normalized;
};

const buildParentChangeMessage = (
    current: UnitSnapshot,
    previous: UnitSnapshot,
    currentLabel: string,
    currentMap: Map<string, UnitSnapshot>,
    previousMap: Map<string, UnitSnapshot>
): string => {
    const oldParent = getParentLabel(previous.parentOrgUnitNo, currentMap, previousMap);
    const newParent = getParentLabel(current.parentOrgUnitNo, currentMap, previousMap);
    return 'ปรับโครงสร้าง: ' + currentLabel + ' ย้ายสังกัดจาก ' + oldParent + ' ไป ' + newParent;
};

const buildBgChangeMessage = (current: UnitSnapshot, previous: UnitSnapshot, currentLabel: string): string => {
    const oldBg = normalizeText(previous.bgNo) || '-';
    const newBg = normalizeText(current.bgNo) || '-';
    return 'ปรับโครงสร้าง: ' + currentLabel + ' ย้าย BU จาก ' + oldBg + ' ไป ' + newBg;
};

const buildNameChangeMessage = (
    current: UnitSnapshot,
    previous: UnitSnapshot,
    nameChanged: boolean,
    abbrChanged: boolean
): string => {
    const oldName = normalizeText(previous.unitName) || previous.orgUnitNo;
    const newName = normalizeText(current.unitName) || current.orgUnitNo;
    const oldAbbr = normalizeText(previous.unitAbbr) || '-';
    const newAbbr = normalizeText(current.unitAbbr) || '-';

    if (nameChanged && abbrChanged) {
        return 'หน่วยงานเปลี่ยนแปลง: ชื่อจาก ' + oldName + ' (' + oldAbbr + ') เป็น ' + newName + ' (' + newAbbr + ')';
    }
    if (nameChanged) {
        return 'หน่วยงานเปลี่ยนแปลง: ชื่อจาก ' + oldName + ' เป็น ' + newName;
    }
    return 'หน่วยงานเปลี่ยนแปลง: ชื่อย่อจาก ' + oldAbbr + ' เป็น ' + newAbbr;
};

const buildStructureChangeMessages = (
    current: UnitSnapshot,
    previous: UnitSnapshot,
    currentMap: Map<string, UnitSnapshot>,
    previousMap: Map<string, UnitSnapshot>
): string[] => {
    const parentChanged = normalizeComparable(previous.parentOrgUnitNo) !== normalizeComparable(current.parentOrgUnitNo);
    const bgChanged = normalizeComparable(previous.bgNo) !== normalizeComparable(current.bgNo);
    const nameChanged = normalizeComparable(previous.unitName) !== normalizeComparable(current.unitName);
    const abbrChanged = normalizeComparable(previous.unitAbbr) !== normalizeComparable(current.unitAbbr);
    const currentLabel = getUnitDisplayLabel(current) || current.orgUnitNo;
    const messages: string[] = [];

    if (parentChanged) {
        messages.push(buildParentChangeMessage(current, previous, currentLabel, currentMap, previousMap));
    }
    if (bgChanged) {
        messages.push(buildBgChangeMessage(current, previous, currentLabel));
    }
    if (nameChanged || abbrChanged) {
        messages.push(buildNameChangeMessage(current, previous, nameChanged, abbrChanged));
    }

    return messages;
};

const buildStructureRemarkForUnit = (
    current: UnitSnapshot,
    previousMap: Map<string, UnitSnapshot>,
    currentMap: Map<string, UnitSnapshot>
): StructureChangeRemark | null => {
    if (!current.orgUnitNo) return null;

    const previous = previousMap.get(current.orgUnitNo);
    if (!previous) return null;

    const messages = buildStructureChangeMessages(current, previous, currentMap, previousMap);
    const remark = truncateText(messages.join(' | '), 500);
    if (!remark) return null;

    return {
        unitNo: current.orgUnitNo,
        unitName: normalizeText(current.unitName) || current.orgUnitNo,
        remark
    };
};

const buildStructureChangeRemarks = (
    currentUnits: UnitSnapshot[],
    previousUnits: UnitSnapshot[]
): StructureChangeRemark[] => {
    const previousMap = new Map<string, UnitSnapshot>(
        previousUnits.map((unit) => [unit.orgUnitNo, unit])
    );
    const currentMap = new Map<string, UnitSnapshot>(
        currentUnits.map((unit) => [unit.orgUnitNo, unit])
    );

    return currentUnits
        .map((current) => buildStructureRemarkForUnit(current, previousMap, currentMap))
        .filter((remark): remark is StructureChangeRemark => Boolean(remark));
};

const hasApprovedRemarkForUnitInMonth = async (
    transaction: sql.Transaction,
    effectiveDate: Date,
    unitNo: string
): Promise<boolean> => {
    const request = new sql.Request(transaction);
    request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
    request.input('UnitReceive', sql.VarChar(8), unitNo);
    const result = await request.query(`
        SELECT TOP 1 t.TransactionNo
        FROM MP_Transactions t WITH (NOLOCK)
        WHERE
            t.TransactionType = 5
            AND ISNULL(t.Status, 0) = 3
            AND CONVERT(date, t.EffectiveDate) = @EffectiveDate
            AND ISNULL(LTRIM(RTRIM(t.UnitReceive)), '') = @UnitReceive
    `);

    return (result.recordset || []).length > 0;
};

const THAI_MONTH_NAMES = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const getDraftEffectiveDate = (payload: DraftTransactionPayload) => {
    const monthIndex = THAI_MONTH_NAMES.indexOf(payload.effectiveMonth) + 1;
    const yearAD = parseInt(payload.effectiveYear) - 543;
    return new Date(yearAD, monthIndex - 1, 1, 0, 0, 0, 0);
};

const resolveDraftTransactionNo = async (
    transaction: sql.Transaction,
    effectiveDate: Date,
    existingTransactionNo?: string
) => existingTransactionNo || generateTransactionNo(transaction, effectiveDate);

const buildDraftTransactionDescription = async (
    pool: sql.ConnectionPool,
    payload: DraftTransactionPayload,
    effectiveDate: Date
) => {
    const conclusionPart = payload.conclusionNo ? `${payload.conclusionNo} : ` : '';
    const unitTransferName = await getUnitName(pool, effectiveDate, payload.unitTransfer) || payload.unitTransferName || payload.unitTransfer;
    const unitReceiveName = await getUnitName(pool, effectiveDate, payload.unitReceive) || payload.unitReceiveName || payload.unitReceive;
    const levelToName = payload.levelGroupToName || payload.levelGroupTo;
    const levelFromName = payload.levelGroupFromName || payload.levelGroupFrom;
    const amount = payload.amount || 0;
    const descriptions: Record<number, string> = {
        1: `${conclusionPart}หน่วยงาน${unitTransferName} โอนย้ายอัตรากำลังให้หน่วยงาน ${unitReceiveName} ที่ระดับ ${levelToName} จำนวน ${amount} อัตรา`,
        2: `${conclusionPart}หน่วยงาน${unitTransferName} โอนย้ายอัตรากำลังให้หน่วยงาน ${unitReceiveName} ที่ระดับ ${levelToName} จำนวน ${amount} อัตรา`,
        3: `${conclusionPart}หน่วยงาน${unitTransferName} ปรับเปลี่ยนอัตรากำลังจากระดับ ${levelFromName} ไปที่ระดับ ${levelToName} จำนวน ${amount} อัตรา`,
        4: `${conclusionPart}หน่วยงาน${unitTransferName} ${payload.transferInd === 1 ? 'เพิ่ม' : 'ลด'}กรอบอัตรากำลัง ที่ระดับ ${levelToName} จำนวน ${amount} อัตรา`,
        5: `Remark ของหน่วยงาน ${unitReceiveName}`,
        6: `${conclusionPart}หน่วยงาน${unitTransferName} ให้ยืมอัตรากำลังกับหน่วยงาน ${unitReceiveName} จำนวน ${amount} อัตรา`,
        7: `${conclusionPart}หน่วยงาน${unitReceiveName} คืนกรอบอัตรากำลังให้หน่วยงาน ${unitTransferName} ที่ระดับ ${levelToName} จำนวน ${amount} อัตรา`
    };

    return (descriptions[payload.transactionType] || '').substring(0, 500);
};

const getDraftTransactionAmount = (payload: DraftTransactionPayload, isRemarkType: boolean) =>
    isRemarkType ? 0 : (payload.amount || 0);

const getDraftUnitTransfer = (payload: DraftTransactionPayload, isRemarkType: boolean) =>
    isRemarkType ? (payload.unitReceive || '') : (payload.unitTransfer || '');

const addDraftTransactionFlagInputs = (req: sql.Request, payload: DraftTransactionPayload) => {
    req.input('Policyflag', sql.Int, payload.policyFlag || 0);
    req.input('PoolRsFlag', sql.Int, payload.poolRsFlag || 0);
    req.input('StrgFlag', sql.Int, payload.strgFlag || 0);
    req.input('BSType', sql.Int, payload.bsType || 0);
    req.input('SpecFlag', sql.Int, payload.specFlag || 0);
    req.input('LineStaffFlag', sql.Int, payload.lineStaffFlag || 0);
};

const addDraftTransactionDetailInputs = (
    req: sql.Request,
    payload: DraftTransactionPayload,
    isRemarkType: boolean
) => {
    req.input('TransactionType', sql.Int, payload.transactionType);
    req.input('Amount', sql.Int, getDraftTransactionAmount(payload, isRemarkType));
    req.input('UnitReceive', sql.VarChar(8), payload.unitReceive || '');
    req.input('UnitTransfer', sql.VarChar(8), getDraftUnitTransfer(payload, isRemarkType));
    req.input('LevelGroupFrom', sql.VarChar(4), payload.levelGroupFrom || '');
    req.input('LevelGroupTo', sql.VarChar(4), payload.levelGroupTo || '');
    req.input('TransferInd', sql.Int, payload.transferInd || 0);
};

const buildDraftTransactionInsertRequest = (
    transaction: sql.Transaction,
    payload: DraftTransactionPayload,
    params: {
        transactionNo: string;
        effectiveDate: Date;
        desc: string;
        status: number;
        createBy: string;
        createDate: Date;
    }
) => {
    const isRemarkType = payload.transactionType === 5;
    const req = new sql.Request(transaction);
    req.input('TransactionNo', sql.VarChar(10), params.transactionNo);
    req.input('EffectiveDate', sql.Date, toSqlDateOnly(params.effectiveDate));
    req.input('ConclusionNo', sql.NVarChar(100), payload.conclusionNo || '');
    req.input('ConclusionDate', sql.DateTime, payload.conclusionDate ? new Date(payload.conclusionDate) : new Date());
    req.input('TransactionDesc', sql.NVarChar(500), params.desc);
    addDraftTransactionDetailInputs(req, payload, isRemarkType);
    req.input('Status', sql.Int, params.status);
    addDraftTransactionFlagInputs(req, payload);
    req.input('CreateBy', sql.VarChar(10), params.createBy.substring(0, 10));
    req.input('CreateDate', sql.DateTime, params.createDate);
    req.input('RefTransactionNo', sql.VarChar(10), payload.refTransactionNo ? payload.refTransactionNo.trim() : null);
    return req;
};

const insertDraftTransaction = async (
    pool: sql.ConnectionPool,
    transaction: sql.Transaction,
    payload: DraftTransactionPayload,
    params: {
        transactionNo: string;
        effectiveDate: Date;
        status: number;
        createBy: string;
        createDate: Date;
        supportsRemarkFlag: boolean;
    }
) => {
    const desc = await buildDraftTransactionDescription(pool, payload, params.effectiveDate);
    await buildDraftTransactionInsertRequest(transaction, payload, { ...params, desc }).execute('mp_TransactionsInsert');

    const remarkText = typeof payload.remark === 'string' ? payload.remark.trim() : '';
    if (!remarkText) return;

    await executeRemarkInsert(transaction, {
        transactionNo: params.transactionNo,
        orgUnitNo: payload.unitReceive,
        note: remarkText,
        status: params.status,
        createBy: params.createBy,
        createDate: params.createDate
    }, params.supportsRemarkFlag);
};

const insertDraftTransactionFile = async (
    transaction: sql.Transaction,
    payload: DraftTransactionPayload,
    params: {
        transactionNo: string;
        effectiveDate: Date;
        createBy: string;
        createDate: Date;
    }
) => {
    if (!payload.fileName || payload.fileName.trim() === '') return;

    await transaction.request()
        .input('EffectiveDate', sql.Date, toSqlDateOnly(params.effectiveDate))
        .input('TransactionNo', sql.VarChar(10), params.transactionNo)
        .input('FileName', sql.NVarChar(100), payload.fileName)
        .input('FileUpload', sql.NVarChar(50), payload.fileUrl)
        .input('CreateBy', sql.VarChar(20), params.createBy)
        .input('CreateDate', sql.DateTime, params.createDate)
        .input('RefID', sql.Decimal(18,0), payload.refId ? payload.refId : null)
        .execute('mp_TransactionFileInsert');
};

export const createApprovedStructureRemarkTransactionsService = async (
    params: CreateApprovedStructureRemarkParams
): Promise<CreateApprovedStructureRemarkResult> => {
    const effectiveDate = toMonthStart(params.effectiveDate);
    const previousEffectiveDate = toMonthStart(new Date(effectiveDate.getFullYear(), effectiveDate.getMonth() - 1, 1));
    const createBy = normalizeText(params.createBy) || 'SYSTEM';

    const pool = await poolPromise;
    const supportsRemarkFlag = await supportsStoredProcedureParameter(pool, 'mp_RemarkInsert', '@RemarkFlag');
    const [currentUnits, previousUnits] = await Promise.all([
        getUnitSnapshotByEffectiveDate(pool, effectiveDate),
        getUnitSnapshotByEffectiveDate(pool, previousEffectiveDate)
    ]);

    const detectedChanges = buildStructureChangeRemarks(currentUnits, previousUnits);
    if (detectedChanges.length === 0) {
        return {
            success: true,
            effectiveDate: toIsoDate(effectiveDate),
            previousEffectiveDate: toIsoDate(previousEffectiveDate),
            totalDetected: 0,
            insertedCount: 0,
            skippedCount: 0,
            changes: []
        };
    }

    const dbTransaction = new sql.Transaction(pool);
    await dbTransaction.begin();

    try {
        let insertedCount = 0;
        let skippedCount = 0;
        const now = new Date();
        const changes: CreateApprovedStructureRemarkResult['changes'] = [];

        for (const change of detectedChanges) {
            const exists = await hasApprovedRemarkForUnitInMonth(dbTransaction, effectiveDate, change.unitNo);
            if (exists) {
                skippedCount += 1;
                changes.push({
                    unitNo: change.unitNo,
                    unitName: change.unitName,
                    remark: change.remark,
                    action: 'SKIPPED_EXISTING'
                });
                continue;
            }

            const transactionNo = await generateTransactionNo(dbTransaction, effectiveDate);
            await executeRemarkInsert(dbTransaction, {
                transactionNo,
                orgUnitNo: change.unitNo,
                note: change.remark,
                status: 3, // approved
                createBy,
                createDate: now
            }, supportsRemarkFlag);

            insertedCount += 1;
            changes.push({
                unitNo: change.unitNo,
                unitName: change.unitName,
                remark: change.remark,
                action: 'INSERTED'
            });
        }

        await dbTransaction.commit();

        return {
            success: true,
            effectiveDate: toIsoDate(effectiveDate),
            previousEffectiveDate: toIsoDate(previousEffectiveDate),
            totalDetected: detectedChanges.length,
            insertedCount,
            skippedCount,
            changes
        };
    } catch (error) {
        await dbTransaction.rollback();
        throw error;
    }
};

export const saveDraftTransactionService = async (
    payload: DraftTransactionPayload, 
    createBy: string,
    existingTransactionNo?: string  // if provided, skip main insert and only insert file
) => {
    try {
        const pool = await poolPromise;
        const supportsRemarkFlag = await supportsStoredProcedureParameter(pool, 'mp_RemarkInsert', '@RemarkFlag');
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const effectiveDate = getDraftEffectiveDate(payload);
            const transactionNo = await resolveDraftTransactionNo(transaction, effectiveDate, existingTransactionNo);
            const status = 1;
            const createDate = new Date();

            if (!existingTransactionNo) {
                await insertDraftTransaction(pool, transaction, payload, {
                    transactionNo,
                    effectiveDate,
                    status,
                    createBy,
                    createDate,
                    supportsRemarkFlag
                });
            }

            await insertDraftTransactionFile(transaction, payload, {
                transactionNo,
                effectiveDate,
                createBy,
                createDate
            });

            await transaction.commit();
            return { success: true, transactionNo, message: 'Draft saved successfully' };
            
        } catch (error) {
            await transaction.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Error in saveDraftTransactionService:', error);
        throw error;
    }
};

const collectDraftLookupKeys = (records: any[]) => {
    const levelGroupNos = new Set<string>();
    const unitNos = new Set<string>();
    records.forEach((record: any) => {
        if (record.LevelGroupTo) levelGroupNos.add(record.LevelGroupTo);
        if (record.LevelGroupFrom) levelGroupNos.add(record.LevelGroupFrom);
        if (record.UnitTransfer) unitNos.add(record.UnitTransfer);
        if (record.UnitReceive) unitNos.add(record.UnitReceive);
    });
    return { levelGroupNos, unitNos };
};

const getLevelGroupNameByNo = async (pool: sql.ConnectionPool, levelGroupNo: string) => {
    try {
        const request = new sql.Request(pool);
        request.input('LevelGroupNo', sql.VarChar(4), levelGroupNo);
        const result = await request.execute('mp_LevelGroupGetByNo');
        return result.recordset?.[0]?.LevelGroupName || levelGroupNo;
    } catch {
        return levelGroupNo;
    }
};

const buildDraftLookupMaps = async (
    pool: sql.ConnectionPool,
    effectiveDate: Date,
    records: any[]
) => {
    const { levelGroupNos, unitNos } = collectDraftLookupKeys(records);
    const levelGroupNameMap: Record<string, string> = {};
    const unitNameMap: Record<string, string> = {};

    await Promise.all([
        ...Array.from(levelGroupNos).map(async (levelGroupNo) => {
            levelGroupNameMap[levelGroupNo] = await getLevelGroupNameByNo(pool, levelGroupNo);
        }),
        ...Array.from(unitNos).map(async (unitNo) => {
            unitNameMap[unitNo] = await getUnitName(pool, effectiveDate, unitNo);
        })
    ]);

    return { levelGroupNameMap, unitNameMap };
};

const normalizeDraftFileUploadPath = (fileUpload: unknown) => {
    const safeFileUrl = fileUpload || null;
    if (typeof safeFileUrl === 'string' && safeFileUrl && !safeFileUrl.startsWith('uploads/')) {
        return 'uploads/transactions/' + safeFileUrl;
    }
    return safeFileUrl;
};

const enrichDraftTransactionRecord = (
    record: any,
    levelGroupNameMap: Record<string, string>,
    unitNameMap: Record<string, string>
) => ({
    ...record,
    LevelGroupToName: record.LevelGroupTo ? (levelGroupNameMap[record.LevelGroupTo] || record.LevelGroupTo) : '',
    LevelGroupFromName: record.LevelGroupFrom ? (levelGroupNameMap[record.LevelGroupFrom] || record.LevelGroupFrom) : '',
    UnitTransferName: record.UnitTransfer ? (unitNameMap[record.UnitTransfer] || record.UnitTransfer) : '',
    UnitReceiveName: record.UnitReceive ? (unitNameMap[record.UnitReceive] || record.UnitReceive) : '',
    FileUpload: normalizeDraftFileUploadPath(record.FileUpload)
});

export const getDraftTransactionsService = async (employeeId: string, effectiveDate: Date) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);

        req.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
        req.input('Status', sql.Int, 1);
        req.input('EmployeeID', sql.VarChar(10), employeeId);

        const result = await req.execute('mp_DraftTransactionsGet');
        const records = result?.recordset || [];
        if (records.length === 0) return [];

        const { levelGroupNameMap, unitNameMap } = await buildDraftLookupMaps(pool, effectiveDate, records);
        return records.map((record: any) => enrichDraftTransactionRecord(record, levelGroupNameMap, unitNameMap));
    } catch (error) {
        console.error('Error in getDraftTransactionsService:', error);
        throw error;
    }
};

export const getExistingFilesService = async (
    effectiveMonth: string,
    effectiveYear: string,
    employeeId: string
) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);

        // Calculate EffectiveDate from month/year
        const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
        const monthIndex = monthNames.indexOf(effectiveMonth) + 1;
        const yearAD = parseInt(effectiveYear) - 543;
        const effectiveDate = new Date(yearAD, monthIndex - 1, 1, 0, 0, 0, 0);

        req.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
        req.input('EmployeeID', sql.VarChar(20), employeeId);

        const result = await req.execute('mp_TransactionFilesByDateGet');
        
        if (result && result.recordset) {
            // Map the result to a usable format for the frontend
            return result.recordset.map(row => ({
               id: row.TransactionFileID,
               name: row.FileName,
               transactionNo: row.TransactionNo,
               conclusionNo: row.ConclusionNo,
               fileUrl: (row.FileUpload && !row.FileUpload.startsWith('uploads/')) ? `uploads/transactions/${row.FileUpload}` : row.FileUpload
            }));
        }

        return [];
    } catch (error) {
        console.error('Error in getExistingFilesService:', error);
        throw error;
    }
};

export const deleteDraftTransactionService = async (transactionNo: string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('TransactionNo', sql.VarChar(10), transactionNo)
            .input('Status', sql.Int, 0) // 0 = Deleted
            .input('UpdateBy', sql.VarChar(20), updateBy)
            .input('UpdateDate', sql.DateTime, new Date())
            .execute('mp_TransactionsUpdateStatus');
        return { success: true };
    } catch (error) {
        console.error('Error in deleteDraftTransactionService:', error);
        throw error;
    }
};

export interface CheckFlowParams {
    jobType: number;
    userGroupReceive: string;
    orgUnitNoReceive: string;
    levelGroupNoFrom: string;
    orgUnitNoTransfer: string | null;
    levelGroupNoTo: string;
    effectiveDate: string | Date;
    isRequirePolicy: number;
}

type DirectApproveTransactionRow = {
    TransactionNo: string;
    EffectiveDate: Date | string | null;
    TransactionType: number;
    RefTransactionNo: string | null;
    HasDocument: number;
};

const normalizeDirectApproveTransactionNos = (transactionNos: string[]) => Array.from(
    new Set(
        (transactionNos || [])
            .map((txNo) => normalizeText(txNo).substring(0, 10))
            .filter(Boolean)
    )
);

const lookupDirectApproveTransactions = async (
    transaction: sql.Transaction,
    transactionNos: string[]
): Promise<DirectApproveTransactionRow[]> => {
    const txLookupReq = new sql.Request(transaction);
    const txNoPlaceholders = transactionNos.map((txNo, idx) => {
        const param = `TxNo${idx}`;
        txLookupReq.input(param, sql.VarChar(10), txNo);
        return `@${param}`;
    });

    const txLookupRes = await txLookupReq.query(`
        SELECT
            t.TransactionNo,
            t.EffectiveDate,
            t.TransactionType,
            t.RefTransactionNo,
            CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM MP_DocumentItems di WITH (NOLOCK)
                    WHERE di.ItemID = t.TransactionNo
                ) THEN 1
                ELSE 0
            END AS HasDocument
        FROM MP_Transactions t WITH (NOLOCK)
        WHERE t.TransactionNo IN (${txNoPlaceholders.join(',')})
    `);

    return txLookupRes.recordset || [];
};

const lookupReturnParentDocuments = async (
    transaction: sql.Transaction,
    txRows: DirectApproveTransactionRow[]
) => {
    const returnRows = txRows.filter((row) => Number(row.TransactionType) === 7 && normalizeText(row.RefTransactionNo));
    const parentDocByReturnTx = new Map<string, string>();
    if (returnRows.length === 0) return parentDocByReturnTx;

    const returnParentReq = new sql.Request(transaction);
    const returnPlaceholders = returnRows.map((row, idx) => {
        const param = `ReturnTx${idx}`;
        returnParentReq.input(param, sql.VarChar(10), normalizeText(row.TransactionNo).substring(0, 10));
        return `@${param}`;
    });
    const returnParentRes = await returnParentReq.query(`
        SELECT
            t.TransactionNo,
            dBorrow.DocumentNo AS ParentDocumentNo
        FROM MP_Transactions t WITH (NOLOCK)
        LEFT JOIN MP_DocumentItems diBorrow WITH (NOLOCK)
            ON diBorrow.ItemID = t.RefTransactionNo
        LEFT JOIN MP_Document dBorrow WITH (NOLOCK)
            ON dBorrow.DocumentNo = diBorrow.DocumentNo
        WHERE t.TransactionNo IN (${returnPlaceholders.join(',')})
    `);
    (returnParentRes.recordset || []).forEach((row: any) => {
        const txNo = normalizeText(row?.TransactionNo).substring(0, 10);
        const parentDocumentNo = normalizeText(row?.ParentDocumentNo).substring(0, 13);
        if (txNo && parentDocumentNo) parentDocByReturnTx.set(txNo, parentDocumentNo);
    });

    return parentDocByReturnTx;
};

const getDirectApproveCreatorInfo = async (transaction: sql.Transaction, safeUpdateBy: string) => {
    try {
        const creatorInfoReq = new sql.Request(transaction);
        creatorInfoReq.input('EmployeeID', sql.VarChar(20), safeUpdateBy);
        const creatorInfoRes = await creatorInfoReq.execute('mp_UserInfoGet');
        return {
            creatorFullname: normalizeText(creatorInfoRes.recordset?.[0]?.FullName) || safeUpdateBy,
            creatorEmail: normalizeText(creatorInfoRes.recordset?.[0]?.Email) || null
        };
    } catch {
        return { creatorFullname: safeUpdateBy, creatorEmail: null };
    }
};

const groupDirectApproveDocumentRows = (
    rowsWithoutDocument: DirectApproveTransactionRow[],
    parentDocByReturnTx: Map<string, string>
) => {
    const documentGroups = new Map<string, DirectApproveTransactionRow[]>();
    rowsWithoutDocument.forEach((row) => {
        const txNo = normalizeText(row.TransactionNo).substring(0, 10);
        if (!txNo) return;
        const parentDoc = Number(row.TransactionType) === 7 ? (parentDocByReturnTx.get(txNo) || '') : '';
        const groupKey = parentDoc || '__NO_PARENT__';
        const current = documentGroups.get(groupKey) || [];
        current.push(row);
        documentGroups.set(groupKey, current);
    });
    return documentGroups;
};

const getEarliestDirectApproveEffectiveDate = (rows: DirectApproveTransactionRow[], fallbackDate: Date) =>
    rows.reduce<Date>((earliest, row) => {
        const parsed = new Date(String(row.EffectiveDate || ''));
        if (Number.isNaN(parsed.getTime())) return earliest;
        return parsed.getTime() < earliest.getTime() ? parsed : earliest;
    }, fallbackDate);

const insertDirectApproveDocumentItem = async (
    transaction: sql.Transaction,
    documentNo: string,
    itemId: string,
    safeUpdateBy: string,
    creatorFullname: string,
    creatorEmail: string | null
) => {
    const creatorReq = new sql.Request(transaction);
    creatorReq.input('DocumentNo', sql.VarChar(13), documentNo);
    creatorReq.input('ItemID', sql.VarChar(10), itemId);
    creatorReq.input('Seqno', sql.Int, 0);
    creatorReq.input('EmployeeID', sql.VarChar(20), safeUpdateBy);
    creatorReq.input('Fullname', sql.NVarChar(200), creatorFullname);
    creatorReq.input('Email', sql.NVarChar(200), creatorEmail);
    creatorReq.input('UserGroupNo', sql.VarChar(2), null);
    creatorReq.input('AuditStatus', sql.Int, 2);
    creatorReq.input('UnitSide', sql.NVarChar(50), null);
    await creatorReq.execute('mp_DocumentItemsInsert');
};

const createDirectApproveDocumentGroup = async (
    transaction: sql.Transaction,
    groupedRows: DirectApproveTransactionRow[],
    groupKey: string,
    today: Date,
    safeUpdateBy: string,
    creatorFullname: string,
    creatorEmail: string | null
) => {
    const documentNo = await generateDocumentNo(transaction, today);
    const docInsertReq = new sql.Request(transaction);
    docInsertReq.input('DocumentNo', sql.VarChar(13), documentNo);
    docInsertReq.input('EffectiveDate', sql.DateTime, getEarliestDirectApproveEffectiveDate(groupedRows, today));
    docInsertReq.input('DocumentType', sql.Int, 1);
    docInsertReq.input('CreateBy', sql.VarChar(20), safeUpdateBy);
    docInsertReq.input('CreateDate', sql.DateTime, today);
    docInsertReq.input('ParentDocumentNo', sql.VarChar(13), groupKey === '__NO_PARENT__' ? null : groupKey);
    await docInsertReq.execute('mp_DocumentInsert');

    for (const row of groupedRows) {
        const itemId = normalizeText(row.TransactionNo).substring(0, 10);
        if (itemId) await insertDirectApproveDocumentItem(transaction, documentNo, itemId, safeUpdateBy, creatorFullname, creatorEmail);
    }

    const docUpdateReq = new sql.Request(transaction);
    docUpdateReq.input('DocumentNo', sql.VarChar(13), documentNo);
    docUpdateReq.input('DocumentStatus', sql.Int, 2);
    docUpdateReq.input('UpdateBy', sql.VarChar(20), safeUpdateBy);
    docUpdateReq.input('UpdateDate', sql.DateTime, today);
    await docUpdateReq.execute('mp_DocumentUpdateStatus');
};

const createMissingDirectApproveDocuments = async (
    transaction: sql.Transaction,
    txRows: DirectApproveTransactionRow[],
    today: Date,
    safeUpdateBy: string
) => {
    const rowsWithoutDocument = txRows.filter((row) => Number(row.HasDocument) !== 1);
    if (rowsWithoutDocument.length === 0) return;

    const parentDocByReturnTx = await lookupReturnParentDocuments(transaction, txRows);
    const { creatorFullname, creatorEmail } = await getDirectApproveCreatorInfo(transaction, safeUpdateBy);
    const documentGroups = groupDirectApproveDocumentRows(rowsWithoutDocument, parentDocByReturnTx);
    for (const [groupKey, groupedRows] of documentGroups.entries()) {
        if (groupedRows.length) {
            await createDirectApproveDocumentGroup(transaction, groupedRows, groupKey, today, safeUpdateBy, creatorFullname, creatorEmail);
        }
    }
};

const approveDirectTransactions = async (
    transaction: sql.Transaction,
    transactionNos: string[],
    safeUpdateBy: string,
    today: Date
) => {
    for (const txNo of transactionNos) {
        const req = new sql.Request(transaction);
        req.input('TransactionNo', sql.VarChar(10), txNo);
        req.input('UpdateBy', sql.VarChar(20), safeUpdateBy);
        req.input('UpdateDate', sql.DateTime, today);
        await req.execute('mp_TransactionsDirectApprove');
    }
};

const executeBorrowTransactionsGet = async (pool: sql.ConnectionPool, employeeId?: string) => {
    try {
        const req = new sql.Request(pool);
        if (employeeId) req.input('EmployeeID', sql.VarChar(20), employeeId);
        return await req.execute('mp_BorrowTransactionsGet');
    } catch (error: any) {
        const message = String(error?.message || '');
        if (!message.includes('has no parameters and arguments were supplied')) throw error;
        return new sql.Request(pool).execute('mp_BorrowTransactionsGet');
    }
};

const mergeBorrowRows = (
    a: Record<string, unknown>,
    b: Record<string, unknown>
): Record<string, unknown> => {
    const aDocTs = toTimestamp(a.DocumentCreateDate ?? a.CreateDate ?? a.UpdateDate);
    const bDocTs = toTimestamp(b.DocumentCreateDate ?? b.CreateDate ?? b.UpdateDate);
    const preferred = bDocTs >= aDocTs ? b : a;
    const fallback = bDocTs >= aDocTs ? a : b;

    return {
        ...fallback,
        ...preferred,
        TotalReturned: Math.max(toFiniteNumber(a.TotalReturned), toFiniteNumber(b.TotalReturned)),
    };
};

const dedupeBorrowRows = (recordset: Record<string, unknown>[]) => {
    const dedupedByTransactionNo = new Map<string, Record<string, unknown>>();
    recordset.forEach((row, index) => {
        const txNo = String(row.TransactionNo ?? '').trim();
        const key = txNo || `__row_${index}`;
        const existing = dedupedByTransactionNo.get(key);
        dedupedByTransactionNo.set(key, existing ? mergeBorrowRows(existing, row) : row);
    });
    return Array.from(dedupedByTransactionNo.values());
};

const getBorrowTransactionNos = (records: Record<string, unknown>[]) => records
    .map((r) => String(r.TransactionNo ?? '').trim())
    .filter(Boolean);

const getReturnedAmountByBorrowTx = async (pool: sql.ConnectionPool, borrowTransactionNos: string[]) => {
    const returnedAmountByBorrowTx = new Map<string, number>();
    if (borrowTransactionNos.length === 0) return returnedAmountByBorrowTx;

    const pendingReq = new sql.Request(pool);
    const placeholders = borrowTransactionNos.map((txNo, idx) => {
        const param = `BorrowTx${idx}`;
        pendingReq.input(param, sql.VarChar(10), txNo);
        return `@${param}`;
    });

    const pendingSql = `
        SELECT
            RefTransactionNo,
            SUM(CAST(ISNULL(Amount, 0) AS INT)) AS ReturnedAmount
        FROM MP_Transactions WITH (NOLOCK)
        WHERE TransactionType = 7
          AND Status IN (1, 2, 3)
          AND RefTransactionNo IN (${placeholders.join(',')})
        GROUP BY RefTransactionNo
    `;
    const pendingRes = await pendingReq.query(pendingSql);
    (pendingRes.recordset || []).forEach((row: any) => {
        const refNo = String(row?.RefTransactionNo || '').trim();
        if (refNo) returnedAmountByBorrowTx.set(refNo, toFiniteNumber(row?.ReturnedAmount));
    });

    return returnedAmountByBorrowTx;
};

const collectBorrowLookupKeys = (records: Record<string, unknown>[]) => {
    const unitNos = new Set<string>();
    const levelGroupNos = new Set<string>();
    records.forEach((r: { UnitTransfer?: string; UnitReceive?: string; LevelGroupTo?: string; LevelGroupFrom?: string }) => {
        if (r.UnitTransfer) unitNos.add(r.UnitTransfer);
        if (r.UnitReceive) unitNos.add(r.UnitReceive);
        if (r.LevelGroupTo) levelGroupNos.add(r.LevelGroupTo);
        if (r.LevelGroupFrom) levelGroupNos.add(r.LevelGroupFrom);
    });
    return { unitNos, levelGroupNos };
};

const getRepresentativeBorrowEffectiveDate = (records: Record<string, unknown>[]) => {
    const representativeEffDateParsed = new Date(String(records[0]?.EffectiveDate ?? ''));
    return Number.isNaN(representativeEffDateParsed.getTime()) ? new Date() : representativeEffDateParsed;
};

const buildBorrowUnitMaps = async (pool: sql.ConnectionPool, unitNos: Set<string>, representativeEffDate: Date) => {
    const unitNameMap: Record<string, string> = {};
    const unitBgMap: Record<string, string> = {};
    const unitSnapshots = await getUnitSnapshotByEffectiveDate(pool, representativeEffDate);
    const unitSnapshotMap = new Map(unitSnapshots.map((unit) => [unit.orgUnitNo, unit] as const));

    for (const unitNo of unitNos) {
        unitNameMap[unitNo] = await getUnitName(pool, representativeEffDate, unitNo);
        unitBgMap[unitNo] = unitSnapshotMap.get(unitNo)?.bgNo || '';
    }

    return { unitNameMap, unitBgMap };
};

const buildBorrowLevelGroupNameMap = async (pool: sql.ConnectionPool, levelGroupNos: Set<string>) => {
    const levelGroupNameMap: Record<string, string> = {};
    for (const lgNo of levelGroupNos) {
        try {
            const lgReq = new sql.Request(pool);
            lgReq.input('LevelGroupNo', sql.VarChar(4), lgNo);
            const lgRes = await lgReq.execute('mp_LevelGroupGetByNo');
            if (lgRes.recordset?.length > 0) levelGroupNameMap[lgNo] = lgRes.recordset[0].LevelGroupName || lgNo;
        } catch {
            levelGroupNameMap[lgNo] = lgNo;
        }
    }
    return levelGroupNameMap;
};

const resolveBorrowBusinessUnitNo = (row: Record<string, unknown>, unitTransferBgNo: string, unitReceiveBgNo: string) => String(
    row.BusinessUnitNo ||
    row.BusinessUnit ||
    row.BGNo ||
    unitTransferBgNo ||
    unitReceiveBgNo ||
    ''
).trim();

type BorrowEnrichmentMaps = {
    returnedAmountByBorrowTx: Map<string, number>;
    unitNameMap: Record<string, string>;
    unitBgMap: Record<string, string>;
    levelGroupNameMap: Record<string, string>;
    bgNameMap: Map<string, string>;
};

const getBorrowReturnFields = (row: Record<string, unknown>, returnedAmountByBorrowTx: Map<string, number>) => {
    const txNo = String(row.TransactionNo || '').trim();
    const totalReturned = Math.max(toFiniteNumber(row.TotalReturned), returnedAmountByBorrowTx.get(txNo) || 0);
    return {
        totalReturned,
        RemainingCount: Math.max(0, toFiniteNumber(row.Amount) - totalReturned)
    };
};

const getBorrowLevelNameFields = (row: Record<string, unknown>, levelGroupNameMap: Record<string, string>) => ({
    LevelGroupToName: row.LevelGroupTo ? (levelGroupNameMap[String(row.LevelGroupTo)] || row.LevelGroupTo) : '',
    LevelGroupFromName: row.LevelGroupFrom ? (levelGroupNameMap[String(row.LevelGroupFrom)] || row.LevelGroupFrom) : ''
});

const getBorrowUnitFields = (row: Record<string, unknown>, maps: BorrowEnrichmentMaps) => {
    const unitTransfer = String(row.UnitTransfer || '');
    const unitReceive = String(row.UnitReceive || '');
    const unitTransferBgNo = unitTransfer ? (maps.unitBgMap[unitTransfer] || '') : '';
    const unitReceiveBgNo = unitReceive ? (maps.unitBgMap[unitReceive] || '') : '';

    return {
        unitTransferBgNo,
        unitReceiveBgNo,
        UnitTransferName: unitTransfer ? (maps.unitNameMap[unitTransfer] || unitTransfer) : '',
        UnitReceiveName: unitReceive ? (maps.unitNameMap[unitReceive] || unitReceive) : '',
        UnitTransferBGNo: unitTransferBgNo,
        UnitTransferBGName: unitTransferBgNo ? (maps.bgNameMap.get(unitTransferBgNo) || unitTransferBgNo) : '',
        UnitReceiveBGNo: unitReceiveBgNo,
        UnitReceiveBGName: unitReceiveBgNo ? (maps.bgNameMap.get(unitReceiveBgNo) || unitReceiveBgNo) : ''
    };
};

const getBorrowBusinessUnitFields = (
    row: Record<string, unknown>,
    unitTransferBgNo: string,
    unitReceiveBgNo: string,
    bgNameMap: Map<string, string>
) => {
    const businessUnitNo = resolveBorrowBusinessUnitNo(row, unitTransferBgNo, unitReceiveBgNo);
    const businessUnitName = businessUnitNo ? (bgNameMap.get(businessUnitNo) || businessUnitNo) : '';
    return {
        BusinessUnitNo: businessUnitNo,
        BusinessUnitName: businessUnitName,
        BGNo: businessUnitNo,
        BGName: businessUnitName
    };
};

const enrichBorrowTransactionRow = (
    row: Record<string, unknown>,
    maps: BorrowEnrichmentMaps
) => {
    const returnFields = getBorrowReturnFields(row, maps.returnedAmountByBorrowTx);
    const unitFields = getBorrowUnitFields(row, maps);

    return {
        ...row,
        TotalReturned: returnFields.totalReturned,
        ...getBorrowLevelNameFields(row, maps.levelGroupNameMap),
        ...unitFields,
        ...getBorrowBusinessUnitFields(row, unitFields.unitTransferBgNo, unitFields.unitReceiveBgNo, maps.bgNameMap),
        RemainingCount: returnFields.RemainingCount,
    };
};

const enrichBorrowTransactions = async (pool: sql.ConnectionPool, records: Record<string, unknown>[]) => {
    const returnedAmountByBorrowTx = await getReturnedAmountByBorrowTx(pool, getBorrowTransactionNos(records));
    const { unitNos, levelGroupNos } = collectBorrowLookupKeys(records);
    const representativeEffDate = getRepresentativeBorrowEffectiveDate(records);
    const { unitNameMap, unitBgMap } = await buildBorrowUnitMaps(pool, unitNos, representativeEffDate);
    const [bgNameMap, levelGroupNameMap] = await Promise.all([
        getBgNameMapByEffectiveDate(pool, representativeEffDate),
        buildBorrowLevelGroupNameMap(pool, levelGroupNos)
    ]);

    return records.map((row) => enrichBorrowTransactionRow(row, {
        returnedAmountByBorrowTx,
        unitNameMap,
        unitBgMap,
        levelGroupNameMap,
        bgNameMap
    }));
};

export const getApproversFlowService = async (params: CheckFlowParams) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('JobType', sql.Int, params.jobType);
        req.input('UserGroupReceive', sql.VarChar(2), params.userGroupReceive);
        req.input('OrgUnitNoReceive', sql.VarChar(20), params.orgUnitNoReceive);
        req.input('LevelGroupNoFrom', sql.VarChar(20), params.levelGroupNoFrom);
        req.input('OrgUnitNoTransfer', sql.VarChar(20), params.orgUnitNoTransfer);
        req.input('LevelGroupNoTo', sql.VarChar(20), params.levelGroupNoTo);
        req.input('EffectiveDate', sql.Date, toSqlDateOnly(params.effectiveDate));
        req.input('IsRequirePolicy', sql.Bit, params.isRequirePolicy);

        const result = await req.execute('mp_CheckFlow');
        
        if (!result || !result.recordset) {
            return [];
        }

        return result.recordset;
    } catch (error) {
        console.error('Error in getApproversFlowService:', error);
        throw error;
    }
};

export const directApproveTransactionsService = async (transactionNos: string[], updateBy: string) => {
    try {
        const pool = await poolPromise;
        const today = new Date();
        const safeUpdateBy = normalizeText(updateBy).substring(0, 20) || 'SYSTEM';
        const normalizedTransactionNos = normalizeDirectApproveTransactionNos(transactionNos);

        if (normalizedTransactionNos.length === 0) {
            return { success: true, message: 'No transactions to approve.' };
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const txRows = await lookupDirectApproveTransactions(transaction, normalizedTransactionNos);
            await createMissingDirectApproveDocuments(transaction, txRows, today, safeUpdateBy);
            await approveDirectTransactions(transaction, normalizedTransactionNos, safeUpdateBy, today);
            await resetSentSapStatusForTransactions(transaction, normalizedTransactionNos);
            await transaction.commit();
            return { success: true, message: 'Transactions approved successfully.' };
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    } catch (error) {
        console.error('Error in directApproveTransactionsService:', error);
        throw error;
    }
};

/**
 * Fetch approved borrow transactions (TransactionType=6, Status=3)
 * along with already-returned amounts (TransactionType=7)
 */
export const getBorrowTransactionsService = async (employeeId?: string) => {
    try {
        const pool = await poolPromise;
        const result = await executeBorrowTransactionsGet(pool, employeeId);

        if (!result.recordset?.length) return [];

        return enrichBorrowTransactions(pool, dedupeBorrowRows(result.recordset as Record<string, unknown>[]));
    } catch (error) {
        console.error('Error in getBorrowTransactionsService:', error);
        throw error;
    }
};

const getTransactionNosFromRows = (rows: any[]) => Array.from(
    new Set(
        rows
            .map((row: any) => String(row?.TransactionNo || '').trim())
            .filter(Boolean)
    )
);

const buildReturnTransactionPlaceholders = (request: sql.Request, transactionNos: string[]) => transactionNos.map((txNo, idx) => {
    const paramName = 'ReturnTx' + idx;
    request.input(paramName, sql.VarChar(10), txNo);
    return '@' + paramName;
});

const getReturnTransactionDetails = async (pool: sql.ConnectionPool, transactionNos: string[]) => {
    const detailReq = new sql.Request(pool);
    const placeholders = buildReturnTransactionPlaceholders(detailReq, transactionNos);
    const detailSql = `
        SELECT
            t.TransactionNo,
            t.EffectiveDate,
            t.TransactionDesc,
            t.UnitReceive,
            t.UnitTransfer,
            t.PoolRsFlag,
            t.StrgFlag,
            t.BSType,
            t.SpecFlag,
            t.LineStaffFlag
        FROM MP_Transactions t WITH (NOLOCK)
        WHERE t.TransactionNo IN (${placeholders.join(',')})
    `;

    const detailResult = await detailReq.query(detailSql);
    const detailMap = new Map<string, any>();
    (detailResult.recordset || []).forEach((row: any) => {
        const txNo = String(row?.TransactionNo || '').trim();
        if (!txNo) return;
        detailMap.set(txNo, row);
    });
    return detailMap;
};

const mergeReturnTransactionDetail = (row: any, detailMap: Map<string, any>) => {
    const txNo = String(row?.TransactionNo || '').trim();
    const detail = detailMap.get(txNo);
    if (!detail) return row;

    const mergedPoolRsFlag = row?.PoolRsFlag ?? row?.PoolRSFlag ?? detail?.PoolRsFlag;
    return {
        ...row,
        EffectiveDate: row?.EffectiveDate ?? detail?.EffectiveDate ?? null,
        TransactionDesc: row?.TransactionDesc ?? detail?.TransactionDesc ?? '',
        UnitReceive: row?.UnitReceive ?? detail?.UnitReceive ?? '',
        UnitTransfer: row?.UnitTransfer ?? detail?.UnitTransfer ?? '',
        PoolRsFlag: mergedPoolRsFlag ?? 0,
        PoolRSFlag: mergedPoolRsFlag ?? 0,
        StrgFlag: row?.StrgFlag ?? detail?.StrgFlag ?? 0,
        BSType: row?.BSType ?? detail?.BSType ?? 0,
        SpecFlag: row?.SpecFlag ?? detail?.SpecFlag ?? 0,
        LineStaffFlag: row?.LineStaffFlag ?? detail?.LineStaffFlag ?? 0,
    };
};

/**
 * Fetch return transactions (TransactionType=7) linked to a borrow document
 */
export const getReturnsByBorrowService = async (borrowDocumentNo: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        req.input('ParentDocumentNo', sql.VarChar(13), borrowDocumentNo);

        const result = await req.execute('mp_ReturnsByBorrowGet');
        const rows = result.recordset || [];
        if (rows.length === 0) return [];

        const transactionNos = getTransactionNosFromRows(rows);
        if (transactionNos.length === 0) return rows;

        const detailMap = await getReturnTransactionDetails(pool, transactionNos);
        return rows.map((row: any) => mergeReturnTransactionDetail(row, detailMap));
    } catch (error) {
        console.error('Error in getReturnsByBorrowService:', error);
        throw error;
    }
};

const executeHRCenterOrgUnitProcedure = async (
    pool: sql.ConnectionPool,
    procedureName: string,
    effectiveDate: string | Date,
    employeeId: string,
    userGroupNo: string
) => {
    const req = new sql.Request(pool);
    req.input("EffectiveDate", sql.Date, toSqlDateOnly(effectiveDate));
    req.input("EmployeeID", sql.VarChar(10), employeeId);
    req.input("UserGroupNO", sql.VarChar(2), userGroupNo);
    return req.execute(procedureName);
};

const executeHRCenterOrgUnitProcedureWithFallback = async (
    pool: sql.ConnectionPool,
    procedureName: string,
    fallbackProcedureName: string,
    effectiveDate: string | Date,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        return await executeHRCenterOrgUnitProcedure(pool, procedureName, effectiveDate, employeeId, userGroupNo);
    } catch (error: any) {
        const message = String(error?.message || "").toLowerCase();
        if (!message.includes("could not find stored procedure")) {
            throw error;
        }
        return executeHRCenterOrgUnitProcedure(pool, fallbackProcedureName, effectiveDate, employeeId, userGroupNo);
    }
};

export const getHRCenterDataService = async (
    viewMode: "all" | "department",
    effectiveDate: string | Date,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        const pool = await poolPromise;
        const procedureName = viewMode === "department"
            ? "mp_HRCenter_OrgUnit_GetDataByEffDate_ByChild"
            : "mp_HRCenter_OrgUnit_GetDataAll_ByChild";
        const fallbackProcedureName = viewMode === "department"
            ? "mp_HRCenter_OrgUnit_GetTrans"
            : "mp_HRCenter_OrgUnit_GetAll";

        const result = await executeHRCenterOrgUnitProcedureWithFallback(
            pool,
            procedureName,
            fallbackProcedureName,
            effectiveDate,
            employeeId,
            userGroupNo
        );

        if (!result || !result.recordset) {
            return [];
        }

        return result.recordset;
    } catch (error) {
        console.error("Error in getHRCenterDataService:", error);
        throw error;
    }
};
export interface MonitorHistoryQueryParams {
    fromDate: Date;
    toDate: Date;
    employeeId: string;
    orgUnitNo: string;
    userGroupNo: string;
}

export const getMonitorHistoryService = async (params: MonitorHistoryQueryParams): Promise<Record<string, unknown>[]> => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('FromDate', sql.Date, toSqlDateOnly(params.fromDate));
        request.input('ToDate', sql.Date, toSqlDateOnly(params.toDate));
        request.input('EmployeeID', sql.VarChar(10), params.employeeId);
        request.input('OrgUnitNo', sql.VarChar(8), params.orgUnitNo);
        request.input('UserGroupNo', sql.VarChar(2), params.userGroupNo);

        const result = await request.execute('mp_GetMonitorHistory');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_GetMonitorHistory:', error);
        throw error;
    }
};

export const getTransactionActionLogService = async (refNo: string): Promise<Record<string, unknown>[]> => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('RefNo', sql.VarChar(20), refNo);
        const result = await request.execute('mp_ActionLogGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_ActionLogGet:', error);
        throw error;
    }
};

export const getTransactionLogYearService = async (
    orgUnitNo: string,
    year: number
): Promise<Record<string, unknown>[]> => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('OrgUnitNo', sql.VarChar(8), orgUnitNo);
        request.input('year', sql.Int, year);

        const result = await request.execute('mp_TransactionLogYear');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_TransactionLogYear:', error);
        throw error;
    }
};

export const getTransactionLogYearDetailService = async (
    orgUnitNo: string,
    year: number,
    month: number
): Promise<Record<string, unknown>[]> => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('OrgUnitNo', sql.VarChar(8), orgUnitNo);
        request.input('year', sql.Int, year);
        request.input('month', sql.Int, month);

        const result = await request.execute('mp_TransactionLogYearDetail');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_TransactionLogYearDetail:', error);
        throw error;
    }
};

export const getSapMonitorGridService = async (
    effectiveDate: Date
): Promise<Record<string, unknown>[]> => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('EffectiveDate', sql.Date, toSqlDateOnly(effectiveDate));
        const result = await request.execute('mp_logSAP_GetData');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_logSAP_GetData:', error);
        throw error;
    }
};

export const getSapMonitorLogService = async (
    effectiveDate: string
): Promise<Record<string, unknown>[]> => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        // Legacy API sent effective date as yyyyMMdd string.
        request.input('EffectiveDate', sql.VarChar(20), effectiveDate);
        const result = await request.execute('mp_logInterfaceGetByEffectiveDate');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_logInterfaceGetByEffectiveDate:', error);
        throw error;
    }
};
