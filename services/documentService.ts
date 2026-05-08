import { sql, poolPromise } from '../config/db.js';
import { sendMail, resolveMailRecipient } from './mailService.js';
import { createMailLog } from './mailLogService.js';
import { resetSentSapStatusForTransactions } from './sapSendStatusService.js';

const sendMailWithLog = async (params: {
    recipient: string | null;
    requestedRecipient?: string | null;
    subject: string;
    body: string;
    sendFromBy: string;
    sendToBy?: string | null;
    refNo?: string | null;
    context: string;
}) => {
    const now = new Date();
    const requestedRecipient = (params.requestedRecipient || '').trim();
    const finalRecipient = (params.recipient || '').trim();
    const logRecipient = finalRecipient || requestedRecipient;
    const canSend = finalRecipient !== '';
    const result = canSend
        ? await sendMail(finalRecipient, params.subject, params.body)
        : { success: false, error: 'Skip sending because resolved recipient is empty' };
    const remark = canSend ? null : 'SKIP';

    try {
        await createMailLog({
            sendFromBy: params.sendFromBy || 'SYSTEM',
            sendFromDate: now,
            sendToBy: params.sendToBy || null,
            emailTo: logRecipient,
            mailSubject: params.subject,
            mailBody: params.body,
            effectiveDate: now,
            isCC: 0,
            isSend: canSend && result.success ? 1 : 0,
            remark,
            ccRecipients: [],
            refNo: params.refNo || null,
            createBy: params.sendFromBy || 'SYSTEM',
            createDate: now
        });
    } catch (logError) {
        console.error(`[${params.context}] Failed to insert MP_MailTo log:`, logError);
    }

    return result;
};

interface MailTransactionRow {
    transactionNo: string;
    transactionTypeText: string;
    transactionDesc: string;
}

interface UnitSnapshotRow {
    orgUnitNo: string;
    unitName: string;
    parentOrgUnitNo: string;
    bgNo: string;
}

const escapeHtml = (value: string): string =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const formatTransactionTypeText = (typeNo: number | null | undefined): string => {
    switch (typeNo) {
        case 1: return 'โอนกรอบอัตรากำลังภายใต้สายผู้ช่วย';
        case 2: return 'โอนกรอบอัตรากำลังอื่นๆ';
        case 3: return 'ปรับสัดส่วนกรอบอัตรากำลังภายในหน่วยงาน';
        case 4: return 'เพิ่มลดกรอบอัตรากำลังในหน่วยงาน';
        case 5: return 'บันทึก Remark หน่วยงาน';
        case 6: return 'ยืมกรอบอัตรากำลัง';
        case 7: return 'คืนยืมกรอบอัตรากำลัง';
        default: return '-';
    }
};

const getDocumentCategory = (transactionType: unknown): string => {
    const categoryMap = new Map<number, string>([
        [1, "ภายใต้ ผช."],
        [2, "โอนกรอบอื่นๆ"],
        [3, "ปรับสัดส่วน"],
        [4, "เพิ่ม/ลด"],
        [6, "ยืม"]
    ]);
    return categoryMap.get(Number(transactionType)) || "อื่นๆ";
};

const getDocumentTypeCategory = (transactionType: unknown): string => {
    const categoryMap = new Map<number, string>([
        [1, "transfer"],
        [4, "add"],
        [3, "adjust"]
    ]);
    return categoryMap.get(Number(transactionType)) || "other";
};

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const firstNonEmptyText = (...values: unknown[]): string => {
    for (const value of values) {
        const normalized = normalizeText(value);
        if (normalized) return normalized;
    }
    return '';
};

// mssql (tedious) serializes DateTime params with UTC clock by default.
// Build a UTC Date from local components so SQL stores the same wall-clock value.
const toSqlDateTimePreserveLocalClock = (date: Date): Date => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return date;
    }
    return new Date(Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
        date.getMilliseconds()
    ));
};

const unitSnapshotCache = new Map<string, Map<string, UnitSnapshotRow>>();
const bgNameCache = new Map<string, Map<string, string>>();

