import { sql, poolPromise } from '../config/db.js';
import configService from './configService.js';
import { sendMail } from './mailService.js';
import { createMailLog } from './mailLogService.js';

export type AlertType = 'START' | 'END';
type SendMode = '0' | '1' | '2';
type MailToggleConfigKey = 'SendMailAlert' | 'SendMailTrans' | 'SendMailManDriver';
export type DebugMailTemplateType =
    | 'CALENDAR_START'
    | 'CALENDAR_END'
    | 'TRANSACTION_SUBMIT'
    | 'TRANSACTION_REJECT'
    | 'MKD_NEXT'
    | 'MKD_REJECT'
    | 'MKD_HRUSER';

interface WarningRecipient {
    EmployeeID: string;
    Name: string;
    Email: string;
}

interface AlertMessage {
    subject: string;
    body: string;
}

interface DebugTransactionItem {
    transactionNo: string;
    transactionTypeText?: string;
    transactionDesc?: string;
}

interface TransactionLookupRow {
    transactionNo: string;
    transactionType: number | null;
    transactionDesc: string;
}

interface MailAlertSendResult {
    mode: SendMode;
    isSend: number;
    requestedRecipient: string;
    finalRecipient: string | null;
    message: string;
}

const DEFAULT_ALERT_SYSTEM_URL = 'https://ptt-wfmwb-p01.pttplc.com/Client/login.html';
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

let schedulerTimer: NodeJS.Timeout | null = null;
let tickIsRunning = false;
const completedRunKeys = new Set<string>();

const stripTime = (date: Date): Date => {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
};

const getDateKey = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
};

const THAI_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// Keep "stored clock value" without timezone shifting, aligned with calendar UI rendering.
const formatThaiDateFromStored = (date: Date): string => {
    const day = String(date.getUTCDate()).padStart(2, '0');
    const monthName = THAI_MONTH_SHORT[date.getUTCMonth()] || '';
    const year = date.getUTCFullYear() + 543;
    return `${day} ${monthName} ${year}`;
};

