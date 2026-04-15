import { Context } from 'hono';
import {
    deleteLandscapeService,
    getLandscapeService,
    hasLandscapePeriodOverlapService,
    insertLandscapeService,
    LandscapePayload,
    updateLandscapeService
} from '../services/landscapeService.js';

interface LandscapeBody {
    orgUnitNo?: unknown;
    beginDate?: unknown;
    endDate?: unknown;
    vp?: unknown;
    dm?: unknown;
    sr?: unknown;
    jr?: unknown;
}

const DEFAULT_END_DATE = '9999-12-31';

const toTrimmedText = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
};

const toFiniteNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const isValidDateOnly = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return false;
    return d.toISOString().slice(0, 10) === value;
};

const normalizeLandscapePayload = (raw: LandscapeBody): { data?: LandscapePayload; message?: string } => {
    const beginDate = toTrimmedText(raw.beginDate);
    const incomingEndDate = toTrimmedText(raw.endDate);
    const endDate = incomingEndDate || DEFAULT_END_DATE;
    const orgUnitRaw = toTrimmedText(raw.orgUnitNo);
    const orgUnitNo = orgUnitRaw || null;

    if (!beginDate) {
        return { message: 'Missing beginDate parameter' };
    }
    if (!isValidDateOnly(beginDate)) {
        return { message: 'Invalid beginDate format. Use YYYY-MM-DD' };
    }
    if (!isValidDateOnly(endDate)) {
        return { message: 'Invalid endDate format. Use YYYY-MM-DD' };
    }
    if (endDate < beginDate) {
        return { message: 'endDate must be greater than or equal to beginDate' };
    }
    if (orgUnitNo && orgUnitNo.length > 8) {
        return { message: 'orgUnitNo length must not exceed 8 characters' };
    }

    const vp = toFiniteNumber(raw.vp);
    const dm = toFiniteNumber(raw.dm);
    const sr = toFiniteNumber(raw.sr);
    const jr = toFiniteNumber(raw.jr);

    if (vp === null || dm === null || sr === null || jr === null) {
        return { message: 'vp, dm, sr and jr must be valid numbers' };
    }

    return {
        data: {
            orgUnitNo,
            beginDate,
            endDate,
            vp,
            dm,
            sr,
            jr
        }
    };
};

export const getLandscape = async (c: Context) => {
    try {
        const result = await getLandscapeService();
        return c.json({ success: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error in getLandscape controller:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const insertLandscape = async (c: Context) => {
    try {
        const body = await c.req.json<LandscapeBody>();
        const normalized = normalizeLandscapePayload(body);

        if (!normalized.data) {
            return c.json({ success: false, message: normalized.message || 'Invalid payload' }, 400);
        }

        const hasOverlap = await hasLandscapePeriodOverlapService(normalized.data);
        if (hasOverlap) {
            return c.json({
                success: false,
                message: 'พบข้อมูลซ้ำในช่วงวันที่ของหน่วยงานเดียวกัน กรุณาตรวจสอบ period'
            }, 409);
        }

        await insertLandscapeService(normalized.data);
        return c.json({ success: true, message: 'Inserted successfully' }, 201);
    } catch (error: any) {
        console.error('Error in insertLandscape controller:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const updateLandscape = async (c: Context) => {
    try {
        const body = await c.req.json<{ original?: LandscapeBody; next?: LandscapeBody }>();
        if (!body.original || !body.next) {
            return c.json({ success: false, message: 'Missing original or next payload' }, 400);
        }

        const original = normalizeLandscapePayload(body.original);
        const next = normalizeLandscapePayload(body.next);

        if (!original.data || !next.data) {
            return c.json({
                success: false,
                message: original.message || next.message || 'Invalid payload'
            }, 400);
        }

        const hasOverlap = await hasLandscapePeriodOverlapService(next.data, original.data);
        if (hasOverlap) {
            return c.json({
                success: false,
                message: 'พบข้อมูลซ้ำในช่วงวันที่ของหน่วยงานเดียวกัน กรุณาตรวจสอบ period'
            }, 409);
        }

        const updated = await updateLandscapeService(original.data, next.data);
        if (!updated) {
            return c.json({ success: false, message: 'Landscape record not found' }, 404);
        }

        return c.json({ success: true, message: 'Updated successfully' }, 200);
    } catch (error: any) {
        console.error('Error in updateLandscape controller:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const deleteLandscape = async (c: Context) => {
    try {
        const body = await c.req.json<{ original?: LandscapeBody }>();
        if (!body.original) {
            return c.json({ success: false, message: 'Missing original payload' }, 400);
        }

        const original = normalizeLandscapePayload(body.original);
        if (!original.data) {
            return c.json({ success: false, message: original.message || 'Invalid payload' }, 400);
        }

        const deleted = await deleteLandscapeService(original.data);
        if (!deleted) {
            return c.json({ success: false, message: 'Landscape record not found' }, 404);
        }

        return c.json({ success: true, message: 'Deleted successfully' }, 200);
    } catch (error: any) {
        console.error('Error in deleteLandscape controller:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};