const toMonthSnapshotKey = (effectiveDateRaw: unknown): string => {
    const parsed = new Date(String(effectiveDateRaw ?? ''));
    if (Number.isNaN(parsed.getTime())) {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
};

const parseEffectiveMonthDate = (effectiveDateRaw: unknown): Date => {
    const parsed = new Date(String(effectiveDateRaw ?? ''));
    if (Number.isNaN(parsed.getTime())) {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1, 0, 0, 0, 0);
};

const getBgNameMapByEffectiveDate = async (
    pool: sql.ConnectionPool,
    effectiveDateRaw: unknown
): Promise<Map<string, string>> => {
    const cacheKey = toMonthSnapshotKey(effectiveDateRaw);
    const cached = bgNameCache.get(cacheKey);
    if (cached) return cached;

    const snapshotDate = parseEffectiveMonthDate(effectiveDateRaw);
    const map = new Map<string, string>();
    try {
        const request = new sql.Request(pool);
        request.input('p_CheckDate', sql.DateTime, snapshotDate);
        const result = await request.execute('mp_BGGetByEffectivePeriod');
        (result.recordset || []).forEach((row: any) => {
            const bgNo = normalizeText(row?.BGNo);
            const bgName = normalizeText(row?.BGName);
            if (!bgNo) return;
            map.set(bgNo, bgName || bgNo);
        });
    } catch (error) {
        console.warn('[documentService] Failed to resolve BG names by effective date:', error);
    }

    bgNameCache.set(cacheKey, map);
    return map;
};

const resolveDocumentEffectiveDateFromItems = async (
    tx: sql.Transaction,
    itemIds: string[],
    fallback: Date
): Promise<Date> => {
    const uniqueItemIds = Array.from(new Set((itemIds || []).map((itemId) => String(itemId || '').trim()).filter(Boolean)));
    const fallbackMonthStart = new Date(fallback.getFullYear(), fallback.getMonth(), 1, 0, 0, 0, 0);
    if (!uniqueItemIds.length) {
        return fallbackMonthStart;
    }

    const req = new sql.Request(tx);
    const placeholders = uniqueItemIds.map((itemId, idx) => {
        const param = `TransactionNo${idx}`;
        req.input(param, sql.VarChar(10), itemId);
        return `@${param}`;
    });

    const res = await req.query(`
        SELECT TransactionNo, EffectiveDate
        FROM MP_Transactions WITH (NOLOCK)
        WHERE TransactionNo IN (${placeholders.join(',')})
          AND EffectiveDate IS NOT NULL
    `);

    const rows = Array.isArray(res.recordset) ? res.recordset : [];
    if (!rows.length) {
        return fallbackMonthStart;
    }

    const monthKeys = new Set<string>();
    let selectedDate: Date | null = null;

    for (const row of rows) {
        const parsed = new Date(row?.EffectiveDate);
        if (Number.isNaN(parsed.getTime())) continue;

        const monthStart = new Date(parsed.getFullYear(), parsed.getMonth(), 1, 0, 0, 0, 0);
        monthKeys.add(`${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`);

        if (!selectedDate || monthStart.getTime() < selectedDate.getTime()) {
            selectedDate = monthStart;
        }
    }

    if (monthKeys.size > 1) {
        console.warn('[submitDocumentService] Found mixed effective months in selected transactions. Using earliest month.');
    }

    return selectedDate || fallbackMonthStart;
};

const getUnitSnapshotMapByEffectiveDate = async (
    pool: sql.ConnectionPool,
    effectiveDateRaw: unknown
): Promise<Map<string, UnitSnapshotRow>> => {
    const cacheKey = toMonthSnapshotKey(effectiveDateRaw);
    const cached = unitSnapshotCache.get(cacheKey);
    if (cached) return cached;

    const snapshotDate = parseEffectiveMonthDate(effectiveDateRaw);
    const req = new sql.Request(pool);
    req.input('EffectiveDate', sql.DateTime, snapshotDate);
    const res = await req.execute('mp_UnitGetByEffectiveDate');

    const map = new Map<string, UnitSnapshotRow>();
    (res.recordset || []).forEach((row: any) => {
        const orgUnitNo = normalizeText(row?.OrgUnitNo);
        if (!orgUnitNo) return;
        map.set(orgUnitNo, {
            orgUnitNo,
            unitName: firstNonEmptyText(row?.UnitName, row?.UnitAbbr, orgUnitNo),
            parentOrgUnitNo: normalizeText(row?.ParentOrgUnitNo),
            bgNo: normalizeText(row?.BGNo)
        });
    });

    unitSnapshotCache.set(cacheKey, map);
    return map;
};

type DocumentOrgFilters = {
    agencyId: string;
    agencyName: string;
    divisionId: string;
    divisionName: string;
    businessUnitId: string;
    businessUnitName: string;
};

const getInitialDocumentOrgFilters = (firstItem: Record<string, unknown> | undefined): DocumentOrgFilters => ({
    agencyId: firstNonEmptyText(
        firstItem?.UnitReceive,
        firstItem?.UnitTransfer,
        firstItem?.OrgUnitNo
    ),
    agencyName: firstNonEmptyText(
        firstItem?.UnitReceiveName,
        firstItem?.UnitTransferName,
        firstItem?.OrgUnitName,
        firstItem?.UnitName
    ),
    divisionId: firstNonEmptyText(
        firstItem?.ParentOrgUnitNo,
        firstItem?.DivisionNo
    ),
    divisionName: firstNonEmptyText(
        firstItem?.ParentOrgUnitName,
        firstItem?.DivisionName
    ),
    businessUnitId: firstNonEmptyText(
        firstItem?.BGNo,
        firstItem?.BusinessUnitNo,
        firstItem?.BusinessUnit
    ),
    businessUnitName: firstNonEmptyText(
        firstItem?.BGName,
        firstItem?.BusinessUnitName
    )
});

const shouldResolveDocumentTransactionFallback = (filters: DocumentOrgFilters): boolean =>
    !filters.agencyId || !filters.divisionId || !filters.businessUnitId;

const getDocumentTransactionAgencyId = async (
    pool: sql.ConnectionPool,
    firstItem: Record<string, unknown> | undefined
): Promise<string> => {
    const itemId = firstNonEmptyText(firstItem?.ItemID, firstItem?.TransactionNo);
    if (!itemId) return '';

    try {
        const txReq = new sql.Request(pool);
        txReq.input('TransactionNo', sql.VarChar(10), itemId);
        const txRes = await txReq.query(`
            SELECT TOP 1
                UnitReceive,
                UnitTransfer
            FROM MP_Transactions WITH (NOLOCK)
            WHERE TransactionNo = @TransactionNo
        `);
        const txRow = txRes.recordset?.[0];
        return firstNonEmptyText(txRow?.UnitReceive, txRow?.UnitTransfer);
    } catch (error) {
        console.warn('[documentService] Failed to resolve org filters from MP_Transactions:', error);
        return '';
    }
};

const applyDocumentUnitFallback = async (
    pool: sql.ConnectionPool,
    effectiveDateRaw: unknown,
    filters: DocumentOrgFilters
) => {
    if (!filters.agencyId && !filters.divisionId) return;

    const unitMap = await getUnitSnapshotMapByEffectiveDate(pool, effectiveDateRaw);
    const agency = filters.agencyId ? unitMap.get(filters.agencyId) : undefined;

    if (agency) {
        filters.agencyName ||= firstNonEmptyText(agency.unitName, filters.agencyId);
        filters.divisionId ||= agency.parentOrgUnitNo;
        filters.businessUnitId ||= agency.bgNo;
    }

    if (filters.divisionId && !filters.divisionName) {
        const division = unitMap.get(filters.divisionId);
        filters.divisionName = firstNonEmptyText(division?.unitName, filters.divisionId);
    }
};

const applyDocumentBusinessUnitFallback = async (
    pool: sql.ConnectionPool,
    effectiveDateRaw: unknown,
    filters: DocumentOrgFilters
) => {
    const needsLookup = filters.businessUnitId &&
        (!filters.businessUnitName || normalizeText(filters.businessUnitName) === normalizeText(filters.businessUnitId));
    if (!needsLookup) return;

    const bgMap = await getBgNameMapByEffectiveDate(pool, effectiveDateRaw);
    filters.businessUnitName = firstNonEmptyText(
        bgMap.get(filters.businessUnitId),
        filters.businessUnitName,
        filters.businessUnitId
    );
};

const applyDocumentOrgNameFallbacks = (filters: DocumentOrgFilters) => {
    filters.agencyName ||= filters.agencyId;
    filters.divisionName ||= filters.divisionId;
    filters.businessUnitName ||= filters.businessUnitId;
};

const resolveDocumentOrgFilters = async (
    pool: sql.ConnectionPool,
    firstItem: Record<string, unknown> | undefined,
    effectiveDateRaw: unknown
) => {
    const filters = getInitialDocumentOrgFilters(firstItem);

    // Fallback: some DB versions return limited fields from mp_DocumentItemsDetailGet.
    // In that case, resolve org data from MP_Transactions by ItemID.
    if (shouldResolveDocumentTransactionFallback(filters) && !filters.agencyId) {
        filters.agencyId = await getDocumentTransactionAgencyId(pool, firstItem);
    }

    await applyDocumentUnitFallback(pool, effectiveDateRaw, filters);
    await applyDocumentBusinessUnitFallback(pool, effectiveDateRaw, filters);
    applyDocumentOrgNameFallbacks(filters);

    return filters;
};

const getTransactionRowsByNos = async (pool: sql.ConnectionPool, transactionNos: string[]): Promise<MailTransactionRow[]> => {
    const uniqueNos = Array.from(new Set((transactionNos || []).map((n) => String(n || '').trim()).filter(Boolean)));
    if (!uniqueNos.length) return [];

    try {
        const request = new sql.Request(pool);
        const placeholders = uniqueNos.map((transactionNo, idx) => {
            const param = `TransactionNo${idx}`;
            request.input(param, sql.VarChar(20), transactionNo);
            return `@${param}`;
        });

        const query = `
            SELECT
                TransactionNo,
                TransactionType,
                TransactionDesc
            FROM MP_Transactions WITH (NOLOCK)
            WHERE TransactionNo IN (${placeholders.join(',')})
        `;

        const result = await request.query(query);
        return (result.recordset || []).map((row: any) => ({
            transactionNo: String(row?.TransactionNo || '').trim(),
            transactionTypeText: formatTransactionTypeText(Number.isFinite(Number(row?.TransactionType)) ? Number(row.TransactionType) : null),
            transactionDesc: String(row?.TransactionDesc || '').trim() || '-'
        }));
    } catch (error) {
        console.warn('[documentService] Failed to lookup transaction rows:', error);
        return uniqueNos.map((transactionNo) => ({
            transactionNo,
            transactionTypeText: '-',
            transactionDesc: '-'
        }));
    }
};

const buildTransactionReviewBody = (params: {
    recipientName: string;
    senderName: string;
    documentNo: string;
    rows: MailTransactionRow[];
    addressLoginUrl: string;
}): string => {
    const transactionCount = params.rows.length;
    const tableRows = params.rows.map((row) => [
        "<tr>",
        `<td style='background-color:#f8fafc;color:#1f2937;padding:8px;vertical-align:top;border:1px solid #e5e7eb;'>${escapeHtml(row.transactionNo)}</td>`,
        `<td style='background-color:#f8fafc;color:#1f2937;padding:8px;vertical-align:top;border:1px solid #e5e7eb;'>${escapeHtml(row.transactionTypeText)}</td>`,
        `<td style='background-color:#f8fafc;color:#1f2937;padding:8px;vertical-align:top;border:1px solid #e5e7eb;'>${escapeHtml(row.transactionDesc).replace(/\r?\n/g, '<br>')}</td>`,
        "</tr>"
    ].join('')).join('');

    const transactionTable = [
        "<table style='border-collapse:collapse;width:100%;max-width:980px;margin-top:8px;'>",
        "<tr style='text-align:center;font-weight:700;color:#ffffff;background-color:#0ea5e9;'>",
        "<td style='padding:8px;border:1px solid #e5e7eb;'>ID</td>",
        "<td style='padding:8px;border:1px solid #e5e7eb;'>ประเภท</td>",
        "<td style='padding:8px;border:1px solid #e5e7eb;'>รายการ</td>",
        "</tr>",
        tableRows,
        "</table>"
    ].join('');

    return [
        `เรียน คุณ${escapeHtml(params.recipientName)}`,
        '<br><br>',
        `<div style='font-size: medium;'>มีการเปลี่ยนแปลงกรอบอัตรากำลัง ${transactionCount} รายการ ส่งมาจาก คุณ${escapeHtml(params.senderName)} รอให้ตรวจสอบ</div><br>`,
        `<div style='font-size: medium;'><b>มีคำขอหมายเลข:</b> ${escapeHtml(params.documentNo)}</div><br>`,
        transactionTable,
        '<br><br>กรุณาเข้าไปดำเนินการในระบบ ตามลิ้งค์ด้านล่างนี้',
        `<br><a href='${escapeHtml(params.addressLoginUrl)}'>${escapeHtml(params.addressLoginUrl)}</a>`
    ].join('');
};

export interface ApproverPayload {
    seqno: number;
    employeeId: string;
    fullname: string;
    email: string;
    userGroupNo?: string;
    unitSide?: string;
}

export interface DocumentItemPayload {
    itemId: string; // TransactionNo
    approvers: ApproverPayload[];
}

export interface SubmitDocumentPayload {
    documentType: number;
    userGroupNo?: string;
    items: DocumentItemPayload[];
    parentDocumentNo?: string;
}

interface SubmitFirstApproverMailGroup {
    requestedEmail: string;
    recipientName: string;
    recipientEmployeeId: string | null;
    itemIds: string[];
}

interface SubmitFirstApproverMailGroupDraft {
    requestedEmail: string;
    recipientName: string;
    recipientEmployeeId: string | null;
    itemIdSet: Set<string>;
}

const addSubmitFirstApproverMailGroup = (
    groups: Map<string, SubmitFirstApproverMailGroupDraft>,
    key: string,
    itemId: string,
    requestedEmail: string,
    recipientName: string,
    recipientEmployeeId: string | null
): void => {
    const existing = groups.get(key);
    if (existing) {
        existing.itemIdSet.add(itemId);
        if (!existing.recipientName && recipientName) {
            existing.recipientName = recipientName;
        }
        if (!existing.requestedEmail && requestedEmail) {
            existing.requestedEmail = requestedEmail;
        }
        return;
    }

    groups.set(key, {
        requestedEmail,
        recipientName,
        recipientEmployeeId,
        itemIdSet: new Set([itemId])
    });
};

const buildSubmitFirstApproverMailGroups = (items: DocumentItemPayload[]): SubmitFirstApproverMailGroup[] => {
    const groups = new Map<string, SubmitFirstApproverMailGroupDraft>();

    for (const item of items || []) {
        const firstApprover = item.approvers.find((a) => a.seqno === 1);
        const itemId = String(item.itemId || '').trim();
        const requestedEmail = String(firstApprover?.email || '').trim();
        if (!firstApprover || !itemId || !requestedEmail) continue;

        const recipientEmployeeId = String(firstApprover.employeeId || '').trim();
        const key = recipientEmployeeId
            ? `emp:${recipientEmployeeId.toUpperCase()}`
            : `mail:${requestedEmail.toLowerCase()}`;
        const recipientName = String(firstApprover.fullname || '').trim();

        addSubmitFirstApproverMailGroup(
            groups,
            key,
            itemId,
            requestedEmail,
            recipientName,
            recipientEmployeeId || null
        );
    }

    return Array.from(groups.values()).map((group) => ({
        requestedEmail: group.requestedEmail,
        recipientName: group.recipientName,
        recipientEmployeeId: group.recipientEmployeeId,
        itemIds: Array.from(group.itemIdSet)
    }));
};

const buildDocumentNoPrefix = (date: Date) => {
    const adYY = date.getFullYear().toString().slice(-2);
    const mm = (date.getMonth() + 1).toString().padStart(2, '0');
    return 'DA' + adYY + mm;
};

const getNextDocumentNo = async (transaction: sql.Transaction, today: Date) => {
    const prefix = buildDocumentNoPrefix(today);
    const lastDocReq = new sql.Request(transaction);
    lastDocReq.input('Prefix', sql.VarChar(10), prefix);
    const lastDocRes = await lastDocReq.execute('mp_DocumentLastNoGet');

    let runningNumber = 1;
    const lastDocNo = lastDocRes.recordset?.[0]?.DocumentNo;
    if (lastDocNo) {
        const lastRunningStr = lastDocNo.substring(prefix.length);
        if (!isNaN(parseInt(lastRunningStr))) {
            runningNumber = parseInt(lastRunningStr) + 1;
        }
    }

    return prefix + runningNumber.toString().padStart(4, '0');
};

const insertDocumentHeader = async (
    transaction: sql.Transaction,
    payload: SubmitDocumentPayload,
    documentNo: string,
    effectiveDate: Date,
    today: Date,
    createBy: string
) => {
    const docReq = new sql.Request(transaction);
    docReq.input('DocumentNo', sql.VarChar(13), documentNo);
    docReq.input('EffectiveDate', sql.DateTime, toSqlDateTimePreserveLocalClock(effectiveDate));
    docReq.input('DocumentType', sql.Int, payload.documentType);
    docReq.input('CreateBy', sql.VarChar(20), createBy);
    docReq.input('CreateDate', sql.DateTime, toSqlDateTimePreserveLocalClock(today));
    docReq.input('ParentDocumentNo', sql.VarChar(13), payload.parentDocumentNo || null);
    await docReq.execute('mp_DocumentInsert');
};

const getDocumentCreatorInfo = async (transaction: sql.Transaction, createBy: string) => {
    const creatorInfoReq = new sql.Request(transaction);
    creatorInfoReq.input('EmployeeID', sql.VarChar(20), createBy);
    const creatorInfoRes = await creatorInfoReq.execute('mp_UserInfoGet');
    return {
        creatorFullname: creatorInfoRes.recordset?.[0]?.FullName || createBy,
        creatorEmail: creatorInfoRes.recordset?.[0]?.Email || null
    };
};

const validateSubmitDocumentItemId = (rawItemId: unknown) => {
    const itemId = String(rawItemId || '').trim();
    if (!itemId) {
        throw new Error('Invalid submit payload: itemId is required for every item');
    }
    if (itemId.length > 10) {
        throw new Error('Invalid submit payload: itemId "' + itemId + '" exceeds 10 characters');
    }
    return itemId;
};

const insertCreatorDocumentItem = async (
    transaction: sql.Transaction,
    documentNo: string,
    itemId: string,
    createBy: string,
    creatorFullname: string,
    creatorEmail: string | null,
    creatorUserGroupNo: string | null
) => {
    const creatorReq = new sql.Request(transaction);
    creatorReq.input('DocumentNo', sql.VarChar(13), documentNo);
    creatorReq.input('ItemID', sql.VarChar(10), itemId);
    creatorReq.input('Seqno', sql.Int, 0);
    creatorReq.input('EmployeeID', sql.VarChar(20), createBy);
    creatorReq.input('Fullname', sql.NVarChar(200), creatorFullname);
    creatorReq.input('Email', sql.NVarChar(200), creatorEmail);
    creatorReq.input('UserGroupNo', sql.VarChar(2), creatorUserGroupNo);
    creatorReq.input('AuditStatus', sql.Int, 2);
    creatorReq.input('UnitSide', sql.NVarChar(50), null);
    await creatorReq.execute('mp_DocumentItemsInsert');
};

const insertApproverDocumentItem = async (
    transaction: sql.Transaction,
    documentNo: string,
    itemId: string,
    approver: ApproverPayload
) => {
    const itemReq = new sql.Request(transaction);
    itemReq.input('DocumentNo', sql.VarChar(13), documentNo);
    itemReq.input('ItemID', sql.VarChar(10), itemId);
    itemReq.input('Seqno', sql.Int, approver.seqno);
    itemReq.input('EmployeeID', sql.VarChar(20), approver.employeeId);
    itemReq.input('Fullname', sql.NVarChar(200), approver.fullname);
    itemReq.input('Email', sql.NVarChar(200), approver.email);
    itemReq.input('UserGroupNo', sql.VarChar(2), approver.userGroupNo || null);
    itemReq.input('UnitSide', sql.NVarChar(50), approver.unitSide || null);
    itemReq.input('AuditStatus', sql.Int, approver.seqno === 1 ? 1 : 0);
    await itemReq.execute('mp_DocumentItemsInsert');
};

const setSubmittedTransactionStatus = async (
    transaction: sql.Transaction,
    itemId: string,
    createBy: string,
    today: Date
) => {
    const trUpdateReq = new sql.Request(transaction);
    trUpdateReq.input('TransactionNo', sql.VarChar(10), itemId);
    trUpdateReq.input('Status', sql.Int, 2);
    trUpdateReq.input('UpdateBy', sql.VarChar(20), createBy);
    trUpdateReq.input('UpdateDate', sql.DateTime, today);
    await trUpdateReq.execute('mp_TransactionsUpdateStatus');
};

const verifySubmittedTransactionStatus = async (transaction: sql.Transaction, itemId: string) => {
    const verifyReq = new sql.Request(transaction);
    verifyReq.input('TransactionNo', sql.VarChar(10), itemId);
    const verifyRes = await verifyReq.query(`
        SELECT TOP 1 Status
        FROM MP_Transactions WITH (NOLOCK)
        WHERE TransactionNo = @TransactionNo
    `);
    const updatedStatus = Number(verifyRes.recordset?.[0]?.Status);
    if (updatedStatus !== 2) {
        throw new Error('Failed to update transaction status to 2 for itemId "' + itemId + '"');
    }
};

const insertSubmitDocumentItems = async (
    transaction: sql.Transaction,
    payload: SubmitDocumentPayload,
    documentNo: string,
    createBy: string,
    creatorFullname: string,
    creatorEmail: string | null,
    today: Date
) => {
    const creatorUserGroupNo = payload.userGroupNo || null;
    for (const item of payload.items) {
        const itemId = validateSubmitDocumentItemId(item?.itemId);
        await insertCreatorDocumentItem(transaction, documentNo, itemId, createBy, creatorFullname, creatorEmail, creatorUserGroupNo);

        for (const approver of item.approvers) {
            await insertApproverDocumentItem(transaction, documentNo, itemId, approver);
        }

        await setSubmittedTransactionStatus(transaction, itemId, createBy, today);
        await verifySubmittedTransactionStatus(transaction, itemId);
    }
};

const notifySubmitDocumentFirstApprovers = async (
    pool: sql.ConnectionPool,
    payload: SubmitDocumentPayload,
    documentNo: string,
    creatorFullname: string,
    createBy: string
) => {
    try {
        const loginUrl = 'http://localhost:3000/login';
        const transactionRows = await getTransactionRowsByNos(pool, payload.items.map((item) => item.itemId));
        const rowByNo = new Map<string, MailTransactionRow>(
            transactionRows.map((row) => [row.transactionNo, row])
        );
        const firstApproverGroups = buildSubmitFirstApproverMailGroups(payload.items);

        for (const group of firstApproverGroups) {
            const recipient = await resolveMailRecipient('SendMailTrans', group.requestedEmail);
            const subject = '[PTTSWP] Transaction: มีการเปลี่ยนแปลงกรอบอัตรากำลัง ส่งมาให้ตรวจสอบ';
            const rows = group.itemIds.map((itemNo) =>
                rowByNo.get(itemNo) || { transactionNo: itemNo, transactionTypeText: '-', transactionDesc: '-' }
            );
            const body = buildTransactionReviewBody({
                recipientName: group.recipientName || group.requestedEmail,
                senderName: creatorFullname,
                documentNo,
                rows,
                addressLoginUrl: loginUrl
            });
            await sendMailWithLog({
                recipient,
                requestedRecipient: group.requestedEmail,
                subject,
                body,
                sendFromBy: createBy,
                sendToBy: group.recipientEmployeeId,
                refNo: documentNo,
                context: 'submitDocumentService'
            });
        }
    } catch (mailError) {
        console.error('Email notification failed in submitDocumentService:', mailError);
        // We don't throw here to ensure the transaction commit is not affected by email failure
    }
};

export const submitDocumentService = async (payload: SubmitDocumentPayload, createBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const today = new Date();
            const documentNo = await getNextDocumentNo(transaction, today);
            const effectiveDate = await resolveDocumentEffectiveDateFromItems(
                transaction,
                payload.items.map((item) => item.itemId),
                today
            );
            await insertDocumentHeader(transaction, payload, documentNo, effectiveDate, today, createBy);
            const { creatorFullname, creatorEmail } = await getDocumentCreatorInfo(transaction, createBy);
            await insertSubmitDocumentItems(transaction, payload, documentNo, createBy, creatorFullname, creatorEmail, today);
            await resetSentSapStatusForTransactions(transaction, payload.items.map((item) => item.itemId));
            await transaction.commit();
            await notifySubmitDocumentFirstApprovers(pool, payload, documentNo, creatorFullname, createBy);
            return { success: true, documentNo, message: 'Document submitted successfully' };
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {}
            throw error;
        }
    } catch (error) {
        console.error('Error in submitDocumentService:', error);
        throw error;
    }
};

