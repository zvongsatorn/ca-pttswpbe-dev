import { sql, poolPromise } from '../config/db.js';
import { sendMail, resolveMailRecipient } from './mailService.js';
import { createMailLog } from './mailLogService.js';

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

const buildSubmitFirstApproverMailGroups = (items: DocumentItemPayload[]): SubmitFirstApproverMailGroup[] => {
    const groups = new Map<string, {
        requestedEmail: string;
        recipientName: string;
        recipientEmployeeId: string | null;
        itemIdSet: Set<string>;
    }>();

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

        const existing = groups.get(key);
        if (existing) {
            existing.itemIdSet.add(itemId);
            if (!existing.recipientName && recipientName) {
                existing.recipientName = recipientName;
            }
            if (!existing.requestedEmail && requestedEmail) {
                existing.requestedEmail = requestedEmail;
            }
            continue;
        }

        groups.set(key, {
            requestedEmail,
            recipientName,
            recipientEmployeeId: recipientEmployeeId || null,
            itemIdSet: new Set([itemId])
        });
    }

    return Array.from(groups.values()).map((group) => ({
        requestedEmail: group.requestedEmail,
        recipientName: group.recipientName,
        recipientEmployeeId: group.recipientEmployeeId,
        itemIds: Array.from(group.itemIdSet)
    }));
};

