import { Context } from 'hono';
import {
    deleteLandscapeService,
    getLandscapeService,
    hasLandscapePeriodOverlapService,
    insertLandscapeService,
    LandscapePayload,
    updateLandscapeService
} from '../services/landscapeService.js';
import {
    DEFAULT_END_DATE as FORMULA_DEFAULT_END_DATE,
    deleteLandscapeFormulaService,
    getLandscapeFormulaListService,
    getReport7DefaultFormulaConfigService,
    hasLandscapeFormulaPeriodOverlapService,
    insertLandscapeFormulaService,
    isLandscapeFormulaTableReadyService,
    LandscapeFormulaTableMissingError,
    parseLandscapeFormulaJson,
    REPORT7_FORMULA_KEY,
    type LandscapeFormulaPayload,
    updateLandscapeFormulaService
} from '../services/landscapeFormulaService.js';

interface LandscapeBody {
    orgUnitNo?: unknown;
    beginDate?: unknown;
    endDate?: unknown;
    vp?: unknown;
    dm?: unknown;
    sr?: unknown;
    jr?: unknown;
}

interface LandscapeFormulaBody {
    formulaKey?: unknown;
    formulaName?: unknown;
    beginDate?: unknown;
    endDate?: unknown;
    formulaJson?: unknown;
    isActive?: unknown;
    createBy?: unknown;
    updateBy?: unknown;
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

const normalizeLandscapeFormulaPayload = (raw: LandscapeFormulaBody): { data?: LandscapeFormulaPayload; message?: string } => {
    const formulaKey = (toTrimmedText(raw.formulaKey) || REPORT7_FORMULA_KEY).toUpperCase();
    const formulaNameRaw = toTrimmedText(raw.formulaName);
    const formulaName = formulaNameRaw || null;
    const beginDate = toTrimmedText(raw.beginDate);
    const incomingEndDate = toTrimmedText(raw.endDate);
    const endDate = incomingEndDate || FORMULA_DEFAULT_END_DATE;
    const isActive = raw.isActive === undefined ? true : (raw.isActive === true || raw.isActive === 1 || raw.isActive === '1');

    if (!formulaKey) {
        return { message: 'Missing formulaKey parameter' };
    }
    if (formulaKey.length > 100) {
        return { message: 'formulaKey length must not exceed 100 characters' };
    }
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
    if (formulaName && formulaName.length > 255) {
        return { message: 'formulaName length must not exceed 255 characters' };
    }

    let formulaJson = '';
    if (typeof raw.formulaJson === 'string') {
        formulaJson = raw.formulaJson.trim();
    } else if (raw.formulaJson && typeof raw.formulaJson === 'object') {
        try {
            formulaJson = JSON.stringify(raw.formulaJson);
        } catch {
            return { message: 'formulaJson is not serializable JSON' };
        }
    }

    if (!formulaJson) {
        return { message: 'Missing formulaJson parameter' };
    }

    const parsed = parseLandscapeFormulaJson(formulaJson);
    if (!parsed) {
        return {
            message: 'Invalid formulaJson structure for REPORT7 formula'
        };
    }

    return {
        data: {
            formulaKey,
            formulaName,
            beginDate,
            endDate,
            formulaJson: JSON.stringify(parsed),
            isActive
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

export const getLandscapeFormulas = async (c: Context) => {
    try {
        const tableReady = await isLandscapeFormulaTableReadyService();
        if (!tableReady) {
            return c.json({
                success: true,
                tableReady: false,
                data: [],
                message: 'MP_LandscapeFormula table not found. Please run SQL migration.'
            }, 200);
        }

        const result = await getLandscapeFormulaListService();
        return c.json({ success: true, tableReady: true, data: result }, 200);
    } catch (error: any) {
        console.error('Error in getLandscapeFormulas controller:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const getLandscapeFormulaDefault = async (c: Context) => {
    try {
        const data = getReport7DefaultFormulaConfigService();
        return c.json({
            success: true,
            data: {
                formulaKey: REPORT7_FORMULA_KEY,
                formulaJson: data
            }
        }, 200);
    } catch (error: any) {
        console.error('Error in getLandscapeFormulaDefault controller:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const createLandscapeFormula = async (c: Context) => {
    try {
        const body = await c.req.json<LandscapeFormulaBody>();
        const normalized = normalizeLandscapeFormulaPayload(body);
        if (!normalized.data) {
            return c.json({ success: false, message: normalized.message || 'Invalid payload' }, 400);
        }

        const hasOverlap = await hasLandscapeFormulaPeriodOverlapService(normalized.data);
        if (hasOverlap) {
            return c.json({
                success: false,
                message: 'พบสูตรที่ช่วงวันที่ซ้ำกันใน FormulaKey เดียวกัน กรุณาตรวจสอบ period'
            }, 409);
        }

        const createBy = toTrimmedText(body.createBy) || 'SYSTEM';
        await insertLandscapeFormulaService(normalized.data, createBy);
        return c.json({ success: true, message: 'Inserted successfully' }, 201);
    } catch (error: any) {
        if (error instanceof LandscapeFormulaTableMissingError) {
            return c.json({ success: false, message: error.message }, 400);
        }
        console.error('Error in createLandscapeFormula controller:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const updateLandscapeFormula = async (c: Context) => {
    try {
        const formulaId = Number(c.req.param('formulaId') || 0);
        if (!Number.isFinite(formulaId) || formulaId <= 0) {
            return c.json({ success: false, message: 'Invalid formulaId' }, 400);
        }

        const body = await c.req.json<LandscapeFormulaBody>();
        const normalized = normalizeLandscapeFormulaPayload(body);
        if (!normalized.data) {
            return c.json({ success: false, message: normalized.message || 'Invalid payload' }, 400);
        }

        const hasOverlap = await hasLandscapeFormulaPeriodOverlapService(normalized.data, formulaId);
        if (hasOverlap) {
            return c.json({
                success: false,
                message: 'พบสูตรที่ช่วงวันที่ซ้ำกันใน FormulaKey เดียวกัน กรุณาตรวจสอบ period'
            }, 409);
        }

        const updateBy = toTrimmedText(body.updateBy) || 'SYSTEM';
        const updated = await updateLandscapeFormulaService(formulaId, normalized.data, updateBy);
        if (!updated) {
            return c.json({ success: false, message: 'Landscape formula record not found' }, 404);
        }
        return c.json({ success: true, message: 'Updated successfully' }, 200);
    } catch (error: any) {
        if (error instanceof LandscapeFormulaTableMissingError) {
            return c.json({ success: false, message: error.message }, 400);
        }
        console.error('Error in updateLandscapeFormula controller:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};

export const deleteLandscapeFormula = async (c: Context) => {
    try {
        const formulaId = Number(c.req.param('formulaId') || 0);
        if (!Number.isFinite(formulaId) || formulaId <= 0) {
            return c.json({ success: false, message: 'Invalid formulaId' }, 400);
        }

        const deleted = await deleteLandscapeFormulaService(formulaId);
        if (!deleted) {
            return c.json({ success: false, message: 'Landscape formula record not found' }, 404);
        }
        return c.json({ success: true, message: 'Deleted successfully' }, 200);
    } catch (error: any) {
        if (error instanceof LandscapeFormulaTableMissingError) {
            return c.json({ success: false, message: error.message }, 400);
        }
        console.error('Error in deleteLandscapeFormula controller:', error);
        return c.json({ success: false, message: 'Internal server error', error: error.message }, 500);
    }
};