export const getInboxService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('EmployeeID', sql.VarChar(20), employeeId);
        req.input('AuditStatus', sql.Int, 1); // Active
        
        const result = await req.execute('mp_InboxGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error in getInboxService:', error);
        throw error;
    }
};

export const getInboxCountService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('EmployeeID', sql.VarChar(20), employeeId);
        req.input('AuditStatus', sql.Int, 1); // Active
        
        const result = await req.execute('mp_InboxCountGet');
        return result.recordset?.[0]?.UnreadCount || 0;
    } catch (error) {
        console.error('Error in getInboxCountService:', error);
        throw error;
    }
};

const updateDocumentItemAuditStatus = async (
    transaction: sql.Transaction,
    documentNo: string,
    itemId: string,
    seqno: number,
    auditStatus: number,
    auditDate: Date | null
) => {
    const request = new sql.Request(transaction);
    request.input('DocumentNo', sql.VarChar(13), documentNo);
    request.input('ItemID', sql.VarChar(10), itemId);
    request.input('Seqno', sql.Int, seqno);
    request.input('AuditStatus', sql.Int, auditStatus);
    request.input('AuditDate', sql.DateTime, auditDate);
    await request.execute('mp_DocumentItemsUpdateAuditStatus');
};

const getNextDocumentApprover = async (
    transaction: sql.Transaction,
    documentNo: string,
    itemId: string,
    seqno: number
) => {
    const nextSeqnoReq = new sql.Request(transaction);
    nextSeqnoReq.input('DocumentNo', sql.VarChar(13), documentNo);
    nextSeqnoReq.input('ItemID', sql.VarChar(10), itemId);
    nextSeqnoReq.input('Seqno', sql.Int, seqno + 1);
    const nextSeqnoRes = await nextSeqnoReq.execute('mp_DocumentNextSeqnoGet');
    return nextSeqnoRes.recordset?.[0] || null;
};