const formatThaiDateTimeFromStored = (date: Date): string => {
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${formatThaiDateFromStored(date)} เวลา ${hh}:${mm} น.`;
};

const sanitizeThaiName = (name: string): string => {
    return (name || '')
        .replace(/นาย/g, '')
        .replace(/นาง/g, '')
        .replace(/น\.ส\./g, '')
        .trim();
};

const escapeHtml = (value: string): string => {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const formatTransactionTypeText = (rawValue: string): string => {
    const value = String(rawValue || '').trim();
    if (!value) return '-';

    const typeNo = Number.parseInt(value, 10);
    if (!Number.isFinite(typeNo) || String(typeNo) !== value) {
        return value;
    }

    const typeTextMap: Record<number, string> = {
        1: 'โอนย้ายอัตรากำลังภายในหน่วยงาน',
        2: 'โอนย้ายอัตรากำลังข้ามหน่วยงาน',
        3: 'ปรับเปลี่ยนอัตรากำลัง',
        4: 'เพิ่ม/ลดกรอบอัตรากำลังในหน่วยงาน',
        5: 'หมายเหตุ',
        6: 'ยืมอัตรากำลัง',
        7: 'คืนอัตรากำลัง'
    };

    return typeTextMap[typeNo] || value;
};

const getTransactionLookupRows = async (transactionNos: string[]): Promise<TransactionLookupRow[]> => {
    const uniqueNos = Array.from(
        new Set(
            transactionNos
                .map((no) => String(no || '').trim())
                .filter(Boolean)
        )
    );

    if (uniqueNos.length === 0) {
        return [];
    }

    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        const placeholders = uniqueNos.map((transactionNo, index) => {
            const paramName = `TransactionNo${index}`;
            request.input(paramName, sql.VarChar(20), transactionNo);
            return `@${paramName}`;
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
            transactionType: Number.isFinite(Number(row?.TransactionType)) ? Number(row.TransactionType) : null,
            transactionDesc: String(row?.TransactionDesc || '').trim()
        }));
    } catch (error) {
        console.warn('[MailAlertScheduler] Failed to lookup TransactionDesc from MP_Transactions:', error);
        return [];
    }
};

const getTransactionItemsByDocumentNo = async (documentNo: string): Promise<DebugTransactionItem[]> => {
    const normalizedDocumentNo = String(documentNo || '').trim();
    if (!normalizedDocumentNo) return [];

    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);
        request.input('DocumentNo', sql.VarChar(20), normalizedDocumentNo);

        const query = `
            ;WITH DocItems AS (
                SELECT DISTINCT ItemID
                FROM MP_DocumentItems WITH (NOLOCK)
                WHERE DocumentNo = @DocumentNo
            )
            SELECT
                d.ItemID AS TransactionNo,
                t.TransactionType,
                t.TransactionDesc
            FROM DocItems d
            LEFT JOIN MP_Transactions t WITH (NOLOCK)
                ON t.TransactionNo = d.ItemID
            ORDER BY d.ItemID, t.TransactionType
        `;

        const result = await request.query(query);
        return (result.recordset || [])
            .map((row: any) => ({
                transactionNo: String(row?.TransactionNo || '').trim(),
                transactionTypeText: row?.TransactionType !== null && row?.TransactionType !== undefined
                    ? String(row.TransactionType).trim()
                    : '',
                transactionDesc: String(row?.TransactionDesc || '').trim()
            }))
            .filter((item: DebugTransactionItem) => item.transactionNo);
    } catch (error) {
        console.warn('[MailAlertScheduler] Failed to lookup transaction items from MP_DocumentItems:', error);
        return [];
    }
};

const hydrateDebugTransactionItems = async (items: DebugTransactionItem[]): Promise<DebugTransactionItem[]> => {
    const lookupRows = await getTransactionLookupRows(items.map((item) => item.transactionNo));
    const rowByNo = new Map<string, TransactionLookupRow[]>();

    for (const row of lookupRows) {
        const key = row.transactionNo;
        if (!key) continue;
        const arr = rowByNo.get(key) || [];
        arr.push(row);
        rowByNo.set(key, arr);
    }

    const hydratedRows = items.flatMap((item) => {
        const transactionNo = String(item.transactionNo || '').trim();
        const inputTypeText = String(item.transactionTypeText || '').trim();
        const inputDesc = String(item.transactionDesc || '').trim();
        const candidates = rowByNo.get(transactionNo) || [];

        if (inputTypeText) {
            let transactionDesc = inputDesc;
            const typeNo = Number.parseInt(inputTypeText, 10);

            if (Number.isFinite(typeNo)) {
                const matchedByType = candidates.find((row) => row.transactionType === typeNo && row.transactionDesc);
                if (matchedByType) {
                    transactionDesc = matchedByType.transactionDesc;
                }
            }

            if (!transactionDesc) {
                const firstWithDesc = candidates.find((row) => row.transactionDesc);
                if (firstWithDesc) {
                    transactionDesc = firstWithDesc.transactionDesc;
                }
            }
            return [{
                transactionNo: transactionNo || '-',
                transactionTypeText: formatTransactionTypeText(inputTypeText),
                transactionDesc: transactionDesc || '-'
            }];
        }

        if (candidates.length > 0) {
            return candidates.map((row) => ({
                transactionNo: transactionNo || '-',
                transactionTypeText: formatTransactionTypeText(
                    row.transactionType !== null ? String(row.transactionType) : '-'
                ),
                transactionDesc: row.transactionDesc || inputDesc || '-'
            }));
        }

        return [{
            transactionNo: transactionNo || '-',
            transactionTypeText: '-',
            transactionDesc: inputDesc || '-'
        }];
    });

    return hydratedRows;
};

const getMailToggleConfig = async (configKey: MailToggleConfigKey): Promise<{ mode: SendMode; testEmail: string }> => {
    const config = await configService.getConfigDetails(configKey, true);
    const rawMode = (config.Value1 || '').trim();
    const mode: SendMode = rawMode === '1' || rawMode === '2' ? rawMode : '0';
    const testEmail = (config.Value2 || '').trim();
    return { mode, testEmail };
};

const getAddressLoginUrl = async (): Promise<string> => {
    const value = (await configService.getConfig('AddressLogin')).trim();
    return value || DEFAULT_ALERT_SYSTEM_URL;
};

const shouldRunTodayForConfigType = async (configType: number, today: Date): Promise<boolean> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('ConfigType', sql.Int, configType);
    request.input('ConfigDate', sql.DateTime, stripTime(today));
    const result = await request.execute('MP_CheckConfigCalendarByDate');
    return (result.recordset || []).length > 0;
};

const getCurrentCycleLimitDate = async (today: Date): Promise<Date | null> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('ConfigType', sql.Int, 1);
    request.input('ConfigMonth', sql.Int, today.getMonth() + 1);
    request.input('ConfigYear', sql.Int, today.getFullYear());
    const result = await request.execute('MP_CheckConfigCalendar');

    const rows = result.recordset || [];
    if (rows.length === 0) return null;

    let selected: Date | null = null;
    for (const row of rows) {
        const candidate = row?.ConfigDate ? new Date(row.ConfigDate) : null;
        if (!candidate || Number.isNaN(candidate.getTime())) continue;
        if (!selected || candidate > selected) {
            selected = candidate;
        }
    }
    return selected;
};

const getAllWarningRecipients = async (): Promise<WarningRecipient[]> => {
    const pool = await poolPromise;
    const result = await pool.request().execute('mp_GetEmailUserAllToWarning');
    return (result.recordset || [])
        .map((row: any) => ({
            EmployeeID: String(row.EmployeeID || '').trim(),
            Name: String(row.Name || '').trim(),
            Email: String(row.Email || '').trim()
        }))
        .filter((row: WarningRecipient) => row.EmployeeID !== '' && row.Email !== '');
};

const buildAlertMessage = (
    alertType: AlertType,
    recipientName: string,
    limitDate: Date,
    unitMail: string,
    addressLoginUrl: string
): AlertMessage => {
    const deadlineDateText = formatThaiDateFromStored(limitDate);
    const deadlineDateTimeText = formatThaiDateTimeFromStored(limitDate);

    if (alertType === 'END') {
        return {
            subject: 'PTT Strategic WorkForce Planning System : แจ้งเตือนวันกำหนดสิ้นสุดการบันทึกข้อมูล',
            body: [
                "<div style='font-family:Segoe UI, Tahoma, sans-serif; font-size:14px; line-height:1.7; color:#1f2937;'>",
                `<p style='margin:0 0 14px 0;'>เรียน คุณ${sanitizeThaiName(recipientName)}</p>`,
                "<p style='margin:0 0 12px 0;'>ขอแจ้งเตือนว่าระบบ <b>PTT Strategic WorkForce Planning System</b> ใกล้ถึงกำหนดปิดรับการบันทึกข้อมูล</p>",
                `<p style='margin:0 0 12px 0;'><b>กำหนดปิดรับบันทึก:</b> ${deadlineDateTimeText}</p>`,
                "<p style='margin:0 0 12px 0;'>หลังจากเวลาที่กำหนด จะไม่สามารถบันทึกหรือแก้ไขข้อมูลได้</p>",
                "<p style='margin:0 0 6px 0;'>กรุณาเข้าสู่ระบบเพื่อดำเนินการ:</p>",
                `<p style='margin:0 0 14px 0;'><a href='${addressLoginUrl}' style='color:#1d4ed8; text-decoration:none;'>${addressLoginUrl}</a></p>`,
                "<p style='margin:0;'>ขอแสดงความนับถือ</p>",
                `<p style='margin:0;'>${unitMail}</p>`,
                "</div>"
            ].join('')
        };
    }

    return {
        subject: 'PTT Strategic WorkForce Planning System : แจ้งเตือนวันกำหนดเริ่มต้นการบันทึกข้อมูล',
        body: [
            "<div style='font-family:Segoe UI, Tahoma, sans-serif; font-size:14px; line-height:1.7; color:#1f2937;'>",
            `<p style='margin:0 0 14px 0;'>เรียน คุณ${sanitizeThaiName(recipientName)}</p>`,
            "<p style='margin:0 0 12px 0;'>ระบบ <b>PTT Strategic WorkForce Planning System</b> เปิดให้บันทึกข้อมูลรอบปัจจุบันแล้ว</p>",
            `<p style='margin:0 0 12px 0;'><b>กำหนดปิดรับบันทึก:</b> ${deadlineDateTimeText}</p>`,
            `<p style='margin:0 0 12px 0;'>กรุณาดำเนินการให้แล้วเสร็จ <b>ภายในวันที่ ${deadlineDateText}</b></p>`,
            "<p style='margin:0 0 6px 0;'>กรุณาเข้าสู่ระบบเพื่อดำเนินการ:</p>",
            `<p style='margin:0 0 14px 0;'><a href='${addressLoginUrl}' style='color:#1d4ed8; text-decoration:none;'>${addressLoginUrl}</a></p>`,
            "<p style='margin:0;'>ขอแสดงความนับถือ</p>",
            `<p style='margin:0;'>${unitMail}</p>`,
            "</div>"
        ].join('')
    };
};

const buildTransactionLegacyMessage = (params: {
    isReject: boolean;
    recipientName: string;
    senderName: string;
    transactionItems: DebugTransactionItem[];
    documentNo?: string;
    addressLoginUrl: string;
    unitMail: string;
}): AlertMessage => {
    const {
        isReject,
        recipientName,
        senderName,
        transactionItems,
        documentNo,
        addressLoginUrl,
        unitMail
    } = params;

    const transactionCount = transactionItems.length;
    const intro = isReject
        ? `มีการ Reject การเปลี่ยนแปลงกรอบอัตรากำลัง ${transactionCount} รายการ จาก คุณ${senderName} รอให้ตรวจสอบ`
        : `มีการเปลี่ยนแปลงกรอบอัตรากำลัง ${transactionCount} รายการ ส่งมาจาก คุณ${senderName} รอให้ตรวจสอบ`;

    const tableRows = transactionItems.map((item) => {
        const transactionNo = escapeHtml(item.transactionNo || '-');
        const transactionTypeText = escapeHtml(item.transactionTypeText || '-');
        const transactionDesc = escapeHtml(item.transactionDesc || '-').replace(/\r?\n/g, '<br>');
        return [
            "<tr>",
            `<td style='background-color:#f8fafc;color:#1f2937;padding:8px;vertical-align:top;border:1px solid #e5e7eb;'>${transactionNo}</td>`,
            `<td style='background-color:#f8fafc;color:#1f2937;padding:8px;vertical-align:top;border:1px solid #e5e7eb;'>${transactionTypeText}</td>`,
            `<td style='background-color:#f8fafc;color:#1f2937;padding:8px;vertical-align:top;border:1px solid #e5e7eb;'>${transactionDesc}</td>`,
            "</tr>"
        ].join('');
    }).join('');

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

    return {
        subject: 'PTT Strategic WorkForce Planning System : มีกิจกรรมที่รอให้ดำเนินการในระบบ',
        body: [
            `เรียน คุณ${sanitizeThaiName(recipientName)}`,
            '<br><br>',
            `<div style='font-size: medium;'>${intro} </div><br>`,
            documentNo ? `<div style='font-size: medium;'><b>Document No:</b> ${escapeHtml(documentNo)}</div><br>` : '',
            transactionTable,
            '<br>',
            '<br>กรุณาเข้าไปดำเนินการในระบบ ตามลิ้งค์ด้านล่างนี้',
            `<br><a href='${addressLoginUrl}'>${addressLoginUrl}</a>`,
            '<br><br>ขอแสดงความนับถือ',
            `<br>${unitMail}`
        ].join('')
    };
};

const buildMkdLegacyMessage = (params: {
    scenario: 'NEXT' | 'REJECT' | 'HRUSER';
    recipientName: string;
    senderName: string;
    fullRequestNo: string;
    unitName: string;
    addressLoginUrl: string;
    unitMail: string;
}): AlertMessage => {
    const { scenario, recipientName, senderName, fullRequestNo, unitName, addressLoginUrl, unitMail } = params;

    let intro = '';
    if (scenario === 'NEXT') {
        intro = `ขออนุมัติ Mandriver Power เลขที่ ${fullRequestNo} ส่งมาจาก คุณ${senderName} รอให้ตรวจสอบ`;
    } else if (scenario === 'REJECT') {
        intro = `รายการ Mandriver Power เลขที่ ${fullRequestNo} ไม่เห็นชอบ โดยคุณ${senderName} รอให้ตรวจสอบ`;
    } else {
        intro = `Mandriver Power เลขที่ ${fullRequestNo} ผ่านการเห็นชอบแล้ว รอให้ตรวจสอบ`;
    }

    return {
        subject: 'PTT Strategic WorkForce Planning System : มีกิจกรรมที่รอให้ดำเนินการในระบบ',
        body: [
            `เรียน คุณ${sanitizeThaiName(recipientName)}`,
            `<div style='font-size: medium;'> ${intro} </div><br>`,
            `<div style='font-size: medium;'> หน่วยงาน ${unitName} </div><br>`,
            '<br>กรุณาเข้าไปดำเนินการในระบบ ตามลิ้งค์ด้านล่างนี้',
            `<br><a href='${addressLoginUrl}'>${addressLoginUrl}</a>`,
            '<br><br>ขอแสดงความนับถือ',
            `<br>${unitMail}`
        ].join('')
    };
};

const normalizeDebugTemplateType = (
    templateType?: string,
    alertType?: AlertType
): DebugMailTemplateType => {
    const normalized = String(templateType || '').trim().toUpperCase();
    switch (normalized) {
        case 'CALENDAR_END':
        case 'TRANSACTION_SUBMIT':
        case 'TRANSACTION_REJECT':
        case 'MKD_NEXT':
        case 'MKD_REJECT':
        case 'MKD_HRUSER':
            return normalized;
        case 'CALENDAR_START':
            return 'CALENDAR_START';
        default:
            return alertType === 'END' ? 'CALENDAR_END' : 'CALENDAR_START';
    }
};

const getConfigKeyByTemplateType = (templateType: DebugMailTemplateType): MailToggleConfigKey => {
    if (templateType === 'TRANSACTION_SUBMIT' || templateType === 'TRANSACTION_REJECT') {
        return 'SendMailTrans';
    }
    if (templateType === 'MKD_NEXT' || templateType === 'MKD_REJECT' || templateType === 'MKD_HRUSER') {
        return 'SendMailManDriver';
    }
    return 'SendMailAlert';
};

const resolveFinalRecipient = (
    mode: SendMode,
    originalEmail: string,
    testEmail: string
): string | null => {
    if (mode === '1') return originalEmail;
    if (mode === '2') return testEmail || null;
    return null;
};

const createRefNo = (alertType: AlertType, today: Date): string => {
    return `ALRT${alertType}${getDateKey(today)}`.slice(0, 20);
};

const getDateTimeKey = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}${m}${d}${hh}${mm}${ss}`;
};

