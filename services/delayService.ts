import { sql, poolPromise } from '../config/db.js';
import userGroupService from './userGroupService.js';

export interface DelayRecord {
    key: string;
    DelayID: string;
    EmployeeID: string;
    EmployeeName: string;
    PosName: string;
    DelayYear: string;
    DelayStatus: number;
}

export interface DelayEmployeeOption {
    value: string;
    label: string;
    name: string;
    position: string;
}

interface DelayUpsertPayload {
    employeeId: string;
    posName: string;
    delayYear: number;
    delayStatus: number;
    userId: string;
}

interface EmployeeDirectoryItem {
    name: string;
    position: string;
}

type GenericRow = Record<string, unknown>;

class DelayService {
    private getFirstNonEmpty(row: GenericRow, keys: string[]): string {
        for (const key of keys) {
            const raw = row[key];
            if (raw === null || raw === undefined) continue;
            const text = String(raw).trim();
            if (text !== '') return text;
        }
        return '';
    }

    private normalizeEmployeeRow(row: GenericRow): { employeeId: string; name: string; position: string } | null {
        const employeeId = this.getFirstNonEmpty(row, [
            'EmployeeID', 'employeeID', 'EmployeeId', 'employeeId', 'CODE', 'Code'
        ]);
        if (!employeeId) return null;

        const name = this.getFirstNonEmpty(row, [
            'NameAll', 'nameAll', 'Name', 'name', 'FullName', 'fullName', 'DisplayName', 'FULLNAMETH', 'FULLNAMEENG'
        ]) || employeeId;

        const position = this.getFirstNonEmpty(row, [
            'Position', 'position', 'PosName', 'posName', 'PositionName', 'positionName', 'JobTitle', 'jobTitle'
        ]);

        return { employeeId, name, position };
    }

    private async getEmployeeDirectory(): Promise<Map<string, EmployeeDirectoryItem>> {
        const directory = new Map<string, EmployeeDirectoryItem>();
        const pool = await poolPromise;

        try {
            const result = await pool.request().execute('mp_UserGet');
            const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];

            for (const row of rows) {
                const normalized = this.normalizeEmployeeRow(row);
                if (!normalized) continue;

                directory.set(normalized.employeeId, {
                    name: normalized.name,
                    position: normalized.position
                });
            }
        } catch (error) {
            console.warn('[DelayService.getEmployeeDirectory] mp_UserGet failed, fallback to userGroupService.getAllUsers', error);
        }

        if (directory.size === 0) {
            const fallbackUsers = await userGroupService.getAllUsers();
            for (const user of fallbackUsers) {
                const employeeId = String(user.employeeID || '').trim();
                if (!employeeId) continue;
                directory.set(employeeId, {
                    name: String(user.nameAll || employeeId).trim(),
                    position: ''
                });
            }
        }