const setDocumentApprovedStatus = async (
    transaction: sql.Transaction,
    documentNo: string,
    updateBy: string,
    today: Date
) => {
    const docUpdateReq = new sql.Request(transaction);
    docUpdateReq.input('DocumentNo', sql.VarChar(13), documentNo);
    docUpdateReq.input('DocumentStatus', sql.Int, 2);
    docUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
    docUpdateReq.input('UpdateDate', sql.DateTime, today);
    await docUpdateReq.execute('mp_DocumentUpdateStatus');
};

const finalizeApprovedTransactions = async (
    transaction: sql.Transaction,
    documentNo: string,
    updateBy: string,
    today: Date
) => {
    const approvedItemsReq = new sql.Request(transaction);
    approvedItemsReq.input('DocumentNo', sql.VarChar(13), documentNo);
    const approvedItemsRes = await approvedItemsReq.execute('mp_DocumentApprovedItemsGet');

    for (const row of approvedItemsRes.recordset || []) {
        const trUpdateReq = new sql.Request(transaction);
        trUpdateReq.input('TransactionNo', sql.VarChar(10), row.ItemID);
        trUpdateReq.input('Status', sql.Int, 3);
        trUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
        trUpdateReq.input('UpdateDate', sql.DateTime, today);
        await trUpdateReq.execute('mp_TransactionsUpdateStatus');
    }
};

