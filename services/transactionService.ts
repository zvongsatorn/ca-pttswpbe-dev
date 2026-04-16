import { sql, poolPromise } from '../config/db.js';

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

// Helper: look up a unit's display name via mp_UnitNameGet
const getUnitName = async (pool: typeof sql.ConnectionPool.prototype, effectiveDate: Date, unitNo: string): Promise<string> => {
    if (!unitNo) return '';
    try {
        const req = new sql.Request(pool);
        req.input('EffectiveDate', sql.DateTime, effectiveDate);
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

const getUnitSnapshotByEffectiveDate = async (
    pool: typeof sql.ConnectionPool.prototype,
    effectiveDate: Date
): Promise<UnitSnapshot[]> => {
    const request = new sql.Request(pool);
    request.input('EffectiveDate', sql.DateTime, effectiveDate);
    const result = await request.execute('mp_UnitGetByEffectiveDate');

    return (result.recordset || []).map((row: any) => ({
        orgUnitNo: normalizeText(row?.OrgUnitNo),
        unitName: normalizeText(row?.UnitName),
        unitAbbr: normalizeText(row?.UnitAbbr),
        parentOrgUnitNo: normalizeText(row?.ParentOrgUnitNo),
        bgNo: normalizeText(row?.BGNo),
    }));
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

    const remarks: StructureChangeRemark[] = [];

    for (const current of currentUnits) {
        if (!current.orgUnitNo) continue;

        const previous = previousMap.get(current.orgUnitNo);
        if (!previous) continue;

        const parentChanged = normalizeComparable(previous.parentOrgUnitNo) !== normalizeComparable(current.parentOrgUnitNo);
        const bgChanged = normalizeComparable(previous.bgNo) !== normalizeComparable(current.bgNo);
        const nameChanged = normalizeComparable(previous.unitName) !== normalizeComparable(current.unitName);
        const abbrChanged = normalizeComparable(previous.unitAbbr) !== normalizeComparable(current.unitAbbr);

        if (!parentChanged && !bgChanged && !nameChanged && !abbrChanged) continue;

        const messages: string[] = [];
        const currentLabel = getUnitDisplayLabel(current) || current.orgUnitNo;

        if (parentChanged) {
            const oldParent = getParentLabel(previous.parentOrgUnitNo, currentMap, previousMap);
            const newParent = getParentLabel(current.parentOrgUnitNo, currentMap, previousMap);
            messages.push(`ปรับโครงสร้าง: ${currentLabel} ย้ายสังกัดจาก ${oldParent} ไป ${newParent}`);
        }

        if (bgChanged) {
            const oldBg = normalizeText(previous.bgNo) || '-';
            const newBg = normalizeText(current.bgNo) || '-';
            messages.push(`ปรับโครงสร้าง: ${currentLabel} ย้าย BU จาก ${oldBg} ไป ${newBg}`);
        }

        if (nameChanged || abbrChanged) {
            const oldName = normalizeText(previous.unitName) || previous.orgUnitNo;
            const newName = normalizeText(current.unitName) || current.orgUnitNo;
            const oldAbbr = normalizeText(previous.unitAbbr) || '-';
            const newAbbr = normalizeText(current.unitAbbr) || '-';

            if (nameChanged && abbrChanged) {
                messages.push(`หน่วยงานเปลี่ยนแปลง: ชื่อจาก ${oldName} (${oldAbbr}) เป็น ${newName} (${newAbbr})`);
            } else if (nameChanged) {
                messages.push(`หน่วยงานเปลี่ยนแปลง: ชื่อจาก ${oldName} เป็น ${newName}`);
            } else {
                messages.push(`หน่วยงานเปลี่ยนแปลง: ชื่อย่อจาก ${oldAbbr} เป็น ${newAbbr}`);
            }
        }

        const remark = truncateText(messages.join(' | '), 500);
        if (!remark) continue;

        remarks.push({
            unitNo: current.orgUnitNo,
            unitName: normalizeText(current.unitName) || current.orgUnitNo,
            remark
        });
    }

    return remarks;
};

const hasApprovedRemarkForUnitInMonth = async (
    transaction: sql.Transaction,
    effectiveDate: Date,
    unitNo: string
): Promise<boolean> => {
    const request = new sql.Request(transaction);
    request.input('EffectiveDate', sql.Date, effectiveDate);
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
            // Calculate EffectiveDate from month/year
            const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
            const monthIndex = monthNames.indexOf(payload.effectiveMonth) + 1;
            const yearAD = parseInt(payload.effectiveYear) - 543;
            // First day of the effective month
            const effectiveDate = new Date(`${yearAD}-${monthIndex.toString().padStart(2, '0')}-01T00:00:00Z`);

            // Generate TransactionNo or use existing
            let transactionNo = '';
            
            if (existingTransactionNo) {
                transactionNo = existingTransactionNo;
            } else {
                transactionNo = await generateTransactionNo(transaction, effectiveDate);
            }
            
            const status = 1; // 1 = Draft
            const createDate = new Date();

            if (!existingTransactionNo) {
                if (payload.transactionType === 5) {
                    await executeRemarkInsert(transaction, {
                        transactionNo,
                        orgUnitNo: payload.unitReceive,
                        note: payload.remark,
                        status,
                        createBy,
                        createDate
                    }, supportsRemarkFlag);
                } else {
                    // Build desc using real unit names from DB via mp_UnitNameGet
                    const conclusionPart = payload.conclusionNo ? `${payload.conclusionNo} : ` : '';
                    const unitTransferName = await getUnitName(pool, effectiveDate, payload.unitTransfer) || payload.unitTransferName || payload.unitTransfer;
                    const unitReceiveName = await getUnitName(pool, effectiveDate, payload.unitReceive) || payload.unitReceiveName || payload.unitReceive;
                    const levelToName = payload.levelGroupToName || payload.levelGroupTo;
                    const levelFromName = payload.levelGroupFromName || payload.levelGroupFrom;

                    let desc = '';
                    if (payload.transactionType === 1 || payload.transactionType === 2) {
                        desc = `${conclusionPart}หน่วยงาน${unitTransferName} โอนย้ายอัตรากำลังให้หน่วยงาน ${unitReceiveName} ที่ระดับ ${levelToName} จำนวน ${payload.amount || 0} อัตรา`;
                    } else if (payload.transactionType === 3) {
                        desc = `${conclusionPart}หน่วยงาน${unitTransferName} ปรับเปลี่ยนอัตรากำลังจากระดับ ${levelFromName} ไปที่ระดับ ${levelToName} จำนวน ${payload.amount || 0} อัตรา`;
                    } else if (payload.transactionType === 4) {
                        const typeAction = payload.transferInd === 1 ? 'เพิ่ม' : 'ลด';
                        desc = `${conclusionPart}หน่วยงาน${unitTransferName} ${typeAction}กรอบอัตรากำลัง ที่ระดับ ${levelToName} จำนวน ${payload.amount || 0} อัตรา`;
                    } else if (payload.transactionType === 6) {
                        desc = `${conclusionPart}หน่วยงาน${unitTransferName} ให้ยืมอัตรากำลังกับหน่วยงาน ${unitReceiveName} จำนวน ${payload.amount || 0} อัตรา`;
                    } else if (payload.transactionType === 7) {
                        desc = `${conclusionPart}หน่วยงาน${unitReceiveName} คืนกรอบอัตรากำลังให้หน่วยงาน ${unitTransferName} ที่ระดับ ${levelToName} จำนวน ${payload.amount || 0} อัตรา`;
                    }

                    if (desc.length > 500) {
                        desc = desc.substring(0, 500);
                    }

                    const buildInsertRequest = (includeRefTransactionNo: boolean) => {
                        const req = new sql.Request(transaction);
                        req.input('TransactionNo', sql.VarChar(10), transactionNo);
                        req.input('EffectiveDate', sql.DateTime, effectiveDate);
                        req.input('ConclusionNo', sql.NVarChar(100), payload.conclusionNo || '');
                        req.input('ConclusionDate', sql.DateTime, payload.conclusionDate ? new Date(payload.conclusionDate) : new Date());
                        req.input('TransactionDesc', sql.NVarChar(500), desc);
                        req.input('TransactionType', sql.Int, payload.transactionType);
                        req.input('Amount', sql.Int, payload.amount || 0);
                        req.input('UnitReceive', sql.VarChar(8), payload.unitReceive || '');
                        req.input('UnitTransfer', sql.VarChar(8), payload.unitTransfer || '');
                        req.input('LevelGroupFrom', sql.VarChar(4), payload.levelGroupFrom || '');
                        req.input('LevelGroupTo', sql.VarChar(4), payload.levelGroupTo || '');
                        req.input('TransferInd', sql.Int, payload.transferInd || 0);
                        req.input('Status', sql.Int, status);
                        req.input('Policyflag', sql.Int, payload.policyFlag || 0);
                        req.input('PoolRsFlag', sql.Int, payload.poolRsFlag || 0);
                        req.input('StrgFlag', sql.Int, payload.strgFlag || 0);
                        req.input('BSType', sql.Int, payload.bsType || 0);
                        req.input('SpecFlag', sql.Int, payload.specFlag || 0);
                        req.input('LineStaffFlag', sql.Int, payload.lineStaffFlag || 0);
                        req.input('CreateBy', sql.VarChar(10), createBy.substring(0, 10)); // size limit 10
                        req.input('CreateDate', sql.DateTime, createDate);
                        if (includeRefTransactionNo) {
                            req.input('RefTransactionNo', sql.VarChar(10), payload.refTransactionNo ? payload.refTransactionNo.trim() : null);
                        }
                        return req;
                    };

                    await buildInsertRequest(true).execute('mp_TransactionsInsert');
                }
            } // End of if (!existingTransactionNo)

        // mp_TransactionFileInsert (if file provided)
        if (payload.fileName && payload.fileName.trim() !== '') {
                await transaction.request()
                    .input('EffectiveDate', sql.DateTime, effectiveDate)
                    .input('TransactionNo', sql.VarChar(10), transactionNo)
                    .input('FileName', sql.NVarChar(100), payload.fileName)
                    .input('FileUpload', sql.NVarChar(50), payload.fileUrl)
                    .input('CreateBy', sql.VarChar(20), createBy)
                    .input('CreateDate', sql.DateTime, createDate)
                    .input('RefID', sql.Decimal(18,0), payload.refId ? payload.refId : null)
                    .execute('mp_TransactionFileInsert');
        }

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

export const getDraftTransactionsService = async (employeeId: string, effectiveDate: Date) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('EffectiveDate', sql.DateTime, effectiveDate);
        req.input('Status', sql.Int, 1); // 1 = Draft
        req.input('EmployeeID', sql.VarChar(10), employeeId);

        const result = await req.execute('mp_DraftTransactionsGet');
        
        if (!result || !result.recordset || result.recordset.length === 0) {
            return [];
        }

        const records = result.recordset;

        // Collect unique IDs to fetch names in parallel
        const levelGroupNos = new Set<string>();
        const unitNos = new Set<string>();
        records.forEach((r: any) => {
            if (r.LevelGroupTo) levelGroupNos.add(r.LevelGroupTo);
            if (r.LevelGroupFrom) levelGroupNos.add(r.LevelGroupFrom);
            if (r.UnitTransfer) unitNos.add(r.UnitTransfer);
            if (r.UnitReceive) unitNos.add(r.UnitReceive);
        });

        const levelGroupNameMap: Record<string, string> = {};
        const unitNameMap: Record<string, string> = {};

        // Fetch all names in parallel to avoid N+1 sequential DB calls
        await Promise.all([
            ...Array.from(levelGroupNos).map(async (lgNo) => {
                try {
                    const lgReq = new sql.Request(pool);
                    lgReq.input('LevelGroupNo', sql.VarChar(4), lgNo);
                    const lgRes = await lgReq.execute('mp_LevelGroupGetByNo');
                    levelGroupNameMap[lgNo] = lgRes.recordset?.[0]?.LevelGroupName || lgNo;
                } catch {
                    levelGroupNameMap[lgNo] = lgNo;
                }
            }),
            ...Array.from(unitNos).map(async (unitNo) => {
                unitNameMap[unitNo] = await getUnitName(pool, effectiveDate, unitNo);
            })
        ]);

        // Attach resolved names to records
        return records.map((r: any) => {
            let safeFileUrl = r.FileUpload || null;
            if (safeFileUrl && !safeFileUrl.startsWith('uploads/')) {
                safeFileUrl = `uploads/transactions/${safeFileUrl}`;
            }
            return {
                ...r,
                LevelGroupToName: r.LevelGroupTo ? (levelGroupNameMap[r.LevelGroupTo] || r.LevelGroupTo) : '',
                LevelGroupFromName: r.LevelGroupFrom ? (levelGroupNameMap[r.LevelGroupFrom] || r.LevelGroupFrom) : '',
                UnitTransferName: r.UnitTransfer ? (unitNameMap[r.UnitTransfer] || r.UnitTransfer) : '',
                UnitReceiveName: r.UnitReceive ? (unitNameMap[r.UnitReceive] || r.UnitReceive) : '',
                FileUpload: safeFileUrl
            };
        });
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
        const effectiveDate = new Date(`${yearAD}-${monthIndex.toString().padStart(2, '0')}-01T00:00:00Z`);

        req.input('EffectiveDate', sql.DateTime, effectiveDate);
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
        req.input('EffectiveDate', sql.Date, params.effectiveDate);
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
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const txNo of transactionNos) {
                const req = new sql.Request(transaction);
                req.input('TransactionNo', sql.VarChar(10), txNo);
                req.input('UpdateBy', sql.VarChar(20), updateBy);
                req.input('UpdateDate', sql.DateTime, today);
                await req.execute('mp_TransactionsDirectApprove');
            }
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
        const req = new sql.Request(pool);

        // Get all approved borrow transactions
        if (employeeId) {
            req.input('EmployeeID', sql.VarChar(20), employeeId);
            // Don't filter by employee, show all approved borrows so any HR can return
        }

        const result = await req.execute('mp_BorrowTransactionsGet');
        if (!result.recordset?.length) return [];

        // Defensive dedupe: some DB joins (e.g. document item joins) can repeat the same borrow row.
        const toTimestamp = (value: unknown): number => {
            const parsed = new Date(String(value ?? '')).getTime();
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const toNumber = (value: unknown): number => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : 0;
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
                TotalReturned: Math.max(toNumber(a.TotalReturned), toNumber(b.TotalReturned)),
            };
        };

        const rawRecords = result.recordset as Record<string, unknown>[];
        const dedupedByTransactionNo = new Map<string, Record<string, unknown>>();
        rawRecords.forEach((row, index) => {
            const txNo = String(row.TransactionNo ?? '').trim();
            const key = txNo || `__row_${index}`;
            const existing = dedupedByTransactionNo.get(key);
            dedupedByTransactionNo.set(key, existing ? mergeBorrowRows(existing, row) : row);
        });

        // Enrich with unit names and level names
        const records = Array.from(dedupedByTransactionNo.values());
        const borrowTransactionNos = records
            .map((r) => String(r.TransactionNo ?? '').trim())
            .filter(Boolean);

        // Include pending/approved return requests so RemainingCount is reduced immediately after submit.
        const returnedAmountByBorrowTx = new Map<string, number>();
        if (borrowTransactionNos.length > 0) {
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
                const returnedAmount = toNumber(row?.ReturnedAmount);
                if (refNo) {
                    returnedAmountByBorrowTx.set(refNo, returnedAmount);
                }
            });
        }

        const unitNos = new Set<string>();
        const levelGroupNos = new Set<string>();

        records.forEach((r: { UnitTransfer?: string; UnitReceive?: string; LevelGroupTo?: string; LevelGroupFrom?: string }) => {
            if (r.UnitTransfer) unitNos.add(r.UnitTransfer);
            if (r.UnitReceive) unitNos.add(r.UnitReceive);
            if (r.LevelGroupTo) levelGroupNos.add(r.LevelGroupTo);
            if (r.LevelGroupFrom) levelGroupNos.add(r.LevelGroupFrom);
        });

        // Resolve unit names
        const unitNameMap: Record<string, string> = {};
        for (const unitNo of unitNos) {
            const effDateRaw = records[0]?.EffectiveDate;
            const parsedEffDate = new Date(String(effDateRaw ?? ''));
            const effDate = Number.isNaN(parsedEffDate.getTime()) ? new Date() : parsedEffDate;
            unitNameMap[unitNo] = await getUnitName(pool, effDate, unitNo);
        }

        // Resolve level group names
        const levelGroupNameMap: Record<string, string> = {};
        for (const lgNo of levelGroupNos) {
            try {
                const lgReq = new sql.Request(pool);
                lgReq.input('LevelGroupNo', sql.VarChar(4), lgNo);
                const lgRes = await lgReq.execute('mp_LevelGroupGetByNo');
                if (lgRes.recordset?.length > 0) {
                    levelGroupNameMap[lgNo] = lgRes.recordset[0].LevelGroupName || lgNo;
                }
            } catch {
                levelGroupNameMap[lgNo] = lgNo;
            }
        }

        const enriched = records.map((r: { TransactionNo?: string; LevelGroupTo?: string; LevelGroupFrom?: string; UnitTransfer?: string; UnitReceive?: string; Amount?: number; TotalReturned?: number; [key: string]: unknown }) => {
            const txNo = String(r.TransactionNo || '').trim();
            const returnedByStatus = toNumber(r.TotalReturned);
            const returnedByPending = returnedAmountByBorrowTx.get(txNo) || 0;
            const totalReturned = Math.max(returnedByStatus, returnedByPending);
            const amount = toNumber(r.Amount);

            return {
                ...r,
                TotalReturned: totalReturned,
                LevelGroupToName: r.LevelGroupTo ? (levelGroupNameMap[r.LevelGroupTo] || r.LevelGroupTo) : '',
                LevelGroupFromName: r.LevelGroupFrom ? (levelGroupNameMap[r.LevelGroupFrom] || r.LevelGroupFrom) : '',
                UnitTransferName: r.UnitTransfer ? (unitNameMap[r.UnitTransfer] || r.UnitTransfer) : '',
                UnitReceiveName: r.UnitReceive ? (unitNameMap[r.UnitReceive] || r.UnitReceive) : '',
                RemainingCount: Math.max(0, amount - totalReturned),
            };
        });

        return enriched;
    } catch (error) {
        console.error('Error in getBorrowTransactionsService:', error);
        throw error;
    }
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
        return result.recordset || [];
    } catch (error) {
        console.error('Error in getReturnsByBorrowService:', error);
        throw error;
    }
};

