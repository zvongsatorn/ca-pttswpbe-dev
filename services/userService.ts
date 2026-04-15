import { sql, poolPromise } from '../config/db.js';

export const getUserOtherService = async () => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().execute('mp_UserOtherGet');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_UserOtherGet:', error);
        throw error;
    }
};

export const insertUserOtherService = async (employeeId: string, fullName: string, createBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        const now = new Date();
        const endDate = new Date('9999-12-31');

        request.input('EmployeeID', sql.VarChar(50), employeeId);
        request.input('FullName', sql.VarChar(200), fullName);
        request.input('BeginDate', sql.DateTime, now);
        request.input('EndDate', sql.DateTime, endDate);
        request.input('CreateBy', sql.VarChar(50), createBy);
        request.input('CreateDate', sql.DateTime, now);

        const result = await request.execute('mp_UserOtherInsert');
        return result.recordset || [];
    } catch (error) {
        console.error('Error executing mp_UserOtherInsert:', error);
        throw error;
    }
};

export const deleteUserOtherService = async (employeeId: string, updateBy: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        const now = new Date();
        const yesterday = new Date();
        yesterday.setDate(now.getDate() - 1);

        request.input('EmployeeID', sql.VarChar(50), employeeId);
        request.input('EndDate', sql.DateTime, yesterday);
        request.input('UpdateBy', sql.VarChar(50), updateBy);
        request.input('UpdateDate', sql.DateTime, now);

        await request.execute('mp_UserOtherDelete');
        return { success: true };
    } catch (error) {
        console.error('Error executing mp_UserOtherDelete:', error);
        throw error;
    }
};

export const getUserWithPassword = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('EmployeeID', sql.VarChar, employeeId)
            .query('SELECT * FROM MP_User WHERE EmployeeID = @EmployeeID');
        return result.recordset[0];
    } catch (error) {
        console.error('Error in getUserWithPassword:', error);
        return null;
    }
};

export const checkUserOther = async (employeeId: string) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('EmployeeID', sql.VarChar, employeeId)
            .query('SELECT * FROM MP_UserOther WHERE EmployeeID = @EmployeeID');
        return result.recordset[0];
    } catch (error) {
        console.error('Error in checkUserOther:', error);
        return null;
    }
};

export const syncUserFromAD = async (employeeId: string) => {
    return await getUserWithPassword(employeeId);
};

export const getUserByEmail = async (email: string) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('Email', sql.VarChar(200), email)
            .execute('mp_UserGetByEmail');
        const user = result.recordset[0];
        if (user && !user.Name && user.NAME) user.Name = user.NAME; // Case normalization
        return user;
    } catch (error) {
        console.error('Error in getUserByEmail:', error);
        return null;
    }
};

export const updateUserProfilePicture = async (employeeId: string, filename: string) => {
    try {
        const pool = await poolPromise;
        const request = new sql.Request(pool);

        request.input('EmployeeID', sql.VarChar(50), employeeId);
        request.input('ProfilePicture', sql.VarChar(50), filename);

        await request.query('UPDATE MP_User SET ProfilePicture = @ProfilePicture WHERE EmployeeID = @EmployeeID');
        return { success: true };
    } catch (error) {
        console.error('Error in updateUserProfilePicture:', error);
        throw error;
    }
};

export default {
    getUserOtherService,
    insertUserOtherService,
    deleteUserOtherService,
    getUserWithPassword,
    checkUserOther,
    syncUserFromAD,
    getUserByEmail,
    updateUserProfilePicture
};