const finalizeDocumentIfFullyApproved = async (
    transaction: sql.Transaction,
    documentNo: string,
    updateBy: string,
    today: Date
) => {
    const checkDocReq = new sql.Request(transaction);
    checkDocReq.input('DocumentNo', sql.VarChar(13), documentNo);
    const checkDocRes = await checkDocReq.execute('mp_DocumentPendingCheck');
    if (checkDocRes.recordset && checkDocRes.recordset.length > 0) return;

    await setDocumentApprovedStatus(transaction, documentNo, updateBy, today);
    await finalizeApprovedTransactions(transaction, documentNo, updateBy, today);
};

const approveDocumentInsideTransaction = async (
    transaction: sql.Transaction,
    documentNo: string,
    itemId: string,
    seqno: number,
    updateBy: string,
    today: Date
) => {
    await updateDocumentItemAuditStatus(transaction, documentNo, itemId, seqno, 2, today);
    const nextApprover = await getNextDocumentApprover(transaction, documentNo, itemId, seqno);
    if (nextApprover) {
        await updateDocumentItemAuditStatus(transaction, documentNo, itemId, seqno + 1, 1, null);
    } else {
        await finalizeDocumentIfFullyApproved(transaction, documentNo, updateBy, today);
    }
    return nextApprover;
};

const getDocumentActorName = async (pool: sql.ConnectionPool, employeeId: string) => {
    const actorReq = new sql.Request(pool);
    actorReq.input('EmployeeID', sql.VarChar(20), employeeId);
    const actorRes = await actorReq.execute('mp_UserInfoGet');
    return actorRes.recordset?.[0]?.FullName || employeeId;
};

const notifyNextDocumentApprover = async (
    pool: sql.ConnectionPool,
    nextApprover: any,
    documentNo: string,
    itemId: string,
    updateBy: string
) => {
    if (!nextApprover?.Email) return;

    const recipient = await resolveMailRecipient('SendMailTrans', nextApprover.Email);
    const actorName = await getDocumentActorName(pool, updateBy);
    const transactionRows = await getTransactionRowsByNos(pool, [itemId]);
    const selectedRow = transactionRows[0] || { transactionNo: itemId, transactionTypeText: '-', transactionDesc: '-' };
    const subject = '[PTTSWP] Transaction: มีการเปลี่ยนแปลงกรอบอัตรากำลัง ส่งมาให้ตรวจสอบ';
    const body = buildTransactionReviewBody({
        recipientName: nextApprover.Fullname || nextApprover.FullnameTH || '-',
        senderName: actorName,
        documentNo,
        rows: [selectedRow],
        addressLoginUrl: 'http://localhost:3000/login'
    });

    await sendMailWithLog({
        recipient,
        requestedRecipient: nextApprover.Email,
        subject,
        body,
        sendFromBy: updateBy,
        sendToBy: nextApprover.EmployeeID || nextApprover.EmployeeId || null,
        refNo: documentNo,
        context: 'approveDocumentService'
    });
};

const notifyApprovedDocumentRequester = async (
    pool: sql.ConnectionPool,
    documentNo: string,
    itemId: string,
    updateBy: string
) => {
    const requester = await getDocumentRequester(pool, documentNo, itemId);
    if (!requester?.Email) return;

    const recipient = await resolveMailRecipient('SendMailTrans', requester.Email);
    const subject = '[PTTSWP] คำขอ ' + documentNo + ' ได้รับการอนุมัติครบถ้วนแล้ว';
    const body = `
        <h2>แจ้งเตือนสถานะคำขอระบบ PTTSWP</h2>
        <p>เรียน คุณ ${requester.Fullname},</p>
        <p>คำขอหมายเลข <b>${documentNo}</b> (รายการ: ${itemId}) ของท่านได้รับการอนุมัติเรียบร้อยแล้ว</p>
        <p>โปรดตรวจสอบรายละเอียดที่: <a href="http://localhost:3000/mkd/my-requests">My Requests</a></p>
        <hr/>
        <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ</p>
    `;
    await sendMailWithLog({
        recipient,
        requestedRecipient: requester.Email,
        subject,
        body,
        sendFromBy: updateBy,
        sendToBy: requester.EmployeeID || requester.EmployeeId || null,
        refNo: documentNo,
        context: 'approveDocumentService'
    });
};

