import { Context } from 'hono';
import { getUnitsByRoleService, getLevelsByUnitService, getAllUnitsByEffectiveDateService } from '../services/unitService.js';


// Controller to handle fetching units by user ID and role
export const getUnitsByRole = async (c: Context) => {
    try {
        const empId = c.req.query('empId');
        const roleId = c.req.query('roleId');

        if (!empId || !roleId) {
            return c.json({ message: 'Missing empId or roleId parameters' }, 400);
        }

        const result = await getUnitsByRoleService(empId, roleId);
        
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching units by role:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching units',
            error: error.message 
        }, 500);
    }
};

export const getLevelsByUnit = async (c: Context) => {
    try {
        const checkDate = c.req.query('checkDate');
        const unit = c.req.query('unit');
        const userGroupNo = c.req.query('userGroupNo');

        if (!checkDate || !unit || !userGroupNo) {
            return c.json({ message: 'Missing checkDate, unit, or userGroupNo parameters' }, 400);
        }

        const result = await getLevelsByUnitService(checkDate, unit, userGroupNo);
        
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching levels by unit:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching levels',
            error: error.message 
        }, 500);
    }
};

export const getAllUnitsByEffectiveDate = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate');

        if (!effectiveDate) {
            return c.json({ message: 'Missing effectiveDate parameter (format: YYYY-MM-DD)' }, 400);
        }

        const result = await getAllUnitsByEffectiveDateService(effectiveDate);

        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error fetching all units by effective date:', error);
        return c.json({
            success: false,
            message: 'Internal server error while fetching units',
            error: error.message
        }, 500);
    }
};