const sendOneMailWithConfigGuard = async (params: {
    configKey: MailToggleConfigKey;
    requestedRecipient: string;
    subject: string;
    body: string;
}): Promise<MailAlertSendResult> => {
    const { configKey, requestedRecipient, subject, body } = params;

    // Re-check config right before every send.
    const { mode, testEmail } = await getMailToggleConfig(configKey);
    const finalRecipient = resolveFinalRecipient(mode, requestedRecipient, testEmail);

    if (!finalRecipient) {
        if (mode === '0') {
            return {
                mode,
                isSend: 0,
                requestedRecipient,
                finalRecipient: null,
                message: `Skip sending because ${configKey}=0`
            };
        }

        return {
            mode,
            isSend: 0,
            requestedRecipient,
            finalRecipient: null,
            message: `Skip sending because ${configKey}=2 but Value2 is empty`
        };
    }

    const result = await sendMail(finalRecipient, subject, body, true);
    return {
        mode,
        isSend: result.success ? 1 : 0,
        requestedRecipient,
        finalRecipient,
        message: result.success ? 'Mail sent successfully' : `Send failed: ${String(result.error || 'unknown error')}`
    };
};

const processOneRecipient = async (params: {
    recipient: WarningRecipient;
    alertType: AlertType;
    limitDate: Date;
    unitMail: string;
    addressLoginUrl: string;
}) => {
    const { recipient, alertType, limitDate, unitMail, addressLoginUrl } = params;
    const now = new Date();
    const message = buildAlertMessage(alertType, recipient.Name, limitDate, unitMail, addressLoginUrl);
    const sendResult = await sendOneMailWithConfigGuard({
        configKey: 'SendMailAlert',
        requestedRecipient: recipient.Email,
        subject: message.subject,
        body: message.body
    });

    if (sendResult.isSend === 0) {
        console.log(`[MailAlertScheduler] ${sendResult.message} (${recipient.Email})`);
    }

    await createMailLog({
        sendFromBy: 'SYSTEM',
        sendFromDate: now,
        sendToBy: recipient.EmployeeID,
        emailTo: sendResult.finalRecipient || recipient.Email,
        mailSubject: message.subject,
        mailBody: message.body,
        effectiveDate: limitDate,
        isCC: 0,
        isSend: sendResult.isSend,
        remark: sendResult.finalRecipient ? null : 'SKIP',
        ccRecipients: [],
        createBy: 'SYSTEM',
        createDate: now
    });
};