const notifyApprovedDocumentResult = async (
    pool: sql.ConnectionPool,
    nextApprover: any,
    documentNo: string,
    itemId: string,
    updateBy: string
) => {
    try {
        if (nextApprover) {
            await notifyNextDocumentApprover(pool, nextApprover, documentNo, itemId, updateBy);
        } else {
            await notifyApprovedDocumentRequester(pool, documentNo, itemId, updateBy);
        }
    } catch (mailError) {
        console.error('Email notification failed in approveDocumentService:', mailError);
    }
};

export const approveDocumentService = async (documentNo: string, itemId: string, seqno: number, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const today = new Date();
            const nextApprover = await approveDocumentInsideTransaction(transaction, documentNo, itemId, seqno, updateBy, today);
            await transaction.commit();
            await notifyApprovedDocumentResult(pool, nextApprover, documentNo, itemId, updateBy);
            return { success: true, message: 'Approved successfully' };
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {}
            throw error;
        }
    } catch (error) {
        console.error('Error in approveDocumentService:', error);
        throw error;
    }
};

const rejectDocumentItemAudit = async (
    transaction: sql.Transaction,
    documentNo: string,
    itemId: string,
    seqno: number,
    today: Date
) => {
    const updateCurrentReq = new sql.Request(transaction);
    updateCurrentReq.input('DocumentNo', sql.VarChar(13), documentNo);
    updateCurrentReq.input('ItemID', sql.VarChar(10), itemId);
    updateCurrentReq.input('Seqno', sql.Int, seqno);
    updateCurrentReq.input('AuditStatus', sql.Int, -1);
    updateCurrentReq.input('AuditDate', sql.DateTime, today);
    await updateCurrentReq.execute('mp_DocumentItemsUpdateAuditStatus');

    const updateFutureReq = new sql.Request(transaction);
    updateFutureReq.input('DocumentNo', sql.VarChar(13), documentNo);
    updateFutureReq.input('ItemID', sql.VarChar(10), itemId);
    updateFutureReq.input('Seqno', sql.Int, seqno);
    updateFutureReq.input('AuditDate', sql.DateTime, today);
    await updateFutureReq.execute('mp_DocumentItemsFutureRejectUpdate');
};

const insertDocumentRejectRemark = async (
    transaction: sql.Transaction,
    documentNo: string,
    itemId: string,
    remark: string,
    updateBy: string,
    today: Date
) => {
    const remarkReq = new sql.Request(transaction);
    remarkReq.input('DocumentNo', sql.VarChar(13), documentNo);
    remarkReq.input('ItemID', sql.VarChar(10), itemId);
    remarkReq.input('Remark', sql.NVarChar(500), remark);
    remarkReq.input('CreateBy', sql.VarChar(20), updateBy);
    remarkReq.input('CreateDate', sql.DateTime, today);
    await remarkReq.execute('mp_DocumentRemarkInsert');
};

const updateRejectedTransactionStatus = async (
    transaction: sql.Transaction,
    itemId: string,
    updateBy: string,
    today: Date
) => {
    const trUpdateReq = new sql.Request(transaction);
    trUpdateReq.input('TransactionNo', sql.VarChar(10), itemId);
    trUpdateReq.input('Status', sql.Int, 0);
    trUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
    trUpdateReq.input('UpdateDate', sql.DateTime, today);
    await trUpdateReq.execute('mp_TransactionsUpdateStatus');
};

const setDocumentStatusAfterReject = async (
    transaction: sql.Transaction,
    documentNo: string,
    updateBy: string,
    today: Date,
    isAllRejected: boolean
) => {
    const docUpdateReq = new sql.Request(transaction);
    docUpdateReq.input('DocumentNo', sql.VarChar(13), documentNo);
    docUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
    docUpdateReq.input('UpdateDate', sql.DateTime, today);
    docUpdateReq.input('DocumentStatus', sql.Int, isAllRejected ? 0 : 2);
    await docUpdateReq.execute('mp_DocumentUpdateStatus');
};

const finalizeApprovedTransactionsAfterMixedReject = async (
    transaction: sql.Transaction,
    documentNo: string,
    updateBy: string,
    today: Date
) => {
    const approvedItemsReq = new sql.Request(transaction);
    approvedItemsReq.input('DocumentNo', sql.VarChar(13), documentNo);
    const approvedItemsRes = await approvedItemsReq.execute('mp_DocumentApprovedItemsGet');

    for (const row of approvedItemsRes.recordset || []) {
        const approvedTrReq = new sql.Request(transaction);
        approvedTrReq.input('TransactionNo', sql.VarChar(10), row.ItemID);
        approvedTrReq.input('Status', sql.Int, 3);
        approvedTrReq.input('UpdateBy', sql.VarChar(20), updateBy);
        approvedTrReq.input('UpdateDate', sql.DateTime, today);
        await approvedTrReq.execute('mp_TransactionsUpdateStatus');
    }
};

const finalizeDocumentAfterRejectIfComplete = async (
    transaction: sql.Transaction,
    documentNo: string,
    updateBy: string,
    today: Date
) => {
    const checkDocReq = new sql.Request(transaction);
    checkDocReq.input('DocumentNo', sql.VarChar(13), documentNo);
    const checkDocRes = await checkDocReq.execute('mp_DocumentPendingCheck');
    if (checkDocRes.recordset && checkDocRes.recordset.length > 0) return;

    const allRejectedRes = await checkDocReq.execute('mp_DocumentAllRejectedCheck');
    const isAllRejected = !allRejectedRes.recordset || allRejectedRes.recordset.length === 0;
    await setDocumentStatusAfterReject(transaction, documentNo, updateBy, today, isAllRejected);

    if (!isAllRejected) {
        await finalizeApprovedTransactionsAfterMixedReject(transaction, documentNo, updateBy, today);
    }
};

const rejectDocumentInsideTransaction = async (
    transaction: sql.Transaction,
    documentNo: string,
    itemId: string,
    seqno: number,
    remark: string,
    updateBy: string,
    today: Date
) => {
    await rejectDocumentItemAudit(transaction, documentNo, itemId, seqno, today);
    await insertDocumentRejectRemark(transaction, documentNo, itemId, remark, updateBy, today);
    await updateRejectedTransactionStatus(transaction, itemId, updateBy, today);
    await finalizeDocumentAfterRejectIfComplete(transaction, documentNo, updateBy, today);
};

const getDocumentRequester = async (pool: sql.ConnectionPool, documentNo: string, itemId: string) => {
    const requesterReq = new sql.Request(pool);
    requesterReq.input('DocumentNo', sql.VarChar(13), documentNo);
    requesterReq.input('ItemID', sql.VarChar(10), itemId);
    const requesterRes = await requesterReq.query(`
        SELECT TOP 1
            EmployeeID,
            Fullname,
            Email
        FROM MP_DocumentItems WITH (NOLOCK)
        WHERE DocumentNo = @DocumentNo
          AND ItemID = @ItemID
          AND Seqno = 0
    `);
    return requesterRes.recordset?.[0] || null;
};

