import { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { exportLogActionService, getLogActionService, getMenuNameByIdService, insertLogActionService } from '../services/logService.js';
import { sendMailAlertDebugTest } from '../services/mailAlertSchedulerService.js';

const createDate = (year: number, month: number, day: number): Date | null => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }

    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }

    date.setHours(0, 0, 0, 0);
    return date;
};

const parseDateInput = (rawValue: string): Date | null => {
    const value = rawValue.trim();
    if (!value) return null;

    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        return createDate(
            Number.parseInt(isoMatch[1], 10),
            Number.parseInt(isoMatch[2], 10),
            Number.parseInt(isoMatch[3], 10)
        );
    }

    const dmyMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmyMatch) {
        let year = Number.parseInt(dmyMatch[3], 10);
        if (year > 2400) {
            year -= 543;
        }

        return createDate(
            year,
            Number.parseInt(dmyMatch[2], 10),
            Number.parseInt(dmyMatch[1], 10)
        );
    }

    return null;
};

const getDateRange = (c: Context): { fromDate?: Date; toDate?: Date; message?: string } => {
    const fromDateRaw = c.req.query('fromDate') || c.req.query('FromDate') || '';
    const toDateRaw = c.req.query('toDate') || c.req.query('ToDate') || '';

    if (!fromDateRaw || !toDateRaw) {
        return { message: 'Missing required query parameters: fromDate, toDate' };
    }

    const fromDate = parseDateInput(fromDateRaw);
    const toDate = parseDateInput(toDateRaw);

    if (!fromDate || !toDate) {
        return { message: 'Invalid date format. Supported: YYYY-MM-DD or DD/MM/YYYY (including Buddhist year).' };
    }

    if (fromDate > toDate) {
        return { message: 'fromDate must be less than or equal to toDate' };
    }

    return { fromDate, toDate };
};