const processAlertByType = async (alertType: AlertType, configType: number, today: Date) => {
    const shouldRun = await shouldRunTodayForConfigType(configType, today);
    if (!shouldRun) return;

    const runKey = `${alertType}-${getDateKey(today)}`;
    if (completedRunKeys.has(runKey)) return;

    const limitDate = await getCurrentCycleLimitDate(today);
    if (!limitDate) {
        console.warn(`[MailAlertScheduler] Cannot find cycle limit date for ${runKey}`);
        return;
    }

    const recipients = await getAllWarningRecipients();
    if (recipients.length === 0) {
        console.log(`[MailAlertScheduler] No warning recipients for ${runKey}`);
        completedRunKeys.add(runKey);
        return;
    }

    const unitMail = await configService.getConfig('UnitMail');
    const addressLoginUrl = await getAddressLoginUrl();

    const previewConfig = await getMailToggleConfig('SendMailAlert');
    console.log(`[MailAlertScheduler] Running ${runKey} for ${recipients.length} recipients (mode=${previewConfig.mode})`);
    for (const recipient of recipients) {
        try {
            await processOneRecipient({
                recipient,
                alertType,
                limitDate,
                unitMail,
                addressLoginUrl
            });
        } catch (error) {
            console.error(`[MailAlertScheduler] Failed recipient ${recipient.EmployeeID}/${recipient.Email}:`, error);
        }
    }

    completedRunKeys.add(runKey);
};

