import { Context } from 'hono';
import delayService from '../services/delayService.js';

type DelayRequestBody = {
    employeeId?: string;
    EmployeeID?: string;
    posName?: string;
    PosName?: string;
    delayYear?: string | number;
    DelayYear?: string | number;
    delayStatus?: string | number;
    DelayStatus?: string | number;
    userId?: string;
    UserID?: string;
    createBy?: string;
    updateBy?: string;
};

const parseIntOrNull = (value: string | number | undefined): number | null => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? null : parsed;
};

const normalizeUserId = (value: string | undefined): string => {
    const trimmed = String(value || '').trim();
    return (trimmed || 'SYSTEM').slice(0, 10);
};

const normalizeBody = (body: DelayRequestBody, tokenUserId: string) => {
    const employeeId = String(body.employeeId || body.EmployeeID || '').trim();
    const posName = String(body.posName || body.PosName || '').trim();
    const delayYear = parseIntOrNull(body.delayYear ?? body.DelayYear);
    const delayStatus = parseIntOrNull(body.delayStatus ?? body.DelayStatus);
    const userId = normalizeUserId(
        String(body.userId || body.UserID || body.createBy || body.updateBy || tokenUserId || 'SYSTEM')
    );

    return {
        employeeId,
        posName,
        delayYear,
        delayStatus: delayStatus ?? 1,
        userId
    };
};

export const getDelayRecords = async (c: Context) => {
    try {
        const yearRaw = c.req.query('year');
        const year = yearRaw ? parseIntOrNull(yearRaw) : null;
        if (yearRaw && year === null) {
            return c.json({ success: false, message: 'Invalid year parameter' }, 400);
        }

        const data = await delayService.getDelayData(year ?? undefined);
        return c.json({ success: true, data }, 200);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in getDelayRecords controller:', error);
        return c.json({ success: false, message }, 500);
    }
};

export const getDelayEmployeeOptions = async (c: Context) => {
    try {
        const keyword = c.req.query('q') || '';
        const yearRaw = c.req.query('year');
        const year = yearRaw ? parseIntOrNull(yearRaw) : null;
        if (yearRaw && year === null) {
            return c.json({ success: false, message: 'Invalid year parameter' }, 400);
        }

        const data = await delayService.getEmployeeOptions(keyword, year ?? undefined);
        return c.json({ success: true, data }, 200);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in getDelayEmployeeOptions controller:', error);
        return c.json({ success: false, message }, 500);
    }
};

export const getDelayRetireYearOptions = async (c: Context) => {
    try {
        const data = await delayService.getRetireYearOptions();
        return c.json({ success: true, data }, 200);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in getDelayRetireYearOptions controller:', error);
        return c.json({ success: false, message }, 500);
    }
};

export const createDelayRecord = async (c: Context) => {
    try {
        const body = await c.req.json<DelayRequestBody>();
        const tokenUser = ((c.req as unknown as { user?: { id?: string } }).user || {}) as { id?: string };
        const normalized = normalizeBody(body, tokenUser.id || '');

        if (!normalized.employeeId) {
            return c.json({ success: false, message: 'EmployeeID is required' }, 400);
        }
        if (normalized.delayYear === null) {
            return c.json({ success: false, message: 'DelayYear is required' }, 400);
        }

        const result = await delayService.createDelayRecord({
            employeeId: normalized.employeeId,
            posName: normalized.posName,
            delayYear: normalized.delayYear,
            delayStatus: normalized.delayStatus,
            userId: normalized.userId
        });

        if (!result.success) {
            return c.json(result, 400);
        }
        return c.json(result, 200);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in createDelayRecord controller:', error);
        return c.json({ success: false, message }, 500);
    }
};

export const updateDelayRecord = async (c: Context) => {
    try {
        const delayId = String(c.req.param('delayId') || '').trim();
        if (!delayId) {
            return c.json({ success: false, message: 'DelayID is required' }, 400);
        }

        const body = await c.req.json<DelayRequestBody>();
        const tokenUser = ((c.req as unknown as { user?: { id?: string } }).user || {}) as { id?: string };
        const normalized = normalizeBody(body, tokenUser.id || '');

        if (!normalized.employeeId) {
            return c.json({ success: false, message: 'EmployeeID is required' }, 400);
        }
        if (normalized.delayYear === null) {
            return c.json({ success: false, message: 'DelayYear is required' }, 400);
        }

        const result = await delayService.updateDelayRecord(delayId, {
            employeeId: normalized.employeeId,
            posName: normalized.posName,
            delayYear: normalized.delayYear,
            delayStatus: normalized.delayStatus,
            userId: normalized.userId
        });

        if (!result.success) {
            const status = result.message === 'ไม่พบข้อมูลที่ต้องการแก้ไข' ? 404 : 400;
            return c.json(result, status);
        }
        return c.json(result, 200);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in updateDelayRecord controller:', error);
        return c.json({ success: false, message }, 500);
    }
};

export const deleteDelayRecord = async (c: Context) => {
    try {
        const delayId = String(c.req.param('delayId') || '').trim();
        if (!delayId) {
            return c.json({ success: false, message: 'DelayID is required' }, 400);
        }

        const tokenUser = ((c.req as unknown as { user?: { id?: string } }).user || {}) as { id?: string };
        const updateBy = normalizeUserId(c.req.query('updateBy') || tokenUser.id || 'SYSTEM');
        const result = await delayService.deleteDelayRecord(delayId, updateBy);
        if (!result.success) {
            return c.json(result, 404);
        }
        return c.json(result, 200);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error in deleteDelayRecord controller:', error);
        return c.json({ success: false, message }, 500);
    }
};
