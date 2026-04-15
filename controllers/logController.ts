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

export const insertLogAction = async (c: Context) => {
    try {
        const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
        const tokenUser = ((c.req as any).user || {}) as Record<string, unknown>;

        const employeeIdRaw = String(body.employeeId || body.EmployeeID || tokenUser.id || '').trim();
        const actionId = toIntegerOrNull((body as any).actionId ?? (body as any).ActionID);
        const subjectFromBody = toIntegerOrNull((body as any).subjectId ?? (body as any).SubjectID);
        const subjectFromCookie = toIntegerOrNull(getCookie(c, 'selected_subject_id'));
        const subjectId = subjectFromBody ?? subjectFromCookie ?? null;

        const roleFromBody = String(
            (body as any).userRole ||
            (body as any).UserRole ||
            (body as any).userGroupNo ||
            (body as any).UserGroupNo ||
            (body as any).role ||
            ''
        ).trim();
        const roleFromStorageCookie = String(getCookie(c, 'selected_usergroup') || '').trim();
        const userRole = roleFromBody || roleFromStorageCookie;
        const note = String((body as any).note || (body as any).Note || '').trim();
        const adminFlag = toIntegerOrNull((body as any).adminFlag ?? (body as any).AdminFlag) ?? (userRole === '01' ? 1 : 0);
        const requiresSubjectAction = new Set<number>([2, 3, 4, 8]);

        if (!employeeIdRaw) {
            return c.json({ success: false, message: 'employeeId is required' }, 400);
        }
        if (!actionId) {
            return c.json({ success: false, message: 'actionId is required' }, 400);
        }
        if (requiresSubjectAction.has(actionId) && (!subjectId || subjectId <= 0)) {
            return c.json({ success: false, message: 'subjectId is required for this action' }, 400);
        }

        let sanitizedNote = note;
        if (subjectId && subjectId > 0 && sanitizedNote) {
            try {
                const menuName = await getMenuNameByIdService(subjectId);
                if (menuName && normalizeText(menuName) === normalizeText(sanitizedNote)) {
                    sanitizedNote = '';
                }
            } catch (menuError) {
                console.error('Failed to lookup menu name for log sanitization:', menuError);
            }
        }

        await insertLogActionService({
            employeeId: employeeIdRaw,
            actionId,
            subjectId: subjectId ?? 0,
            userRole,
            note: sanitizedNote,
            adminFlag,
        });

        return c.json({ success: true }, 200);
    } catch (error: any) {
        console.error('Error in insertLogAction controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};

export const testMailAlert = async (c: Context) => {
    try {
        const body = await c.req.json();
        const requestedEmail = String(body?.email || '').trim();
        const note = String(body?.note || '').trim();
        const alertTypeRaw = String(body?.alertType || '').trim().toUpperCase();
        const alertType = alertTypeRaw === 'END' ? 'END' : 'START';
        const templateType = String(body?.templateType || '').trim().toUpperCase();
        const recipientName = String(body?.recipientName || '').trim();
        const senderName = String(body?.senderName || '').trim();
        const unitName = String(body?.unitName || '').trim();
        const documentNo = String(body?.documentNo || '').trim();
        const transactionNo = String(body?.transactionNo || '').trim();
        const transactionTypeText = String(body?.transactionTypeText || '').trim();
        const transactionDesc = String(body?.transactionDesc || '').trim();
        const transactionItemsRaw = Array.isArray(body?.transactionItems) ? body.transactionItems : [];
        const transactionItems = transactionItemsRaw
            .map((item: any) => ({
                transactionNo: String(item?.transactionNo || '').trim(),
                transactionTypeText: String(item?.transactionTypeText || '').trim(),
                transactionDesc: String(item?.transactionDesc || '').trim()
            }))
            .filter((item: any) => item.transactionNo);
        const mkdRequestNo = String(body?.mkdRequestNo || '').trim();
        const transactionCount = Number(body?.transactionCount || 0);

        if (!requestedEmail) {
            return c.json({ success: false, message: 'email is required' }, 400);
        }

        const user = (c.req as any).user || {};
        const requestedBy = String(user?.id || body?.requestedBy || 'SYSTEM').trim() || 'SYSTEM';
        const fallbackName = String(user?.name || requestedBy).trim();

        const result = await sendMailAlertDebugTest({
            requestedBy,
            requestedEmail,
            requestedEmployeeId: requestedBy,
            note,
            alertType,
            templateType,
            recipientName: recipientName || undefined,
            senderName: senderName || fallbackName,
            unitName: unitName || undefined,
            documentNo: documentNo || undefined,
            transactionNo: transactionNo || undefined,
            transactionTypeText: transactionTypeText || undefined,
            transactionDesc: transactionDesc || undefined,
            transactionCount: Number.isFinite(transactionCount) ? transactionCount : undefined,
            transactionItems: transactionItems.length > 0 ? transactionItems : undefined,
            mkdRequestNo: mkdRequestNo || undefined
        });

        return c.json(result, 200);
    } catch (error: any) {
        console.error('Error in testMailAlert controller:', error);
        return c.json({ success: false, message: error?.message || 'Internal server error' }, 500);
    }
};
