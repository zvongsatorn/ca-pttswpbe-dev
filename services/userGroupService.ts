import { sql, poolPromise } from '../config/db.js';

class UserGroupService {
    private normalizeUserRows(rows: any[]): { employeeID: string; nameAll: string }[] {
        return (rows || [])
            .map((row: any) => {
                const employeeId = String(row.EmployeeID || row.employeeID || '').trim();
                const nameAll = String(
                    row.NameAll ||
                    row.nameAll ||
                    row.Name ||
                    row.name ||
                    row.FullName ||
                    row.fullName ||
                    employeeId
                ).trim();

                if (!employeeId) return null;
                return {
                    employeeID: employeeId,
                    nameAll: nameAll || employeeId
                };
            })
            .filter((row): row is { employeeID: string; nameAll: string } => row !== null);
    }

    private async getAllUsersFallback() {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            DECLARE @nameCol sysname;

            SELECT TOP (1) @nameCol = COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'MP_User'
              AND COLUMN_NAME IN ('NameAll', 'Name', 'FullName', 'DisplayName')
            ORDER BY CASE COLUMN_NAME
                WHEN 'NameAll' THEN 1
                WHEN 'Name' THEN 2
                WHEN 'FullName' THEN 3
                WHEN 'DisplayName' THEN 4
                ELSE 99
            END;

            DECLARE @sql nvarchar(max) = N'
                SELECT
                    LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(50)))) AS EmployeeID,
                    COALESCE(
                        NULLIF(LTRIM(RTRIM(CAST(' + QUOTENAME(ISNULL(@nameCol, 'EmployeeID')) + N' AS nvarchar(255)))), ''''),
                        LTRIM(RTRIM(CAST(EmployeeID AS nvarchar(50))))
                    ) AS NameAll
                FROM MP_User
                WHERE EmployeeID IS NOT NULL
                ORDER BY EmployeeID;
            ';

            EXEC sp_executesql @sql;
        `);

        return this.normalizeUserRows(result.recordset);
    }

    async getUserGroups() {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('mp_UserGroupGet');
            
        return result.recordset
            .filter((row: any) => row.Display) 
            .map((row: any) => ({
                userGroupNo: row.UserGroupNo,
                userGroupName: row.UserGroupName,
                userGroupRole: row.UserGroupRole,
                levelFlag: row.LevelFlag,
                chkuser: row.ChkUser,
                display: row.Display
            }));
    }

    async getLevelsInGroup(userGroupNo: string, levelFlag: number) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('LevelFlag', sql.Int, levelFlag)
            .execute('mp_UserGroupLevelGet');
        return result.recordset.map((row: any) => ({
            levelGroupNo: row.LevelGroupNo,
            nameAll: row.NameAll
        }));
    }

    async getLevelCombo(levelFlag: number, userGroupNo: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('LevelFlag', sql.Int, levelFlag)
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .execute('mp_LevelGroupGetWithFlag');
        return result.recordset.map((row: any) => ({
            levelGroupNo: row.LevelGroupNo,
            nameAll: row.NameAll
        }));
    }

    async insertLevelInGroup(userGroupNo: string, levelGroupNo: string, createBy: string) {
        const pool = await poolPromise;

        const checkResult = await pool.request()
            .input('LevelGroupNo', sql.NVarChar, levelGroupNo)
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .execute('mp_LevelInGroupCheckExist');

        if (checkResult.recordset.length > 0 && checkResult.recordset[0].CountExist > 0) {
            return false;
        }

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('LevelGroupNo', sql.NVarChar, levelGroupNo)
            .input('BeginDate', sql.Date, new Date())
            .input('EndDate', sql.Date, new Date('9999-12-31'))
            .input('CreateBy', sql.NVarChar, createBy)
            .input('CreateDate', sql.DateTime, new Date())
            .execute('mp_LevelInGroupInsert');

        return true;
    }

    async getAllUsers() {
        const pool = await poolPromise;
        try {
            const result = await pool.request().execute('mp_UserGet');
            return this.normalizeUserRows(result.recordset);
        } catch (spError) {
            console.warn('[UserGroupService.getAllUsers] mp_UserGet failed, using MP_User fallback query.', spError);
            try {
                return await this.getAllUsersFallback();
            } catch (fallbackError) {
                console.error('[UserGroupService.getAllUsers] Fallback query failed.', fallbackError);
                return [];
            }
        }
    }

    async getUsersInGroup(userGroupNo: string) {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .execute('mp_UserInGroupGet');
        return result.recordset.map((row: any) => ({
            employeeID: row.EmployeeID,
            nameAll: row.NameAll || row.Name,
            userGroupNo: row.UserGroupNo
        }));
    }

    async insertUserInGroup(userGroupNo: string, employeeID: string, createBy: string) {
        const pool = await poolPromise;

        const checkResult = await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeID)
            .execute('mp_UserInGroupCheckExist');

        if (checkResult.recordset.length > 0 && checkResult.recordset[0].CountExist > 0) {
            return false;
        }

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeID)
            .input('BeginDate', sql.Date, new Date())
            .input('EndDate', sql.Date, new Date('9999-12-31'))
            .input('CreateBy', sql.NVarChar, createBy)
            .input('CreateDate', sql.DateTime, new Date())
            .execute('mp_UserInGroupInsert');

        return true;
    }

    async deleteUserInGroup(userGroupNo: string, employeeID: string, updateBy: string) {
        const pool = await poolPromise;

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('EmployeeID', sql.NVarChar, employeeID)
            .input('EndDate', sql.Date, yesterday)
            .input('UpdateBy', sql.NVarChar, updateBy)
            .input('UpdateDate', sql.DateTime, new Date())
            .execute('mp_UserInGroupUpdate');
    }

    async deleteLevelInGroup(userGroupNo: string, levelGroupNo: string, updateBy: string) {
        const pool = await poolPromise;

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        await pool.request()
            .input('UserGroupNo', sql.NVarChar, userGroupNo)
            .input('LevelGroupNo', sql.NVarChar, levelGroupNo)
            .input('EndDate', sql.Date, yesterday)
            .input('UpdateBy', sql.NVarChar, updateBy)
            .input('UpdateDate', sql.DateTime, new Date())
            .execute('mp_LevelInGroupUpdate');
    }

    async getGroupsForUser(employeeID: string) {
        const pool = await poolPromise;
        console.log(`Fetching groups for user: ${employeeID}`);
        const result = await pool.request()
            .input('EmployeeID', sql.VarChar(8), employeeID)
            .execute('mp_UserInGroupByEmployeeID');

        console.log(`Found ${result.recordset.length} groups for user ${employeeID}`);
        return result.recordset.map((row: any) => ({
            userGroupNo: row.UserGroupNo,
            userGroupName: row.UserGroupName,
            userGroupRole: row.UserGroupRole
        }));

    }
}

export default new UserGroupService();
