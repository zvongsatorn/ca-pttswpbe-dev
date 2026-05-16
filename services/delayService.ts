import { sql, poolPromise } from '../config/db.js';
import userGroupService from './userGroupService.js';

export interface DelayRecord {
    key: string;
    DelayID: string;
    EmployeeID: string;
    EmployeeName: string;
    PosName: string;
    UnitName?: string;
    BUSupport?: string;
    RetirementYear?: string;
    DelayYear: string;
    DelayStatus: number;
    DelayType?: number;
}

export interface DelayEmployeeOption {
    value: string;
    label: string;
    name: string;
    position: string;
    buSupport: string;
    unitName: string;
    delayType: number;
}

interface DelayUpsertPayload {
    employeeId: string;
    posName: string;
    retirementYear?: number | null;
    delayYear: number;
    delayStatus: number;
    delayType?: number | null;
    userId: string;
}

interface EmployeeDirectoryItem {
    name: string;
    position: string;
}

interface EmployeeOrgMetaItem {
    unitName: string;
    delayType: number | null;
}

type GenericRow = Record<string, unknown>;

type EmployeeProfileResult = {
    retireYear: number | null;
    delayType: number | null;
    posName: string | null;
};

const NON_COUNT_DELAY_YEAR = 9999;

const toTrimText = (value: unknown): string => String(value || '').trim();

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

    private normalizeDelayType(value: unknown): number | null {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        if (!Number.isFinite(parsed)) return null;
        return parsed === 2 ? 2 : 1;
    }

    private getDelayTypeLabel(delayType: unknown): string {
        return this.normalizeDelayType(delayType) === 2 ? 'Support' : 'Business';
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

    private mapEmployeeOptionRow(row: GenericRow): DelayEmployeeOption | null {
        const employeeId = this.getFirstNonEmpty(row, ['employee_id', 'EmployeeID']);
        if (!employeeId) return null;

        const name = this.getFirstNonEmpty(row, ['employee_name', 'EmployeeName']) || employeeId;
        const position = this.getFirstNonEmpty(row, ['pos_name', 'PosName']);
        const buSupport = this.getFirstNonEmpty(row, ['bu_support', 'BUSupport']);
        const unitName = this.getFirstNonEmpty(row, ['unit_name', 'UnitName']);
        const delayType = this.normalizeDelayType(this.getFirstNonEmpty(row, ['delay_type', 'DelayType'])) || 1;

        return {
            value: employeeId,
            label: `${employeeId} - ${name}`,
            name,
            position,
            buSupport: buSupport || '-',
            unitName: unitName || '-',
            delayType
        };
    }

    private async getEmployeeOptionsFromInfoData(retireYear?: number, keyword?: string): Promise<DelayEmployeeOption[]> {
        const pool = await poolPromise;
        const keywordLike = `%${(keyword || '').trim()}%`;
        const result = await pool.request()
            .input('RetireYear', sql.Int, typeof retireYear === 'number' && Number.isFinite(retireYear) ? retireYear : null)
            .input('KeywordLike', sql.NVarChar(128), keywordLike)
            .input('EffectiveDate', sql.DateTime, new Date())
            .execute('MP_DelayEmployeeOptions');
        const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];

        return rows
            .map((row) => this.mapEmployeeOptionRow(row))
            .filter((item): item is DelayEmployeeOption => item !== null);
    }

    private mapRetireYearRows(rows: unknown): number[] {
        return Array.isArray(rows)
            ? (rows as GenericRow[])
                .map((row) => Number.parseInt(String(row.retire_year), 10))
                .filter((year) => Number.isFinite(year))
            : [];
    }

    private async getRetireYearOptionsFromInfoData(pool: sql.ConnectionPool): Promise<number[]> {
        const result = await pool.request()
            .input('EffectiveDate', sql.DateTime, new Date())
            .execute('MP_DelayRetireYearOptionsFromInfoData');

        return this.mapRetireYearRows(result.recordset);
    }

    private async getRetireYearOptionsFromDelayTable(pool: sql.ConnectionPool): Promise<number[]> {
        const fallbackResult = await pool.request()
            .input('NonCountDelayYear', sql.Int, NON_COUNT_DELAY_YEAR)
            .execute('MP_DelayRetireYearOptionsFromDelay');

        return this.mapRetireYearRows(fallbackResult.recordset);
    }

    async getRetireYearOptions(): Promise<number[]> {
        const pool = await poolPromise;

        try {
            const years = await this.getRetireYearOptionsFromInfoData(pool);
            if (years.length > 0) return years;
        } catch (error) {
            console.warn('[DelayService.getRetireYearOptions] InfoData/interfaceposition source unavailable, fallback to MP_Delay', error);
        }

        try {
            return await this.getRetireYearOptionsFromDelayTable(pool);
        } catch (error) {
            console.warn('[DelayService.getRetireYearOptions] MP_Delay fallback failed', error);
            return [];
        }
    }

    private getEmptyEmployeeProfile(): EmployeeProfileResult {
        return { retireYear: null, delayType: null, posName: null };
    }

    private mapEmployeeProfileResult(row: GenericRow | undefined): EmployeeProfileResult {
        const retireYearRaw = row?.retire_year;
        const retireYear = Number.parseInt(String(retireYearRaw), 10);
        return {
            retireYear: Number.isFinite(retireYear) ? retireYear : null,
            delayType: this.normalizeDelayType(row?.delay_type),
            posName: this.getFirstNonEmpty(row || {}, ['pos_name', 'PosName']) || null
        };
    }

    private async getEmployeeProfile(employeeId: string): Promise<EmployeeProfileResult> {
        const normalizedEmployeeId = toTrimText(employeeId);
        if (!normalizedEmployeeId) return this.getEmptyEmployeeProfile();

        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('EmployeeID', sql.VarChar(32), normalizedEmployeeId)
                .input('EffectiveDate', sql.DateTime, new Date())
                .execute('MP_DelayEmployeeProfile');
            return this.mapEmployeeProfileResult(result.recordset?.[0] as GenericRow | undefined);
        } catch (error) {
            console.warn('[DelayService.getEmployeeProfile] fallback to empty profile', error);
            return this.getEmptyEmployeeProfile();
        }
    }

    private async getEmployeeNameMapFromInfoData(employeeIds: string[]): Promise<Map<string, string>> {
        const uniqueIds = Array.from(new Set(employeeIds.map((id) => toTrimText(id)).filter(Boolean)));
        const nameMap = new Map<string, string>();
        if (!uniqueIds.length) return nameMap;

        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('EmployeeIdsCsv', sql.NVarChar(sql.MAX), uniqueIds.join(','))
                .execute('MP_DelayEmployeeNameMap');

            const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
            rows.forEach((row) => {
                const employeeId = this.getFirstNonEmpty(row, ['employee_id', 'EmployeeID']);
                const employeeName = this.getFirstNonEmpty(row, ['employee_name', 'EmployeeName']);
                if (!employeeId || !employeeName) return;
                nameMap.set(employeeId, employeeName);
            });
        } catch (error) {
            console.warn('[DelayService.getEmployeeNameMapFromInfoData] fallback to employee directory name', error);
        }

        return nameMap;
    }

    private async getEmployeePositionMapFromInfoData(employeeIds: string[]): Promise<Map<string, string>> {
        const uniqueIds = Array.from(new Set(employeeIds.map((id) => toTrimText(id)).filter(Boolean)));
        const positionMap = new Map<string, string>();
        if (!uniqueIds.length) return positionMap;

        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('EmployeeIdsCsv', sql.NVarChar(sql.MAX), uniqueIds.join(','))
                .execute('MP_DelayEmployeePositionMap');

            const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
            rows.forEach((row) => {
                const employeeId = this.getFirstNonEmpty(row, ['employee_id', 'EmployeeID']);
                const posName = this.getFirstNonEmpty(row, ['pos_name', 'PosName']);
                if (!employeeId || !posName) return;
                positionMap.set(employeeId, posName);
            });
        } catch (error) {
            console.warn('[DelayService.getEmployeePositionMapFromInfoData] fallback to employee directory position', error);
        }

        return positionMap;
    }

    private addEmployeeOrgMetaRows(metaMap: Map<string, EmployeeOrgMetaItem>, rows: GenericRow[]) {
        rows.forEach((row) => {
            const employeeId = this.getFirstNonEmpty(row, ['employee_id', 'EmployeeID']);
            if (!employeeId) return;

            metaMap.set(employeeId, {
                unitName: this.getFirstNonEmpty(row, ['unit_name', 'UnitName']),
                delayType: this.normalizeDelayType(this.getFirstNonEmpty(row, ['delay_type', 'DelayType']))
            });
        });
    }

    private async getEmployeeOrgMetaMap(employeeIds: string[]): Promise<Map<string, EmployeeOrgMetaItem>> {
        const uniqueIds = Array.from(new Set(employeeIds.map((id) => toTrimText(id)).filter(Boolean)));
        const metaMap = new Map<string, EmployeeOrgMetaItem>();
        if (!uniqueIds.length) return metaMap;

        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('EmployeeIdsCsv', sql.NVarChar(sql.MAX), uniqueIds.join(','))
                .input('EffectiveDate', sql.DateTime, new Date())
                .execute('MP_DelayEmployeeOrgMeta');
            const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
            this.addEmployeeOrgMetaRows(metaMap, rows);
        } catch (error) {
            console.warn('[DelayService.getEmployeeOrgMetaMap] fallback to default org meta', error);
        }

        return metaMap;
    }

    private mapDelayRows(
        rows: GenericRow[],
        directory: Map<string, EmployeeDirectoryItem>,
        infoNameMap: Map<string, string> = new Map(),
        infoPositionMap: Map<string, string> = new Map(),
        orgMetaMap: Map<string, EmployeeOrgMetaItem> = new Map()
    ): DelayRecord[] {
        return rows.map((row) => {
            const delayId = this.getFirstNonEmpty(row, ['DelayID']);
            const employeeId = this.getFirstNonEmpty(row, ['EmployeeID']);
            const employeeInfo = directory.get(employeeId);
            const employeeOrgMeta = orgMetaMap.get(employeeId);

            const delayStatusRaw = this.getFirstNonEmpty(row, ['DelayStatus']);
            const delayStatus = Number.parseInt(delayStatusRaw, 10);
            const delayType =
                this.normalizeDelayType(this.getFirstNonEmpty(row, ['DelayType'])) ??
                employeeOrgMeta?.delayType ??
                null;

            const posNameFromTable = this.getFirstNonEmpty(row, ['PosName']);
            const posName = posNameFromTable || infoPositionMap.get(employeeId) || employeeInfo?.position || '';

            return {
                key: delayId,
                DelayID: delayId,
                EmployeeID: employeeId,
                EmployeeName: infoNameMap.get(employeeId) || employeeInfo?.name || employeeId,
                PosName: posName,
                UnitName: employeeOrgMeta?.unitName || '',
                BUSupport: delayType ? this.getDelayTypeLabel(delayType) : '',
                RetirementYear: this.getFirstNonEmpty(row, ['RetirementYear']),
                DelayYear: this.getFirstNonEmpty(row, ['DelayYear']),
                DelayStatus: Number.isNaN(delayStatus) ? 0 : delayStatus,
                DelayType: delayType ?? undefined
            };
        });
    }

    private async getDelayById(delayId: string): Promise<DelayRecord | null> {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .execute('MP_DelayGetById');

        const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
        if (rows.length === 0) return null;

        const employeeIds = rows.map((row) => this.getFirstNonEmpty(row, ['EmployeeID']));
        const [directory, infoNameMap, infoPositionMap, orgMetaMap] = await Promise.all([
            this.getEmployeeDirectory(),
            this.getEmployeeNameMapFromInfoData(employeeIds),
            this.getEmployeePositionMapFromInfoData(employeeIds),
            this.getEmployeeOrgMetaMap(employeeIds)
        ]);
        return this.mapDelayRows(rows, directory, infoNameMap, infoPositionMap, orgMetaMap)[0] || null;
    }

    async getDelayData(delayYear?: number): Promise<DelayRecord[]> {
        const pool = await poolPromise;
        const selectedYear = typeof delayYear === 'number' && Number.isFinite(delayYear) ? delayYear : null;
        const result = await pool.request()
            .input('SelectedYear', sql.Int, selectedYear)
            .execute('MP_DelayList');
        const rows = Array.isArray(result.recordset) ? (result.recordset as GenericRow[]) : [];
        const employeeIds = rows.map((row) => this.getFirstNonEmpty(row, ['EmployeeID']));
        const [directory, infoNameMap, infoPositionMap, orgMetaMap] = await Promise.all([
            this.getEmployeeDirectory(),
            this.getEmployeeNameMapFromInfoData(employeeIds),
            this.getEmployeePositionMapFromInfoData(employeeIds),
            this.getEmployeeOrgMetaMap(employeeIds)
        ]);
        return this.mapDelayRows(rows, directory, infoNameMap, infoPositionMap, orgMetaMap);
    }

    async getEmployeeOptions(keyword?: string, retireYear?: number): Promise<DelayEmployeeOption[]> {
        const normalizedKeyword = (keyword || '').trim().toLowerCase();

        try {
            return await this.getEmployeeOptionsFromInfoData(retireYear, keyword);
        } catch (error) {
            console.warn('[DelayService.getEmployeeOptions] InfoData/interfaceposition source unavailable, fallback to employee directory', error);
        }

        const directory = await this.getEmployeeDirectory();
        const options = Array.from(directory.entries())
            .map(([employeeId, info]) => {
                const name = info.name || employeeId;
                return {
                    value: employeeId,
                    label: `${employeeId} - ${name}`,
                    name,
                    position: info.position || '',
                    buSupport: '-',
                    unitName: '-',
                    delayType: 1
                };
            })
            .filter((item) => {
                if (!normalizedKeyword) return true;
                return item.value.toLowerCase().includes(normalizedKeyword) || item.name.toLowerCase().includes(normalizedKeyword);
            })
            .sort((a, b) => a.value.localeCompare(b.value));

        return options;
    }

    private async hasDuplicateDelay(pool: sql.ConnectionPool, employeeId: string, delayYear: number, excludeDelayId: string | null = null): Promise<boolean> {
        const result = await pool.request()
            .input('EmployeeID', sql.VarChar(8), employeeId)
            .input('DelayYear', sql.Int, delayYear)
            .input('ExcludeDelayID', sql.VarChar(18), excludeDelayId)
            .execute('MP_DelayDuplicateExists');

        return (result.recordset || []).length > 0;
    }

    async createDelayRecord(payload: DelayUpsertPayload): Promise<{ success: boolean; message?: string; data?: DelayRecord | null }> {
        const pool = await poolPromise;
        const profile = await this.getEmployeeProfile(payload.employeeId);
        const actualRetireYear = profile.retireYear;
        const retireYear = payload.retirementYear ?? actualRetireYear ?? null;
        const delayType = this.normalizeDelayType(payload.delayType) ?? profile.delayType ?? 1;
        const posName = toTrimText(payload.posName) || toTrimText(profile.posName);

        if (actualRetireYear !== null && payload.delayYear === actualRetireYear) {
            return { success: false, message: `ปีที่ทดต้องไม่เท่าปีเกษียณ (${actualRetireYear})` };
        }

        if (await this.hasDuplicateDelay(pool, payload.employeeId, payload.delayYear)) {
            return { success: false, message: 'พนักงานรายนี้มีข้อมูลปีที่ทดนี้แล้ว' };
        }

        const now = new Date();
        const insertRequest = pool.request()
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('PosName', sql.VarChar(100), posName)
            .input('RetirementYear', sql.Int, retireYear)
            .input('DelayYear', sql.Int, payload.delayYear)
            .input('DelayStatus', sql.Int, payload.delayStatus)
            .input('DelayType', sql.Int, delayType)
            .input('UserID', sql.VarChar(10), payload.userId)
            .input('Now', sql.DateTime, now);
        const insertResult = await insertRequest.execute('MP_DelayCreate');

        const createdDelayId = String(insertResult.recordset?.[0]?.DelayID || '').trim();
        if (!createdDelayId) {
            return { success: false, message: 'ไม่สามารถสร้างเลขที่รายการ Delay ได้' };
        }

        const created = await this.getDelayById(createdDelayId);
        return { success: true, data: created };
    }

    async updateDelayRecord(delayId: string, payload: DelayUpsertPayload): Promise<{ success: boolean; message?: string; data?: DelayRecord | null }> {
        const pool = await poolPromise;
        const profile = await this.getEmployeeProfile(payload.employeeId);
        const actualRetireYear = profile.retireYear;
        const retireYear = payload.retirementYear ?? actualRetireYear ?? null;
        const delayType = this.normalizeDelayType(payload.delayType) ?? profile.delayType ?? 1;
        const posName = toTrimText(payload.posName) || toTrimText(profile.posName);

        if (actualRetireYear !== null && payload.delayYear === actualRetireYear) {
            return { success: false, message: `ปีที่ทดต้องไม่เท่าปีเกษียณ (${actualRetireYear})` };
        }

        if (await this.hasDuplicateDelay(pool, payload.employeeId, payload.delayYear, delayId)) {
            return { success: false, message: 'พนักงานรายนี้มีข้อมูลปีที่ทดนี้แล้ว' };
        }

        const now = new Date();
        const updateRequest = pool.request()
            .input('DelayID', sql.VarChar(18), delayId)
            .input('EmployeeID', sql.VarChar(8), payload.employeeId)
            .input('PosName', sql.VarChar(100), posName)
            .input('RetirementYear', sql.Int, retireYear)
            .input('DelayYear', sql.Int, payload.delayYear)
            .input('DelayStatus', sql.Int, payload.delayStatus)
            .input('DelayType', sql.Int, delayType)
            .input('UserID', sql.VarChar(10), payload.userId)
            .input('Now', sql.DateTime, now);
        const updateResult = await updateRequest.execute('MP_DelayUpdate');

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
            .execute('MP_DelayDelete');

        const affected = deleteResult.rowsAffected?.[0] || 0;
        if (affected === 0) {
            return { success: false, message: 'ไม่พบข้อมูลที่ต้องการลบ' };
        }

        return { success: true };
    }
}

export default new DelayService();