        return directory;
    }

    private mapDelayRows(rows: GenericRow[], directory: Map<string, EmployeeDirectoryItem>): DelayRecord[] {
        return rows.map((row) => {
            const delayId = this.getFirstNonEmpty(row, ['DelayID']);
            const employeeId = this.getFirstNonEmpty(row, ['EmployeeID']);
            const employeeInfo = directory.get(employeeId);

            const delayStatusRaw = this.getFirstNonEmpty(row, ['DelayStatus']);
            const delayStatus = Number.parseInt(delayStatusRaw, 10);

            const posNameFromTable = this.getFirstNonEmpty(row, ['PosName']);
            const posName = posNameFromTable || employeeInfo?.position || '';

            return {
                key: delayId,
                DelayID: delayId,
                EmployeeID: employeeId,
                EmployeeName: employeeInfo?.name || employeeId,
                PosName: posName,
                DelayYear: this.getFirstNonEmpty(row, ['DelayYear']),
                DelayStatus: Number.isNaN(delayStatus) ? 0 : delayStatus
            };
        });
    }

    private async getDelayById(delayId: string): Promise<DelayRecord | null> {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .query(`
                SELECT
                    CAST(DelayID AS varchar(18)) AS DelayID,
                    LTRIM(RTRIM(CAST(EmployeeID AS varchar(20)))) AS EmployeeID,
                    LTRIM(RTRIM(COALESCE(PosName, ''))) AS PosName,
                    CAST(DelayYear AS int) AS DelayYear,
                    CAST(DelayStatus AS int) AS DelayStatus
                FROM MP_Delay
                WHERE CAST(DelayID AS varchar(18)) = @DelayID
            `);

        const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
        if (rows.length === 0) return null;

        const directory = await this.getEmployeeDirectory();
        return this.mapDelayRows(rows, directory)[0] || null;
    }

    async getDelayData(delayYear?: number): Promise<DelayRecord[]> {
        const pool = await poolPromise;
        const request = pool.request();

        let query = `
            SELECT
                CAST(DelayID AS varchar(18)) AS DelayID,
                LTRIM(RTRIM(CAST(EmployeeID AS varchar(20)))) AS EmployeeID,
                LTRIM(RTRIM(COALESCE(PosName, ''))) AS PosName,
                CAST(DelayYear AS int) AS DelayYear,
                CAST(DelayStatus AS int) AS DelayStatus
            FROM MP_Delay
            WHERE ISNULL(DelayStatus, 1) = 1
        `;

        if (typeof delayYear === 'number' && Number.isFinite(delayYear)) {
            request.input('DelayYear', sql.Int, delayYear);
            query += ' AND DelayYear = @DelayYear';
        }

        query += ' ORDER BY DelayYear DESC, EmployeeID ASC, DelayID ASC';

        const result = await request.query(query);
        const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
        const directory = await this.getEmployeeDirectory();
        return this.mapDelayRows(rows, directory);
    }

    async getEmployeeOptions(keyword?: string): Promise<DelayEmployeeOption[]> {
        const directory = await this.getEmployeeDirectory();
        const normalizedKeyword = (keyword || '').trim().toLowerCase();

        const options = Array.from(directory.entries())
            .map(([employeeId, info]) => {
                const name = info.name || employeeId;
                return {
                    value: employeeId,
                    label: `${employeeId} - ${name}`,
                    name,
                    position: info.position || ''
                };
            })
            .filter((item) => {
                if (!normalizedKeyword) return true;
                return item.value.toLowerCase().includes(normalizedKeyword) || item.name.toLowerCase().includes(normalizedKeyword);
            })
            .sort((a, b) => a.value.localeCompare(b.value));

        return options;
    }

    async createDelayRecord(payload: DelayUpsertPayload): Promise<{ success: boolean; message?: string; data?: DelayRecord | null }> {
        const pool = await poolPromise;

        const duplicateCheck = await pool.request()
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('DelayYear', sql.Int, payload.delayYear)
            .query(`
                SELECT TOP 1 1 AS Found
                FROM MP_Delay
                WHERE EmployeeID = @EmployeeID
                  AND DelayYear = @DelayYear
                  AND ISNULL(DelayStatus, 1) = 1
            `);

        if ((duplicateCheck.recordset || []).length > 0) {
            return { success: false, message: 'พนักงานรายนี้มีข้อมูลปีที่ทดนี้แล้ว' };
        }

        const now = new Date();
        const insertResult = await pool.request()
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('PosName', sql.VarChar(100), payload.posName)
            .input('DelayYear', sql.Int, payload.delayYear)
            .input('DelayStatus', sql.Int, payload.delayStatus)
            .input('UserID', sql.VarChar(10), payload.userId)
            .input('Now', sql.DateTime, now)
            .query(`
                INSERT INTO MP_Delay
                (
                    EmployeeID, PosName, DelayYear, DelayStatus,
                    CreateBy, CreateDate
                )
                VALUES
                (
                    @EmployeeID, @PosName, @DelayYear, @DelayStatus,
                    @UserID, @Now
                );

                SELECT CAST(SCOPE_IDENTITY() AS varchar(18)) AS DelayID;
            `);

        const createdDelayId = String(insertResult.recordset?.[0]?.DelayID || '').trim();
        if (!createdDelayId) {
            return { success: false, message: 'ไม่สามารถสร้างเลขที่รายการ Delay ได้' };
        }

        const created = await this.getDelayById(createdDelayId);
        return { success: true, data: created };
    }

    async updateDelayRecord(delayId: string, payload: DelayUpsertPayload): Promise<{ success: boolean; message?: string; data?: DelayRecord | null }> {
        const pool = await poolPromise;

        const duplicateCheck = await pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('DelayYear', sql.Int, payload.delayYear)
            .query(`
                SELECT TOP 1 1 AS Found
                FROM MP_Delay
                WHERE EmployeeID = @EmployeeID
                  AND DelayYear = @DelayYear
                  AND ISNULL(DelayStatus, 1) = 1
                  AND CAST(DelayID AS varchar(18)) <> @DelayID
            `);

        if ((duplicateCheck.recordset || []).length > 0) {
            return { success: false, message: 'พนักงานรายนี้มีข้อมูลปีที่ทดนี้แล้ว' };
        }

        const now = new Date();
        const updateResult = await pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('PosName', sql.VarChar(100), payload.posName)
            .input('DelayYear', sql.Int, payload.delayYear)
            .input('DelayStatus', sql.Int, payload.delayStatus)
            .input('UserID', sql.VarChar(10), payload.userId)
            .input('Now', sql.DateTime, now)
            .query(`
                UPDATE MP_Delay
                SET
                    EmployeeID = @EmployeeID,
                    PosName = @PosName,
                    DelayYear = @DelayYear,
                    DelayStatus = @DelayStatus,
                    UpdateBy = @UserID,
                    UpdateDate = @Now
                WHERE CAST(DelayID AS varchar(18)) = @DelayID
                  AND ISNULL(DelayStatus, 1) = 1
            `);

        const affected = updateResult.rowsAffected?.[0] || 0;
        if (affected === 0) {
            return { success: false, message: 'ไม่พบข้อมูลที่ต้องการแก้ไข' };
        }

        const updated = await this.getDelayById(delayId);
        return { success: true, data: updated };
    }

    async deleteDelayRecord(delayId: string, userId: string): Promise<{ success: boolean; message?: string }> {
        const pool = await poolPromise;
        const now = new Date();
        const deleteResult = await pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .input('UserID', sql.VarChar(10), userId)
            .input('Now', sql.DateTime, now)
            .query(`
                UPDATE MP_Delay
                SET
                    DelayStatus = 0,
                    UpdateBy = @UserID,
                    UpdateDate = @Now
                WHERE CAST(DelayID AS varchar(18)) = @DelayID
                  AND ISNULL(DelayStatus, 1) = 1
            `);

        const affected = deleteResult.rowsAffected?.[0] || 0;
        if (affected === 0) {
            return { success: false, message: 'ไม่พบข้อมูลที่ต้องการลบ' };
        }

        return { success: true };
    }
}

export default new DelayService();