const notifyRejectedDocumentRequester = async (
    pool: sql.ConnectionPool,
    documentNo: string,
    itemId: string,
    remark: string,
    updateBy: string
) => {
    try {
        const requester = await getDocumentRequester(pool, documentNo, itemId);
        if (!requester?.Email) return;

        const recipient = await resolveMailRecipient('SendMailTrans', requester.Email);
        const subject = `[PTTSWP] คำขอ ${documentNo} ถูกส่งคืน (Rejected)`;
        const body = `
            <h2>แจ้งเตือนการส่งคืนคำขอระบบ PTTSWP</h2>
            <p>เรียน คุณ ${requester.Fullname},</p>
            <p>คำขอหมายเลข <b>${documentNo}</b> (รายการ: ${itemId}) ของท่านถูกส่งคืน/ไม่ได้รับการอนุมัติ</p>
            <p><b>เหตุผล:</b> ${remark}</p>
            <p>โปรดตรวจสอบและแก้ไขได้ที่: <a href="http://localhost:3000/mkd/my-requests">My Requests</a></p>
            <hr/>
            <p style="color: gray; font-size: 12px;">นี่คือระบบเมลอัตโนมัติ</p>
        `;
        await sendMailWithLog({
            recipient,
            requestedRecipient: requester.Email,
            subject,
            body,
            sendFromBy: updateBy,
            sendToBy: requester.EmployeeID || requester.EmployeeId || null,
            refNo: documentNo,
            context: 'rejectDocumentService'
        });
    } catch (mailError) {
        console.error('Email notification failed in rejectDocumentService:', mailError);
    }
};

export const rejectDocumentService = async (documentNo: string, itemId: string, seqno: number, remark: string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const today = new Date();
            await rejectDocumentInsideTransaction(transaction, documentNo, itemId, seqno, remark, updateBy, today);
            await transaction.commit();
            await notifyRejectedDocumentRequester(pool, documentNo, itemId, remark, updateBy);
            return { success: true, message: 'Rejected transaction successfully.' };
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {}
            throw error;
        }
    } catch (error) {
        console.error('Error in rejectDocumentService:', error);
        throw error;
    }
};

export const getMyRequestsService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        
        req.input('EmployeeID', sql.VarChar(20), employeeId);
        
        const result = await req.execute('mp_MyRequestsGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error in getMyRequestsService:', error);
        throw error;
    }
};

export const getDocumentDetailService = async (documentNo: string, employeeId: string) => {
    try {
        const pool = await poolPromise;
        const req = new sql.Request(pool);
        req.input('DocumentNo', sql.VarChar(13), documentNo);

        // Get document info
        const docRes = await req.execute('mp_DocumentInfoGet');
        if (!docRes.recordset?.length) return null;
        const document = docRes.recordset[0];

        const itemsReq = new sql.Request(pool);
        itemsReq.input('DocumentNo', sql.VarChar(13), documentNo);
        itemsReq.input('EmployeeID', sql.VarChar(20), employeeId);
        const itemsRes = await itemsReq.execute('mp_DocumentItemsDetailGet');

        const logsReq = new sql.Request(pool);
        logsReq.input('DocumentNo', sql.VarChar(13), documentNo);
        const logsRes = await logsReq.execute('mp_DocumentLogsGet');

        // Active approval rows for current viewer (source of truth for enabling Accept/Reject)
        const myActiveReq = new sql.Request(pool);
        myActiveReq.input('DocumentNo', sql.VarChar(13), documentNo);
        myActiveReq.input('EmployeeID', sql.VarChar(20), employeeId);
        const myActiveRes = await myActiveReq.query(`
            SELECT ItemID, Seqno, EmployeeID, AuditStatus, UnitSide
            FROM MP_DocumentItems WITH (NOLOCK)
            WHERE DocumentNo = @DocumentNo
              AND EmployeeID = @EmployeeID
              AND AuditStatus = 1
        `);

        return {
            document,
            items: itemsRes.recordset || [],
            logs: logsRes.recordset || [],
            myActiveApprovals: myActiveRes.recordset || []
        };
    } catch (error) {
        console.error('Error in getDocumentDetailService:', error);
        throw error;
    }
};

export const rejectAllDocumentService = async (documentNo: string, remark: string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const today = new Date();

        try {
            // 1. Update Document Status to -1 (Rejected All)
            const docReq = new sql.Request(transaction);
            docReq.input('DocumentNo', sql.VarChar(13), documentNo);
            docReq.input('DocumentStatus', sql.Int, -1);
            docReq.input('UpdateBy', sql.VarChar(20), updateBy);
            docReq.input('UpdateDate', sql.DateTime, today);
            await docReq.execute('mp_DocumentUpdateStatus');

            // 2. Fetch all Items in Document
            const itemsReq = new sql.Request(transaction);
            itemsReq.input('DocumentNo', sql.VarChar(13), documentNo);
            const itemsRes = await itemsReq.query('SELECT DISTINCT ItemID FROM MP_DocumentItems WHERE DocumentNo = @DocumentNo');
            
            if (itemsRes.recordset && itemsRes.recordset.length > 0) {
                // 3. For each item:
                //    - mark current/future approvers as rejected (to keep logs consistent with single-item reject)
                //    - insert remark
                //    - update transaction status to 0
                for (const row of itemsRes.recordset) {
                    const itemId = row.ItemID;

                    // Find the first pending/active seq (if exists) for this item
                    const pendingSeqReq = new sql.Request(transaction);
                    pendingSeqReq.input('DocumentNo', sql.VarChar(13), documentNo);
                    pendingSeqReq.input('ItemID', sql.VarChar(10), itemId);
                    pendingSeqReq.input('UpdateBy', sql.VarChar(20), updateBy);
                    const pendingSeqRes = await pendingSeqReq.query(`
                        SELECT TOP 1 Seqno
                        FROM MP_DocumentItems WITH (NOLOCK)
                        WHERE DocumentNo = @DocumentNo
                          AND ItemID = @ItemID
                          AND AuditStatus IN (0, 1)
                        ORDER BY
                          CASE
                            WHEN AuditStatus = 1 AND EmployeeID = @UpdateBy THEN 0
                            WHEN AuditStatus = 1 THEN 1
                            ELSE 2
                          END,
                          Seqno ASC
                    `);

                    const pendingSeqno = Number(pendingSeqRes.recordset?.[0]?.Seqno);
                    if (Number.isFinite(pendingSeqno) && pendingSeqno >= 0) {
                        // Mark current seq as rejected
                        const updateCurrentReq = new sql.Request(transaction);
                        updateCurrentReq.input('DocumentNo', sql.VarChar(13), documentNo);
                        updateCurrentReq.input('ItemID', sql.VarChar(10), itemId);
                        updateCurrentReq.input('Seqno', sql.Int, pendingSeqno);
                        updateCurrentReq.input('AuditStatus', sql.Int, -1);
                        updateCurrentReq.input('AuditDate', sql.DateTime, today);
                        await updateCurrentReq.execute('mp_DocumentItemsUpdateAuditStatus');

                        // Mark future seq(s) as rejected
                        const updateFutureReq = new sql.Request(transaction);
                        updateFutureReq.input('DocumentNo', sql.VarChar(13), documentNo);
                        updateFutureReq.input('ItemID', sql.VarChar(10), itemId);
                        updateFutureReq.input('Seqno', sql.Int, pendingSeqno);
                        updateFutureReq.input('AuditDate', sql.DateTime, today);
                        await updateFutureReq.execute('mp_DocumentItemsFutureRejectUpdate');
                    }

                    // Insert Remark per item
                    const rmReq = new sql.Request(transaction);
                    rmReq.input('DocumentNo', sql.VarChar(13), documentNo);
                    rmReq.input('ItemID', sql.VarChar(10), itemId);
                    rmReq.input('Remark', sql.NVarChar(500), remark);
                    rmReq.input('CreateBy', sql.VarChar(10), updateBy);
                    rmReq.input('CreateDate', sql.DateTime, today);
                    await rmReq.execute('mp_DocumentRemarkInsert');

                    // Update MP_Transactions.Status = 0
                    const trUpdateReq = new sql.Request(transaction);
                    trUpdateReq.input('TransactionNo', sql.VarChar(10), itemId);
                    trUpdateReq.input('Status', sql.VarChar(20), '0');
                    trUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
                    trUpdateReq.input('UpdateDate', sql.DateTime, today);
                    await trUpdateReq.execute('mp_TransactionsUpdateStatus');
                }
            }

            await transaction.commit();
            return { success: true, message: 'All items rejected successfully' };
        } catch (error) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {}
            throw error;
        }
    } catch (error) {
        console.error('Error in rejectAllDocumentService:', error);
        throw error;
    }
};