export const runMailAlertSchedulerTick = async () => {
    if (tickIsRunning) return;
    tickIsRunning = true;

    try {
        const today = new Date();
        await processAlertByType('END', 2, today);
        await processAlertByType('START', 3, today);
    } catch (error) {
        console.error('[MailAlertScheduler] Tick error:', error);
    } finally {
        tickIsRunning = false;
    }
};

export const sendMailAlertDebugTest = async (params: {
    requestedBy: string;
    requestedEmail: string;
    requestedEmployeeId?: string;
    note?: string;
    alertType?: AlertType;
    templateType?: DebugMailTemplateType | string;
    recipientName?: string;
    senderName?: string;
    unitName?: string;
    documentNo?: string;
    transactionNo?: string;
    transactionTypeText?: string;
    transactionDesc?: string;
    transactionCount?: number;
    transactionItems?: Array<{
        transactionNo?: string;
        transactionTypeText?: string;
        transactionDesc?: string;
    }>;
    mkdRequestNo?: string;
}) => {
    const now = new Date();
    const requestedBy = (params.requestedBy || 'SYSTEM').trim() || 'SYSTEM';
    const requestedEmail = (params.requestedEmail || '').trim();
    const alertType: AlertType = params.alertType === 'END' ? 'END' : 'START';
    const templateType = normalizeDebugTemplateType(params.templateType, alertType);
    const configKey = getConfigKeyByTemplateType(templateType);
    const recipientName = (params.recipientName || '').trim() || 'ผู้ใช้งานทดสอบ';
    const senderName = (params.senderName || '').trim() || requestedBy;
    const unitName = (params.unitName || '').trim() || 'หน่วยงานทดสอบ';
    const documentNo = (params.documentNo || '').trim();
    let transactionItems: DebugTransactionItem[] = (params.transactionItems || [])
        .map((item) => ({
            transactionNo: String(item?.transactionNo || '').trim(),
            transactionTypeText: String(item?.transactionTypeText || '').trim(),
            transactionDesc: String(item?.transactionDesc || '').trim()
        }))
        .filter((item) => item.transactionNo);
    const mkdRequestNo = (params.mkdRequestNo || '').trim() || 'M20260001';

    if (!requestedEmail) {
        throw new Error('requestedEmail is required');
    }

    const unitMail = await configService.getConfig('UnitMail');
    const addressLoginUrl = await getAddressLoginUrl();
    const limitDate = (await getCurrentCycleLimitDate(now)) || now;
    let baseMessage: AlertMessage;

    if (templateType === 'CALENDAR_START' || templateType === 'CALENDAR_END') {
        const calendarType: AlertType = templateType === 'CALENDAR_END' ? 'END' : 'START';
        baseMessage = buildAlertMessage(calendarType, recipientName, limitDate, unitMail, addressLoginUrl);
    } else if (templateType === 'TRANSACTION_SUBMIT' || templateType === 'TRANSACTION_REJECT') {
        if (transactionItems.length === 0 && documentNo) {
            transactionItems = await getTransactionItemsByDocumentNo(documentNo);
        }

        if (transactionItems.length === 0) {
            const fallbackTransactionNo = (params.transactionNo || '').trim() || 'TR26040001';
            const fallbackTransactionType = (params.transactionTypeText || '').trim();
            const fallbackTransactionDesc = (params.transactionDesc || '').trim() || 'ทดสอบการแจ้งเตือนจากหน้า Debug';
            transactionItems.push({
                transactionNo: fallbackTransactionNo,
                transactionTypeText: fallbackTransactionType,
                transactionDesc: fallbackTransactionDesc
            });
        }

        const hydratedTransactionItems = await hydrateDebugTransactionItems(transactionItems);
        baseMessage = buildTransactionLegacyMessage({
            isReject: templateType === 'TRANSACTION_REJECT',
            recipientName,
            senderName,
            transactionItems: hydratedTransactionItems,
            documentNo: documentNo || undefined,
            addressLoginUrl,
            unitMail
        });
    } else {
        const mkdScenario = templateType === 'MKD_REJECT'
            ? 'REJECT'
            : templateType === 'MKD_HRUSER'
                ? 'HRUSER'
                : 'NEXT';

        baseMessage = buildMkdLegacyMessage({
            scenario: mkdScenario,
            recipientName,
            senderName,
            fullRequestNo: mkdRequestNo,
            unitName,
            addressLoginUrl,
            unitMail
        });
    }

    const body = [
        baseMessage.body,
        '<hr>',
        '<p><b>[DEBUG TEST]</b></p>',
        `<p>Requested By: ${requestedBy}</p>`,
        `<p>Requested Email: ${requestedEmail}</p>`,
        `<p>Template Type: ${templateType}</p>`,
        documentNo ? `<p>Document No: ${documentNo}</p>` : '',
        `<p>Config Key: ${configKey}</p>`,
        `<p>Request Time: ${now.toISOString()}</p>`,
        params.note ? `<p>Note: ${params.note}</p>` : '',
        `<p>ระบบนี้จะส่งจริงหรือไม่ ขึ้นกับ MP_Config.${configKey}</p>`
    ].filter(Boolean).join('');

    const sendResult = await sendOneMailWithConfigGuard({
        configKey,
        requestedRecipient: requestedEmail,
        subject: baseMessage.subject,
        body
    });

    const mailToId = await createMailLog({
        sendFromBy: requestedBy,
        sendFromDate: now,
        sendToBy: (params.requestedEmployeeId || '').trim() || null,
        emailTo: sendResult.finalRecipient || requestedEmail,
        mailSubject: baseMessage.subject,
        mailBody: body,
        effectiveDate: now,
        isCC: 0,
        isSend: sendResult.isSend,
        remark: sendResult.finalRecipient ? null : 'SKIP',
        ccRecipients: [],
        refNo: `DBG${templateType.replace(/_/g, '').slice(0, 8)}${getDateTimeKey(now)}`.slice(0, 20),
        createBy: requestedBy,
        createDate: now
    });

    return {
        success: true,
        configKey,
        templateType,
        alertType,
        mode: sendResult.mode,
        requestedRecipient: sendResult.requestedRecipient,
        finalRecipient: sendResult.finalRecipient,
        isSend: sendResult.isSend,
        subject: baseMessage.subject,
        message: sendResult.message,
        mailToId
    };
};

export const initializeMailAlertScheduler = () => {
    if (schedulerTimer) return;

    const parsedInterval = Number(process.env.MAIL_ALERT_SCHEDULER_INTERVAL_MS || DEFAULT_INTERVAL_MS);
    const intervalMs = Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : DEFAULT_INTERVAL_MS;
    console.log(`[MailAlertScheduler] Initialized with interval ${intervalMs} ms`);

    // Run once on startup, then follow schedule interval.
    runMailAlertSchedulerTick().catch((error) => {
        console.error('[MailAlertScheduler] Initial run failed:', error);
    });

    schedulerTimer = setInterval(() => {
        runMailAlertSchedulerTick().catch((error) => {
            console.error('[MailAlertScheduler] Scheduled run failed:', error);
        });
    }, intervalMs);
};

export default {
    initializeMailAlertScheduler,
    runMailAlertSchedulerTick
};
