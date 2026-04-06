import { Context } from 'hono';
import retirementService from '../services/retirementService.js';

export const getRetirement = async (c: Context) => {
    try {
        const effectiveYearStr = c.req.query('effectiveYear');
        if (!effectiveYearStr) {
            return c.json({ success: false, message: 'Missing effectiveYear' }, 400);
        }
        const effectiveYear = parseInt(effectiveYearStr);
        const result = await retirementService.getRetirementData(effectiveYear);
        
        return c.json({
            success: true,
            data: result
        }, 200);
    } catch (error: any) {
        console.error('Error in getRetirement controller:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while fetching retirement data',
            error: error.message 
        }, 500);
    }
};

export const saveRetirement = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { effectiveYear, rates, remark, user } = body;

        if (!effectiveYear || !rates || !user) {
            return c.json({ success: false, message: 'Missing required parameters' }, 400);
        }

        const result = await retirementService.saveRetirementData(
            parseInt(effectiveYear),
            rates,
            remark || '',
            user
        );
        
        return c.json(result, 200);
    } catch (error: any) {
        console.error('Error in saveRetirement controller:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while saving retirement data',
            error: error.message 
        }, 500);
    }
};

export const copyRetirement = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { fromYear, toYear, user } = body;

        if (!fromYear || !toYear || !user) {
            return c.json({ success: false, message: 'Missing required parameters' }, 400);
        }

        const result = await retirementService.copyRetirementData(
            parseInt(fromYear),
            parseInt(toYear),
            user
        );
        
        return c.json(result, 200);
    } catch (error: any) {
        console.error('Error in copyRetirement controller:', error);
        return c.json({ 
            success: false, 
            message: 'Internal server error while copying retirement data',
            error: error.message 
        }, 500);
    }
};
