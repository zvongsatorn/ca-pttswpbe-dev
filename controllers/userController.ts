import { Context } from 'hono';
import * as userService from '../services/userService.js';

export const getUserOther = async (c: Context) => {
    try {
        const result = await userService.getUserOtherService();
        return c.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error in getUserOther controller:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};

export const insertUserOther = async (c: Context) => {
    try {
        const body = await c.req.json();
        const { employeeId, fullName, createBy } = body;

        if (!employeeId || !fullName || !createBy) {
            return c.json({ success: false, message: 'Missing required parameters' }, 400);
        }

        const result = await userService.insertUserOtherService(employeeId, fullName, createBy);
        
        // Follow legacy logic: if result[0].CheckUser == "1", it means user already exists
        if (result && result.length > 0 && result[0].CheckUser === "1") {
            return c.json({ success: false, message: 'มี EmployeeID นี้ในระบบแล้ว', code: 'DUP' });
        }

        return c.json({ success: true, message: 'ทำการเพิ่มข้อมูลเรียบร้อย', data: result });
    } catch (error: any) {
        console.error('Error in insertUserOther controller:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};

export const deleteUserOther = async (c: Context) => {
    try {
        const employeeId = c.req.param('employeeId');
        const updateBy = c.req.query('updateBy') || '';

        if (!employeeId || !updateBy) {
            return c.json({ success: false, message: 'Missing required parameters' }, 400);
        }

        await userService.deleteUserOtherService(employeeId, updateBy);
        return c.json({ success: true, message: 'ลบข้อมูลเรียบร้อย' });
    } catch (error: any) {
        console.error('Error in deleteUserOther controller:', error);
        return c.json({ success: false, message: error.message }, 500);
    }
};