export const getHRCenterDataService = async (
    viewMode: 'all' | 'department',
    effectiveDate: string | Date,
    employeeId: string,
    userGroupNo: string
) => {
    try {
        const pool = await poolPromise;
        let result;
        if (viewMode === 'department') {
            const req = new sql.Request(pool);
            req.input('EffectiveDate', sql.DateTime, effectiveDate);
            req.input('EmployeeID', sql.VarChar(10), employeeId);
            req.input('UserGroupNO', sql.VarChar(2), userGroupNo);
            result = await req.execute('mp_HRCenter_OrgUnit_GetTrans');
        } else {
            try {
                const req = new sql.Request(pool);
                req.input('EffectiveDate', sql.DateTime, effectiveDate);
                req.input('EmployeeID', sql.VarChar(10), employeeId);
                req.input('UserGroupNO', sql.VarChar(2), userGroupNo);
                result = await req.execute('mp_HRCenter_OrgUnit_GetDataAll_ByChild');
            } catch (error: any) {
                const message = String(error?.message || '').toLowerCase();
                if (!message.includes('could not find stored procedure')) {
                    throw error;
                }
                const fallbackReq = new sql.Request(pool);
                fallbackReq.input('EffectiveDate', sql.DateTime, effectiveDate);
                fallbackReq.input('EmployeeID', sql.VarChar(10), employeeId);
                fallbackReq.input('UserGroupNO', sql.VarChar(2), userGroupNo);
                result = await fallbackReq.execute('mp_HRCenter_OrgUnit_GetAll');
            }
        }

        if (!result || !result.recordset) {
            return [];
        }

        return result.recordset;
    } catch (error) {
        console.error('Error in getHRCenterDataService:', error);
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

        request.input('FromDate', sql.DateTime, params.fromDate);
        request.input('ToDate', sql.DateTime, params.toDate);
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

        request.input('EffectiveDate', sql.DateTime, effectiveDate);
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
