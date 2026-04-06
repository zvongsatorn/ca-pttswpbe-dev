import { Context } from 'hono';
import {
    getCalendarConfigsService,
    insertCalendarConfigService,
    deleteCalendarConfigService,
    checkCalendarDuplicateService
} from '../services/calendarService.js';

export const getCalendarConfigs = async (c: Context) => {
    try {
        const configs = await getCalendarConfigsService();
        return c.json({ status: 200, data: configs });
    } catch (error: any) {
        console.error('Error fetching calendar configs:', error);
        return c.json({ status: 500, message: 'Internal server error while fetching calendar configs', error: error.message }, 500);
    }
};

export const createCalendarConfig = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { configDate, configType, timeWarning } = body;
        const employeeId = c.get('user')?.employeeId || body.createBy;

        if (!configDate || !configType || !employeeId) {
            return c.json({ status: 400, message: 'Missing required parameters' }, 400);
        }

        const result = await insertCalendarConfigService({
            configDate,
            configType,
            createBy: employeeId,
            timeWarning
        });

        return c.json({ status: 200, ...result });
    } catch (error: any) {
        console.error('Error creating calendar config:', error);
        return c.json({ status: 500, message: 'Internal server error while creating calendar config', error: error.message }, 500);
    }
};

export const deleteCalendarConfig = async (c: Context) => {
    try {
        const id = c.req.param('id');
        const employeeId = c.get('user')?.employeeId || c.req.query('deleteBy');

        if (!id || !employeeId) {
            return c.json({ status: 400, message: 'Missing ID or employeeId' }, 400);
        }

        const result = await deleteCalendarConfigService(id, employeeId);
        return c.json({ status: 200, ...result });
    } catch (error: any) {
        console.error('Error deleting calendar config:', error);
        return c.json({ status: 500, message: 'Internal server error while deleting calendar config', error: error.message }, 500);
    }
};

export const checkCalendarDuplicate = async (c: Context) => {
    try {
        const month = parseInt(c.req.query('month') || '');
        const year = c.req.query('year') || '';
        const type = parseInt(c.req.query('type') || '');

        if (!month || !year || !type) {
            return c.json({ status: 400, message: 'Missing query parameters (month, year, type)' }, 400);
        }

        const count = await checkCalendarDuplicateService(month, year, type);
        return c.json({ status: 200, count });
    } catch (error: any) {
        console.error('Error checking calendar duplicate:', error);
        return c.json({ status: 500, message: 'Internal server error while checking calendar duplicate', error: error.message }, 500);
    }
};