type DocumentLogRow = { AuditStatus?: number; UserGroupName?: string };

const loadDocumentListWithOptionalEmployee = async (
    pool: sql.ConnectionPool,
    procedureName: string,
    employeeId: string
) => {
    try {
        const req = new sql.Request(pool);
        req.input('EmployeeID', sql.VarChar(20), employeeId);
        return await req.execute(procedureName);
    } catch (error: any) {
        const message = String(error?.message || '');
        if (!message.includes('has no parameters and arguments were supplied')) {
            throw error;
        }

        // Fallback for DB where this SP has no input parameters
        const reqNoParam = new sql.Request(pool);
        return reqNoParam.execute(procedureName);
    }
};

const getDocumentItemsForProgress = async (pool: sql.ConnectionPool, documentNo: string) => {
    const itemsReq = new sql.Request(pool);
    itemsReq.input('DocumentNo', sql.VarChar(13), documentNo);
    itemsReq.input('EmployeeID', sql.VarChar(20), null);
    return itemsReq.execute('mp_DocumentItemsDetailGet');
};

const getDocumentProgressLogsByQuery = async (pool: sql.ConnectionPool, documentNo: string) => {
    const logsReq = new sql.Request(pool);
    logsReq.input('DocumentNo', sql.VarChar(13), documentNo);
    const logsQuery = `
        SELECT DISTINCT
            di.Seqno,
            di.EmployeeID,
            di.Fullname,
            di.AuditStatus,
            di.AuditDate,
            di.UserGroupNo,
            di.UnitSide,
            ug.UserGroupName
        FROM MP_DocumentItems di
        LEFT JOIN MP_UserGroup ug ON di.UserGroupNo = ug.UserGroupNo
        WHERE di.DocumentNo = @DocumentNo
        ORDER BY di.Seqno ASC
    `;
    return logsReq.query(logsQuery);
};

const getDocumentLogsByProcedure = async (pool: sql.ConnectionPool, documentNo: string) => {
    const logsReq = new sql.Request(pool);
    logsReq.input('DocumentNo', sql.VarChar(13), documentNo);
    return logsReq.execute('mp_DocumentLogsGet');
};

const resolveDocumentProcessStage = (logs: DocumentLogRow[] = []) => {
    const hasActive = logs.some((log) => log.AuditStatus === 1);
    const allDone = logs.every((log) => log.AuditStatus === 2 || log.AuditStatus === -1);

    if (allDone && logs.length > 0) return 3;
    if (hasActive) return 2;
    return 1;
};

const getWaitingApproverLabel = (logs: DocumentLogRow[] = []) => {
    const activeApprover = logs.find((log) => log.AuditStatus === 1);
    return activeApprover?.UserGroupName ? 'Waiting ' + activeApprover.UserGroupName : 'Waiting';
};

const getProgressStatusLabel = (logs: DocumentLogRow[], processStage: number) => {
    if (processStage === 3) return 'Complete';
    return getWaitingApproverLabel(logs);
};

const getAllTransactionStatusLabel = (doc: Record<string, unknown>, logs: DocumentLogRow[], processStage: number) => {
    if (doc.DocumentStatus === -1) return 'Rejected';
    if (processStage === 3) return 'Complete';
    return getWaitingApproverLabel(logs);
};

const buildProgressDocumentRow = async (pool: sql.ConnectionPool, doc: Record<string, any>) => {
    const docNo = doc.DocumentNo;
    const itemsRes = await getDocumentItemsForProgress(pool, docNo);
    const logsRes = await getDocumentProgressLogsByQuery(pool, docNo);
    const logs = logsRes.recordset || [];
    const processStage = resolveDocumentProcessStage(logs);
    const firstItem = itemsRes.recordset?.[0];
    const orgFilters = await resolveDocumentOrgFilters(
        pool,
        (firstItem || {}) as Record<string, unknown>,
        doc.EffectiveDate
    );

    return {
        documentNo: docNo,
        effectiveDate: doc.EffectiveDate,
        documentType: doc.DocumentType,
        createDate: doc.CreateDate,
        createBy: doc.CreateBy,
        statusLabel: getProgressStatusLabel(logs, processStage),
        processStage,
        category: getDocumentCategory(firstItem?.TransactionType),
        typeCategory: getDocumentTypeCategory(firstItem?.TransactionType),
        resolution: firstItem?.TransactionDesc || '',
        businessUnitId: orgFilters.businessUnitId,
        businessUnitName: orgFilters.businessUnitName,
        divisionId: orgFilters.divisionId,
        divisionName: orgFilters.divisionName,
        agencyId: orgFilters.agencyId,
        agencyName: orgFilters.agencyName,
        items: itemsRes.recordset || [],
        logs
    };
};

const buildAllTransactionDocumentRow = async (pool: sql.ConnectionPool, doc: Record<string, any>) => {
    const docNo = doc.DocumentNo;
    const itemsRes = await getDocumentItemsForProgress(pool, docNo);
    const logsRes = await getDocumentLogsByProcedure(pool, docNo);
    const logs = logsRes.recordset || [];
    const processStage = resolveDocumentProcessStage(logs);
    const firstItem = itemsRes.recordset?.[0];

    return {
        documentNo: docNo,
        effectiveDate: doc.EffectiveDate,
        documentType: doc.DocumentType,
        createDate: doc.CreateDate,
        createBy: doc.CreateBy,
        statusLabel: getAllTransactionStatusLabel(doc, logs, processStage),
        processStage,
        category: getDocumentCategory(firstItem?.TransactionType),
        typeCategory: getDocumentTypeCategory(firstItem?.TransactionType),
        resolution: firstItem?.TransactionDesc || '',
        items: itemsRes.recordset || [],
        logs
    };
};

export const getProgressService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const docsRes = await loadDocumentListWithOptionalEmployee(pool, 'mp_DocumentProgressListGet', employeeId);
        if (!docsRes.recordset?.length) return [];

        const results = [];
        for (const doc of docsRes.recordset) {
            results.push(await buildProgressDocumentRow(pool, doc));
        }

        return results;
    } catch (error) {
        console.error('Error in getProgressService:', error);
        throw error;
    }
};

export const getAllTransactionsService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const docsRes = await loadDocumentListWithOptionalEmployee(pool, 'mp_AllDocumentsGet', employeeId);
        if (!docsRes.recordset?.length) return [];

        const results = [];
        for (const doc of docsRes.recordset) {
            results.push(await buildAllTransactionDocumentRow(pool, doc));
        }

        return results;
    } catch (error) {
        console.error('Error in getAllTransactionsService:', error);
        throw error;
    }
};