export const submitDocumentService = async (payload: SubmitDocumentPayload, createBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Generate DocumentNo DA + YY + MM + Running
            const today = new Date();
            const adYY = today.getFullYear().toString().slice(-2);
            const mm = (today.getMonth() + 1).toString().padStart(2, '0');
            const prefix = `DA${adYY}${mm}`;

            const lastDocReq = new sql.Request(transaction);
            lastDocReq.input('Prefix', sql.VarChar(10), prefix);
            const lastDocRes = await lastDocReq.execute('mp_DocumentLastNoGet');

            let runningNumber = 1;
            if (lastDocRes.recordset && lastDocRes.recordset.length > 0 && lastDocRes.recordset[0].DocumentNo) {
                const lastDocNo = lastDocRes.recordset[0].DocumentNo; 
                const lastRunningStr = lastDocNo.substring(prefix.length); 
                if (!isNaN(parseInt(lastRunningStr))) {
                    runningNumber = parseInt(lastRunningStr) + 1;
                }
            }
            
            const documentNo = `${prefix}${runningNumber.toString().padStart(4, '0')}`;
            const effectiveDate = today;

            // 1. mp_DocumentInsert
            const docReq = new sql.Request(transaction);
            docReq.input('DocumentNo', sql.VarChar(13), documentNo);
            docReq.input('EffectiveDate', sql.DateTime, effectiveDate);
            docReq.input('DocumentType', sql.Int, payload.documentType);
            docReq.input('CreateBy', sql.VarChar(20), createBy);
            docReq.input('CreateDate', sql.DateTime, today);
            docReq.input('ParentDocumentNo', sql.VarChar(13), payload.parentDocumentNo || null);
            await docReq.execute('mp_DocumentInsert');

            // 2. mp_DocumentItemsInsert for each Item and Approver
            // First, lookup creator info from MP_User
            const creatorInfoReq = new sql.Request(transaction);
            creatorInfoReq.input('EmployeeID', sql.VarChar(20), createBy);
            const creatorInfoRes = await creatorInfoReq.execute('mp_UserInfoGet');
            const creatorFullname = creatorInfoRes.recordset?.[0]?.FullName || createBy;
            const creatorEmail = creatorInfoRes.recordset?.[0]?.Email || null;
            const creatorUserGroupNo = payload.userGroupNo || null;

            for (const item of payload.items) {
                const itemId = String(item?.itemId || '').trim();
                if (!itemId) {
                    throw new Error('Invalid submit payload: itemId is required for every item');
                }
                if (itemId.length > 10) {
                    throw new Error(`Invalid submit payload: itemId "${itemId}" exceeds 10 characters`);
                }

                // Insert Creator (Seqno = 0)
                const creatorReq = new sql.Request(transaction);
                creatorReq.input('DocumentNo', sql.VarChar(13), documentNo);
                creatorReq.input('ItemID', sql.VarChar(10), itemId);
                creatorReq.input('Seqno', sql.Int, 0);
                creatorReq.input('EmployeeID', sql.VarChar(20), createBy);
                creatorReq.input('Fullname', sql.NVarChar(200), creatorFullname);
                creatorReq.input('Email', sql.NVarChar(200), creatorEmail);
                creatorReq.input('UserGroupNo', sql.VarChar(2), creatorUserGroupNo);
                creatorReq.input('AuditStatus', sql.Int, 2); // Auto-approved for creator
                creatorReq.input('UnitSide', sql.NVarChar(50), null);
                await creatorReq.execute('mp_DocumentItemsInsert');

                for (const approver of item.approvers) {
                    const itemReq = new sql.Request(transaction);
                    itemReq.input('DocumentNo', sql.VarChar(13), documentNo);
                    itemReq.input('ItemID', sql.VarChar(10), itemId);
                    itemReq.input('Seqno', sql.Int, approver.seqno);
                    itemReq.input('EmployeeID', sql.VarChar(20), approver.employeeId);
                    itemReq.input('Fullname', sql.NVarChar(200), approver.fullname);
                    itemReq.input('Email', sql.NVarChar(200), approver.email);
                    itemReq.input('UserGroupNo', sql.VarChar(2), approver.userGroupNo || null);
                    itemReq.input('UnitSide', sql.NVarChar(50), approver.unitSide || null);
                    
                    // Set AuditStatus = 1 for the first approver, else 0
                    const auditStatus = approver.seqno === 1 ? 1 : 0;
                    itemReq.input('AuditStatus', sql.Int, auditStatus);

                    await itemReq.execute('mp_DocumentItemsInsert');
                }

                const trUpdateReq = new sql.Request(transaction);
                trUpdateReq.input('TransactionNo', sql.VarChar(10), itemId);
                trUpdateReq.input('Status', sql.Int, 2);
                trUpdateReq.input('UpdateBy', sql.VarChar(20), createBy);
                trUpdateReq.input('UpdateDate', sql.DateTime, today);
                await trUpdateReq.execute('mp_TransactionsUpdateStatus');

                // Guard against silent submit success where transaction status was not actually updated.
                const verifyReq = new sql.Request(transaction);
                verifyReq.input('TransactionNo', sql.VarChar(10), itemId);
                const verifyRes = await verifyReq.query(`
                    SELECT TOP 1 Status
                    FROM MP_Transactions WITH (NOLOCK)
                    WHERE TransactionNo = @TransactionNo
                `);
                const updatedStatus = Number(verifyRes.recordset?.[0]?.Status);
                if (updatedStatus !== 2) {
                    throw new Error(`Failed to update transaction status to 2 for itemId "${itemId}"`);
                }
            }

            await transaction.commit();

            // Send notification emails to first approvers (Seqno 1)
            try {
                const loginUrl = 'http://localhost:3000/login';
                const transactionRows = await getTransactionRowsByNos(pool, payload.items.map((i) => i.itemId));
                const rowByNo = new Map<string, MailTransactionRow>(
                    transactionRows.map((r) => [r.transactionNo, r])
                );
                const firstApproverGroups = buildSubmitFirstApproverMailGroups(payload.items);

                for (const group of firstApproverGroups) {
                    const recipient = await resolveMailRecipient('SendMailTrans', group.requestedEmail);
                    const subject = `[PTTSWP] Transaction: มีการเปลี่ยนแปลงกรอบอัตรากำลัง ส่งมาให้ตรวจสอบ`;
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

export const approveDocumentService = async (documentNo: string, itemId: string, seqno: number, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const today = new Date();

            // 1. Update current approver to Accepted (2)
            const updateCurrentReq = new sql.Request(transaction);
            updateCurrentReq.input('DocumentNo', sql.VarChar(13), documentNo);
            updateCurrentReq.input('ItemID', sql.VarChar(10), itemId);
            updateCurrentReq.input('Seqno', sql.Int, seqno);
            updateCurrentReq.input('AuditStatus', sql.Int, 2); // 2 = Accepted
            updateCurrentReq.input('AuditDate', sql.DateTime, today);
            await updateCurrentReq.execute('mp_DocumentItemsUpdateAuditStatus');

            // 2. Check if there is a next approver
            const nextSeqnoReq = new sql.Request(transaction);
            nextSeqnoReq.input('DocumentNo', sql.VarChar(13), documentNo);
            nextSeqnoReq.input('ItemID', sql.VarChar(10), itemId);
            nextSeqnoReq.input('Seqno', sql.Int, seqno + 1);
            
            const nextSeqnoRes = await nextSeqnoReq.execute('mp_DocumentNextSeqnoGet');

            if (nextSeqnoRes.recordset && nextSeqnoRes.recordset.length > 0) {
                // Activate next approver
                const updateNextReq = new sql.Request(transaction);
                updateNextReq.input('DocumentNo', sql.VarChar(13), documentNo);
                updateNextReq.input('ItemID', sql.VarChar(10), itemId);
                updateNextReq.input('Seqno', sql.Int, seqno + 1);
                updateNextReq.input('AuditStatus', sql.Int, 1); // 1 = Active
                updateNextReq.input('AuditDate', sql.DateTime, null);
                await updateNextReq.execute('mp_DocumentItemsUpdateAuditStatus');
            } else {
                // Automatically check if all items in Document are completely approved
                const checkDocReq = new sql.Request(transaction);
                checkDocReq.input('DocumentNo', sql.VarChar(13), documentNo);
                const checkDocRes = await checkDocReq.execute('mp_DocumentPendingCheck');
                
                if (!checkDocRes.recordset || checkDocRes.recordset.length === 0) {
                    // All items are completely approved (or rejected).
                    // Update DocumentStatus to 2
                    const docUpdateReq = new sql.Request(transaction);
                    docUpdateReq.input('DocumentNo', sql.VarChar(13), documentNo);
                    docUpdateReq.input('DocumentStatus', sql.Int, 2); // 2 = Approved
                    docUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
                    docUpdateReq.input('UpdateDate', sql.DateTime, today);
                    await docUpdateReq.execute('mp_DocumentUpdateStatus');
                    
                    // Use a fresh request so we don't pass extra params from mp_DocumentUpdateStatus
                    const approvedItemsReq = new sql.Request(transaction);
                    approvedItemsReq.input('DocumentNo', sql.VarChar(13), documentNo);
                    const approvedItemsRes = await approvedItemsReq.execute('mp_DocumentApprovedItemsGet');
                    
                    if (approvedItemsRes.recordset && approvedItemsRes.recordset.length > 0) {
                        for (const row of approvedItemsRes.recordset) {
                           const trUpdateReq = new sql.Request(transaction);
                           trUpdateReq.input('TransactionNo', sql.VarChar(10), row.ItemID);
                           trUpdateReq.input('Status', sql.Int, 3);
                           trUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
                           trUpdateReq.input('UpdateDate', sql.DateTime, today);
                           await trUpdateReq.execute('mp_TransactionsUpdateStatus');
                        }
                    }
                }
            }

            await transaction.commit();

            // Send notification emails after successful commit
            try {
                if (nextSeqnoRes.recordset && nextSeqnoRes.recordset.length > 0) {
                    // Notify next approver
                    const nextApprover = nextSeqnoRes.recordset[0];
                    if (nextApprover.Email) {
                        const recipient = await resolveMailRecipient('SendMailTrans', nextApprover.Email);
                        const actorReq = new sql.Request(pool);
                        actorReq.input('EmployeeID', sql.VarChar(20), updateBy);
                        const actorRes = await actorReq.execute('mp_UserInfoGet');
                        const actorName = actorRes.recordset?.[0]?.FullName || updateBy;
                        const loginUrl = 'http://localhost:3000/login';
                        const transactionRows = await getTransactionRowsByNos(pool, [itemId]);
                        const selectedRow = transactionRows[0] || { transactionNo: itemId, transactionTypeText: '-', transactionDesc: '-' };

                        const subject = `[PTTSWP] Transaction: มีการเปลี่ยนแปลงกรอบอัตรากำลัง ส่งมาให้ตรวจสอบ`;
                        const body = buildTransactionReviewBody({
                            recipientName: nextApprover.Fullname || nextApprover.FullnameTH || '-',
                            senderName: actorName,
                            documentNo,
                            rows: [selectedRow],
                            addressLoginUrl: loginUrl
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
                    }
                } else {
                    // Full Approval - Notify Requester (Seqno 0)
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
                    `); // Creator row
                    
                    if (requesterRes.recordset && requesterRes.recordset.length > 0) {
                        const requester = requesterRes.recordset[0];
                        if (requester.Email) {
                            const recipient = await resolveMailRecipient('SendMailTrans', requester.Email);
                            const subject = `[PTTSWP] คำขอ ${documentNo} ได้รับการอนุมัติครบถ้วนแล้ว`;
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
                        }
                    }
                }
            } catch (mailError) {
                console.error('Email notification failed in approveDocumentService:', mailError);
            }

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

export const rejectDocumentService = async (documentNo: string, itemId: string, seqno: number, remark: string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const today = new Date();

            // 1. Update current and future approvers to Rejected (-1)
            const updateCurrentReq = new sql.Request(transaction);
            updateCurrentReq.input('DocumentNo', sql.VarChar(13), documentNo);
            updateCurrentReq.input('ItemID', sql.VarChar(10), itemId);
            updateCurrentReq.input('Seqno', sql.Int, seqno);
            updateCurrentReq.input('AuditStatus', sql.Int, -1); // -1 = Rejected
            updateCurrentReq.input('AuditDate', sql.DateTime, today);
            await updateCurrentReq.execute('mp_DocumentItemsUpdateAuditStatus');

            const updateFutureReq = new sql.Request(transaction);
            updateFutureReq.input('DocumentNo', sql.VarChar(13), documentNo);
            updateFutureReq.input('ItemID', sql.VarChar(10), itemId);
            updateFutureReq.input('Seqno', sql.Int, seqno);
            updateFutureReq.input('AuditDate', sql.DateTime, today);
            await updateFutureReq.execute('mp_DocumentItemsFutureRejectUpdate');

            // 2. Insert Remark
            const remarkReq = new sql.Request(transaction);
            remarkReq.input('DocumentNo', sql.VarChar(13), documentNo);
            remarkReq.input('ItemID', sql.VarChar(10), itemId);
            remarkReq.input('Remark', sql.NVarChar(500), remark);
            remarkReq.input('CreateBy', sql.VarChar(20), updateBy);
            remarkReq.input('CreateDate', sql.DateTime, today);
            await remarkReq.execute('mp_DocumentRemarkInsert');

            // 3. Update MP_Transactions Status to 0
            const trUpdateReq = new sql.Request(transaction);
            trUpdateReq.input('TransactionNo', sql.VarChar(10), itemId);
            trUpdateReq.input('Status', sql.Int, 0);
            trUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
            trUpdateReq.input('UpdateDate', sql.DateTime, today);
            await trUpdateReq.execute('mp_TransactionsUpdateStatus');

            // 4. Check if the original DocumentNo is now fully approved or rejected
            const checkDocReq = new sql.Request(transaction);
            checkDocReq.input('DocumentNo', sql.VarChar(13), documentNo);
            const checkDocRes = await checkDocReq.execute('mp_DocumentPendingCheck');
            
            if (!checkDocRes.recordset || checkDocRes.recordset.length === 0) {
                // If no remaining active/pending items, update DocumentStatus
                const allRejectedRes = await checkDocReq.execute('mp_DocumentAllRejectedCheck');

                const docUpdateReq = new sql.Request(transaction);
                docUpdateReq.input('DocumentNo', sql.VarChar(13), documentNo);
                docUpdateReq.input('UpdateBy', sql.VarChar(20), updateBy);
                docUpdateReq.input('UpdateDate', sql.DateTime, today);

                if (!allRejectedRes.recordset || allRejectedRes.recordset.length === 0) {
                    // All rejected
                    docUpdateReq.input('DocumentStatus', sql.Int, 0); 
                } else {
                    docUpdateReq.input('DocumentStatus', sql.Int, 2); 
                }
                
                await docUpdateReq.execute('mp_DocumentUpdateStatus');
            }

            await transaction.commit();

            // Notify Requester about rejection
            try {
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
                
                if (requesterRes.recordset && requesterRes.recordset.length > 0) {
                    const requester = requesterRes.recordset[0];
                    if (requester.Email) {
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
                    }
                }
            } catch (mailError) {
                console.error('Email notification failed in rejectDocumentService:', mailError);
            }

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
                // 3. For each item, insert remark and update transaction status to 0
                for (const row of itemsRes.recordset) {
                    const itemId = row.ItemID;

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

export const getProgressService = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        let docsRes;
        try {
            const req = new sql.Request(pool);
            req.input('EmployeeID', sql.VarChar(20), employeeId);
            docsRes = await req.execute('mp_DocumentProgressListGet');
        } catch (error: any) {
            const message = String(error?.message || '');
            if (!message.includes('has no parameters and arguments were supplied')) {
                throw error;
            }

            // Fallback for DB where this SP has no input parameters
            const reqNoParam = new sql.Request(pool);
            docsRes = await reqNoParam.execute('mp_DocumentProgressListGet');
        }
        if (!docsRes.recordset?.length) return [];

        const results = [];

        for (const doc of docsRes.recordset) {
            const docNo = doc.DocumentNo;

            const itemsReq = new sql.Request(pool);
            itemsReq.input('DocumentNo', sql.VarChar(13), docNo);
            itemsReq.input('EmployeeID', sql.VarChar(20), null);
            const itemsRes = await itemsReq.execute('mp_DocumentItemsDetailGet');

            // Get approval logs
            const logsReq = new sql.Request(pool);
            logsReq.input('DocumentNo', sql.VarChar(13), docNo);
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
            const logsRes = await logsReq.query(logsQuery);

            // Determine process stage
            const hasActive = logsRes.recordset?.some((l: { AuditStatus: number }) => l.AuditStatus === 1);
            const allDone = logsRes.recordset?.every((l: { AuditStatus: number }) => l.AuditStatus === 2 || l.AuditStatus === -1);
            let processStage = 1;
            if (hasActive) processStage = 2;
            if (allDone && logsRes.recordset?.length > 0) processStage = 3;

            // Determine status label based on current active approver
            let statusLabel = 'Waiting';
            if (processStage === 3) {
                statusLabel = 'Complete';
            } else {
                const activeApprover = logsRes.recordset?.find((l: { AuditStatus: number; UserGroupName?: string }) => l.AuditStatus === 1);
                if (activeApprover?.UserGroupName) {
                    statusLabel = `Waiting ${activeApprover.UserGroupName}`;
                }
            }

            // Build first item description as resolution text
            const firstItem = itemsRes.recordset?.[0];
            const resolution = firstItem?.TransactionDesc || '';
            const category = firstItem?.TransactionType === 1 ? 'ภายใต้ ผช.' :
                             firstItem?.TransactionType === 2 ? 'โอนกรอบอื่นๆ' :
                             firstItem?.TransactionType === 3 ? 'ปรับสัดส่วน' :
                             firstItem?.TransactionType === 4 ? 'เพิ่ม/ลด' :
                             firstItem?.TransactionType === 6 ? 'ยืม' : 'อื่นๆ';

            const typeCategory = firstItem?.TransactionType === 1 ? 'transfer' :
                                 firstItem?.TransactionType === 4 ? 'add' :
                                 firstItem?.TransactionType === 3 ? 'adjust' : 'other';

            results.push({
                documentNo: docNo,
                effectiveDate: doc.EffectiveDate,
                documentType: doc.DocumentType,
                createDate: doc.CreateDate,
                createBy: doc.CreateBy,
                statusLabel,
                processStage,
                category,
                typeCategory,
                resolution,
                items: itemsRes.recordset || [],
                logs: logsRes.recordset || []
            });
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
        let docsRes;
        try {
            const req = new sql.Request(pool);
            req.input('EmployeeID', sql.VarChar(20), employeeId);
            docsRes = await req.execute('mp_AllDocumentsGet');
        } catch (error: any) {
            const message = String(error?.message || '');
            if (!message.includes('has no parameters and arguments were supplied')) {
                throw error;
            }

            // Fallback for DB where this SP has no input parameters
            const reqNoParam = new sql.Request(pool);
            docsRes = await reqNoParam.execute('mp_AllDocumentsGet');
        }
        if (!docsRes.recordset?.length) return [];

        const results = [];

        for (const doc of docsRes.recordset) {
            const docNo = doc.DocumentNo;

            // Get items (transactions) for this document
            const itemsReq = new sql.Request(pool);
            itemsReq.input('DocumentNo', sql.VarChar(13), docNo);
            itemsReq.input('EmployeeID', sql.VarChar(20), null);
            const itemsRes = await itemsReq.execute('mp_DocumentItemsDetailGet');

            // Get approval logs
            const logsReq = new sql.Request(pool);
            logsReq.input('DocumentNo', sql.VarChar(13), docNo);
            const logsRes = await logsReq.execute('mp_DocumentLogsGet');

            // Determine process stage
            const hasActive = logsRes.recordset?.some((l: { AuditStatus: number }) => l.AuditStatus === 1);
            const allDone = logsRes.recordset?.every((l: { AuditStatus: number }) => l.AuditStatus === 2 || l.AuditStatus === -1);
            let processStage = 1;
            if (hasActive) processStage = 2;
            if (allDone && logsRes.recordset?.length > 0) processStage = 3;

            // Determine status label based on current active approver or document status
            let statusLabel = 'Waiting';
            if (doc.DocumentStatus === -1) {
                statusLabel = 'Rejected';
            } else if (processStage === 3) {
                statusLabel = 'Complete';
            } else {
                const activeApprover = logsRes.recordset?.find((l: { AuditStatus: number; UserGroupName?: string }) => l.AuditStatus === 1);
                if (activeApprover?.UserGroupName) {
                    statusLabel = `Waiting ${activeApprover.UserGroupName}`;
                }
            }

            // Build first item description as resolution text
            const firstItem = itemsRes.recordset?.[0];
            const resolution = firstItem?.TransactionDesc || '';
            const category = firstItem?.TransactionType === 1 ? 'ภายใต้ ผช.' :
                             firstItem?.TransactionType === 2 ? 'โอนกรอบอื่นๆ' :
                             firstItem?.TransactionType === 3 ? 'ปรับสัดส่วน' :
                             firstItem?.TransactionType === 4 ? 'เพิ่ม/ลด' :
                             firstItem?.TransactionType === 6 ? 'ยืม' : 'อื่นๆ';

            const typeCategory = firstItem?.TransactionType === 1 ? 'transfer' :
                                 firstItem?.TransactionType === 4 ? 'add' :
                                 firstItem?.TransactionType === 3 ? 'adjust' : 'other';

            results.push({
                documentNo: docNo,
                effectiveDate: doc.EffectiveDate,
                documentType: doc.DocumentType,
                createDate: doc.CreateDate,
                createBy: doc.CreateBy,
                statusLabel,
                processStage,
                category,
                typeCategory,
                resolution,
                items: itemsRes.recordset || [],
                logs: logsRes.recordset || []
            });
        }

        return results;
    } catch (error) {
        console.error('Error in getAllTransactionsService:', error);
        throw error;
    }
};