export const getLogAction = async (c: Context) => {
    try {
        const range = getDateRange(c);
        if (!range.fromDate || !range.toDate) {
            return c.json({ success: false, message: range.message || 'Invalid query parameters' }, 400);
        }

        const data = await getLogActionService(range.fromDate, range.toDate);
        return c.json({ success: true, data }, 200);
    } catch (error: any) {
        console.error('Error in getLogAction controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

export const exportLogAction = async (c: Context) => {
    try {
        const range = getDateRange(c);
        if (!range.fromDate || !range.toDate) {
            return c.json({ success: false, message: range.message || 'Invalid query parameters' }, 400);
        }

        const data = await exportLogActionService(range.fromDate, range.toDate);
        return c.json({ success: true, data }, 200);
    } catch (error: any) {
        console.error('Error in exportLogAction controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

const toIntegerOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizeText = (value: string): string => {
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
};

const toRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object") return {};
    return value as Record<string, unknown>;
};

type LogActionInput = {
    employeeIdRaw: string;
    actionId: number | null;
    subjectId: number | null;
    userRole: string;
    note: string;
    adminFlag: number;
};

const getRequestUser = (c: Context): Record<string, unknown> => {
    return (c.req as { user?: Record<string, unknown> }).user || {};
};

const getBodyText = (body: Record<string, unknown>, keys: string[]): string => {
    const value = keys.map((key) => body[key]).find((item) => item !== undefined && item !== null);
    return String(value || "").trim();
};

const buildLogActionInput = (
    body: Record<string, unknown>,
    tokenUser: Record<string, unknown>,
    subjectCookie: string | undefined,
    roleCookie: string | undefined
): LogActionInput => {
    const roleFromBody = getBodyText(body, ["userRole", "UserRole", "userGroupNo", "UserGroupNo", "role"]);
    const userRole = roleFromBody || String(roleCookie || "").trim();

    return {
        employeeIdRaw: getBodyText(body, ["employeeId", "EmployeeID"]) || String(tokenUser.id || "").trim(),
        actionId: toIntegerOrNull(body["actionId"] ?? body["ActionID"]),
        subjectId: toIntegerOrNull(body["subjectId"] ?? body["SubjectID"]) ?? toIntegerOrNull(subjectCookie),
        userRole,
        note: getBodyText(body, ["note", "Note"]),
        adminFlag: toIntegerOrNull(body["adminFlag"] ?? body["AdminFlag"]) ?? (userRole === "01" ? 1 : 0)
    };
};

const validateLogActionInput = (input: LogActionInput): string | null => {
    if (!input.employeeIdRaw) return "employeeId is required";
    if (!input.actionId) return "actionId is required";

    const requiresSubjectAction = new Set<number>([2, 3, 4, 8]);
    if (requiresSubjectAction.has(input.actionId) && (!input.subjectId || input.subjectId <= 0)) {
        return "subjectId is required for this action";
    }

    return null;
};

const sanitizeLogNote = async (subjectId: number | null, note: string): Promise<string> => {
    if (!subjectId || subjectId <= 0 || !note) return note;

    try {
        const menuName = await getMenuNameByIdService(subjectId);
        return menuName && normalizeText(menuName) === normalizeText(note) ? "" : note;
    } catch (menuError) {
        console.error("Failed to lookup menu name for log sanitization:", menuError);
        return note;
    }
};

export const insertLogAction = async (c: Context) => {
    try {
        const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
        const input = buildLogActionInput(
            body,
            getRequestUser(c),
            getCookie(c, "selected_subject_id"),
            getCookie(c, "selected_usergroup")
        );
        const validationMessage = validateLogActionInput(input);

        if (validationMessage) {
            return c.json({ success: false, message: validationMessage }, 400);
        }

        await insertLogActionService({
            employeeId: input.employeeIdRaw,
            actionId: input.actionId ?? 0,
            subjectId: input.subjectId ?? 0,
            userRole: input.userRole,
            note: await sanitizeLogNote(input.subjectId, input.note),
            adminFlag: input.adminFlag,
        });

        return c.json({ success: true }, 200);
    } catch (error: any) {
        console.error("Error in insertLogAction controller:", error);
        return c.json({ success: false, message: error?.message || "Internal server error" }, 500);
    }
};

type MailAlertDebugBody = {
    requestedEmail: string;
    note: string;
    alertType: 'START' | 'END';
    templateType: string;
    recipientName: string;
    senderName: string;
    unitName: string;
    documentNo: string;
    transactionNo: string;
    transactionTypeText: string;
    transactionDesc: string;
    transactionItems: Array<{ transactionNo: string; transactionTypeText: string; transactionDesc: string }>;
    mkdRequestNo: string;
    transactionCount: number;
};

const parseMailAlertTransactionItems = (body: Record<string, unknown>) => {
    const transactionItemsRaw = Array.isArray(body['transactionItems']) ? body['transactionItems'] : [];
    return transactionItemsRaw
        .map((item) => {
            const transactionItem = toRecord(item);
            return {
                transactionNo: String(transactionItem['transactionNo'] || '').trim(),
                transactionTypeText: String(transactionItem['transactionTypeText'] || '').trim(),
                transactionDesc: String(transactionItem['transactionDesc'] || '').trim()
            };
        })
        .filter((item) => item.transactionNo);
};

const parseMailAlertDebugBody = (body: Record<string, unknown>): MailAlertDebugBody => {
    const alertTypeRaw = String(body['alertType'] || '').trim().toUpperCase();
    return {
        requestedEmail: String(body['email'] || '').trim(),
        note: String(body['note'] || '').trim(),
        alertType: alertTypeRaw === 'END' ? 'END' : 'START',
        templateType: String(body['templateType'] || '').trim().toUpperCase(),
        recipientName: String(body['recipientName'] || '').trim(),
        senderName: String(body['senderName'] || '').trim(),
        unitName: String(body['unitName'] || '').trim(),
        documentNo: String(body['documentNo'] || '').trim(),
        transactionNo: String(body['transactionNo'] || '').trim(),
        transactionTypeText: String(body['transactionTypeText'] || '').trim(),
        transactionDesc: String(body['transactionDesc'] || '').trim(),
        transactionItems: parseMailAlertTransactionItems(body),
        mkdRequestNo: String(body['mkdRequestNo'] || '').trim(),
        transactionCount: Number(body['transactionCount'] || 0)
    };
};

const getMailAlertRequester = (c: Context, body: Record<string, unknown>) => {
    const user = (c.req as { user?: Record<string, unknown> }).user || {};
    const requestedBy = String(user?.id || body['requestedBy'] || 'SYSTEM').trim() || 'SYSTEM';
    const fallbackName = String(user?.name || requestedBy).trim();
    return { requestedBy, fallbackName };
};

export const testMailAlert = async (c: Context) => {
    try {
        const body = toRecord(await c.req.json());
        const parsed = parseMailAlertDebugBody(body);

        if (!parsed.requestedEmail) {
            return c.json({ success: false, message: 'email is required' }, 400);
        }

        const { requestedBy, fallbackName } = getMailAlertRequester(c, body);
        const result = await sendMailAlertDebugTest({
            requestedBy,
            requestedEmail: parsed.requestedEmail,
            requestedEmployeeId: requestedBy,
            note: parsed.note,
            alertType: parsed.alertType,
            templateType: parsed.templateType,
            recipientName: parsed.recipientName || undefined,
            senderName: parsed.senderName || fallbackName,
            unitName: parsed.unitName || undefined,
            documentNo: parsed.documentNo || undefined,
            transactionNo: parsed.transactionNo || undefined,
            transactionTypeText: parsed.transactionTypeText || undefined,
            transactionDesc: parsed.transactionDesc || undefined,
            transactionCount: Number.isFinite(parsed.transactionCount) ? parsed.transactionCount : undefined,
            transactionItems: parsed.transactionItems.length > 0 ? parsed.transactionItems : undefined,
            mkdRequestNo: parsed.mkdRequestNo || undefined
        });

        return c.json(result, 200);
    } catch (error: any) {
        console.error('Error in testMailAlert controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};
