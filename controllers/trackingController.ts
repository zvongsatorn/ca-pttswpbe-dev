import { Context } from 'hono';
import { 
    getTrackingUserLogService, 
    getTrackingUnitLogService 
} from '../services/trackingService.js';

const parseEffectiveDate = (monthRaw?: string, yearRaw?: string): Date | null => {
    if (!monthRaw || !yearRaw) return null;

    const month = Number.parseInt(monthRaw.trim(), 10);
    const year = Number.parseInt(yearRaw.trim(), 10);

    if (!Number.isInteger(month) || !Number.isInteger(year)) return null;
    if (month < 1 || month > 12) return null;
    if (year < 1900 || year > 3000) return null;

    return new Date(year, month - 1, 1);
};

export const getTrackingUsers = async (c: Context) => {
    try {
        const dmonth = c.req.query('dmonth');
        const dyear = c.req.query('dyear'); 
        const userGroupNo = (c.req.query('UserGroupNo') || c.req.query('userGroupNo') || '').trim();
        const employeeId = (c.req.query('EmployeeID') || c.req.query('employeeID') || c.req.query('employeeId') || '').trim();

        console.log('--- API: getTrackingUsers ---');
        console.log('Month:', dmonth, 'Year:', dyear, 'UserGroup:', userGroupNo, 'EmpID:', employeeId);

        if (!dmonth || !dyear || !userGroupNo || !employeeId) {
            console.warn('Missing parameters in getTrackingUsers');
            return c.json({ error: 'Missing required query parameters.' }, 400);
        }

        const effectiveDate = parseEffectiveDate(dmonth, dyear);
        if (!effectiveDate) {
            return c.json({ error: 'Invalid month/year format.' }, 400);
        }

        const data = await getTrackingUserLogService(effectiveDate, userGroupNo, employeeId);
        return c.json(data);
    } catch (error) {
        console.error('Error in getTrackingUsers:', error);
        return c.json({ error: 'Internal Server Error' }, 500);
    }
};

export const getTrackingUnits = async (c: Context) => {
    try {
        const dmonth = c.req.query('dmonth');
        const dyear = c.req.query('dyear');
        const userGroupNo = (c.req.query('UserGroupNo') || c.req.query('userGroupNo') || '').trim();
        const employeeId = (c.req.query('employeeID') || c.req.query('EmployeeID') || c.req.query('employeeId') || '').trim();

        console.log('--- API: getTrackingUnits ---');
        console.log('Month:', dmonth, 'Year:', dyear, 'UserGroup:', userGroupNo, 'EmpID:', employeeId);

        if (!dmonth || !dyear || !userGroupNo || !employeeId) {
            console.warn('Missing parameters in getTrackingUnits');
            return c.json({ error: 'Missing required query parameters.' }, 400);
        }

        const effectiveDate = parseEffectiveDate(dmonth, dyear);
        if (!effectiveDate) {
            return c.json({ error: 'Invalid month/year format.' }, 400);
        }

        const data = await getTrackingUnitLogService(effectiveDate, userGroupNo, employeeId);
        return c.json(data);
    } catch (error) {
        console.error('Error in getTrackingUnits:', error);
        return c.json({ error: 'Internal Server Error' }, 500);
    }
};
