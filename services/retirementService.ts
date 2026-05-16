import { sql, poolPromise } from '../config/db.js';

interface RetirementRateInput {
    year: number;
    rate: number;
    base?: number;
    typeRate?: number;
}

interface RetirementLevelOption {
    LevelGroupNo: string;
    LevelGroupName: string;
    LevelDelayOrder: number | null;
}

interface RateUpsertParams {
    transaction: sql.Transaction;
    effectiveYear: number;
    year: number;
    typeRate: number;
    rate: number;
    base: number;
    user: string;
    now: Date;
}

class RetirementService {
    private isTooManyArgumentsError(error: unknown): boolean {
        const message = String((error as { message?: unknown })?.message || error || '').toLowerCase();
        return message.includes('mp_busupportrateupsert') && message.includes('too many arguments');
    }

    private async upsertRateByStoredProcedure(params: RateUpsertParams) {
        const { transaction, effectiveYear, year, typeRate, rate, base, user, now } = params;
        await new sql.Request(transaction)
            .input('EffectiveYear', sql.Int, effectiveYear)
            .input('Year', sql.Int, year)
            .input('TypeRate', sql.Int, typeRate)
            .input('Rate', sql.Decimal(18, 2), rate)
            .input('Base', sql.Int, base)
            .input('User', sql.VarChar(20), user)
            .input('Now', sql.DateTime, now)
            .execute('mp_BUSupportRateUpsert');
    }

    private async upsertRateByDirectTable(params: RateUpsertParams) {
        const { transaction, effectiveYear, year, typeRate, rate, base, user, now } = params;
        await new sql.Request(transaction)
            .input('EffectiveYear', sql.Int, effectiveYear)
            .input('Year', sql.Int, year)
            .input('TypeRate', sql.Int, typeRate)
            .input('Rate', sql.Decimal(18, 2), rate)
            .input('Base', sql.Int, base)
            .input('User', sql.VarChar(20), user)
            .input('Now', sql.DateTime, now)
            .execute('MP_RetirementRateUpsert');
    }

    private normalizeLevelGroupNo(value: unknown): string {
        return String(value || '').trim();
    }

    private toBEYear(value: unknown): number {
        const year = Number(value);
        if (!Number.isFinite(year)) return new Date().getFullYear() + 543;
        return year < 2500 ? Math.trunc(year) + 543 : Math.trunc(year);
    }

    private toADYear(value: unknown): number {
        const year = Number(value);
        if (!Number.isFinite(year)) return new Date().getFullYear();
        return year > 2500 ? Math.trunc(year) - 543 : Math.trunc(year);
    }

    private mapRetirementLevelOptions(rows: Array<Record<string, unknown>>): RetirementLevelOption[] {
        return rows
            .map((row) => ({
                LevelGroupNo: this.normalizeLevelGroupNo(row.LevelGroupNo),
                LevelGroupName: String(row.LevelGroupName || '').trim(),
                LevelDelayOrder: row.LevelDelayOrder === null || row.LevelDelayOrder === undefined
                    ? null
                    : Number(row.LevelDelayOrder)
            }))
            .filter((row) => row.LevelGroupNo && row.LevelGroupName);
    }

    private async getRetirementLevelOptions(pool: sql.ConnectionPool): Promise<RetirementLevelOption[]> {
        const result = await pool.request().execute('MP_RetirementLevelOptions');
        const rows = Array.isArray(result.recordset) ? result.recordset as Array<Record<string, unknown>> : [];
        return this.mapRetirementLevelOptions(rows);
    }

    private async getRateRowsByStoredProcedure(pool: sql.ConnectionPool, effectiveYearBE: number): Promise<Array<Record<string, unknown>>> {
        const ratesResult = await pool.request()
            .input('EffectiveYear', sql.Int, effectiveYearBE)
            .execute('mp_BUSupportRateGet');
        return Array.isArray(ratesResult.recordset) ? ratesResult.recordset : [];
    }

    private rateRowsNeedDirectFallback(rates: Array<Record<string, unknown>>): boolean {
        const hasTypeRate = rates.some((row) => row.TypeRate !== null && row.TypeRate !== undefined);
        const hasBase = rates.some((row) => row.Base !== null && row.Base !== undefined);
        return !hasTypeRate || !hasBase;
    }

    private async getRateRowsFromHelperProcedure(
        pool: sql.ConnectionPool,
        sourceEffectiveYear: number,
        targetEffectiveYear?: number
    ): Promise<Array<Record<string, unknown>>> {
        const request = pool.request().input('EffectiveYear', sql.Int, sourceEffectiveYear);
        if (targetEffectiveYear !== undefined) {
            request.input('TargetEffectiveYear', sql.Int, targetEffectiveYear);
        }

        const result = await request.execute('MP_RetirementRateRows');
        return Array.isArray(result.recordset) ? result.recordset : [];
    }

    private async getRetirementRateRows(
        pool: sql.ConnectionPool,
        effectiveYearBE: number,
        legacyEffectiveYearAD: number
    ): Promise<Array<Record<string, unknown>>> {
        let rates = await this.getRateRowsByStoredProcedure(pool, effectiveYearBE);

        // Some DB environments/SP versions may not return TypeRate.
        // Fallback to the helper procedure so BU/Support can still be split correctly.
        if (this.rateRowsNeedDirectFallback(rates)) {
            rates = await this.getRateRowsFromHelperProcedure(pool, effectiveYearBE);
        }

        if (!rates.length && legacyEffectiveYearAD !== effectiveYearBE) {
            try {
                rates = await this.getRateRowsFromHelperProcedure(pool, legacyEffectiveYearAD, effectiveYearBE);
            } catch {
                rates = [];
            }
        }

        return rates;
    }

    private normalizeRetirementRateRows(
        rates: Array<Record<string, unknown>>,
        effectiveYearBE: number
    ): Array<Record<string, unknown>> {
        return rates.map((row) => {
            const parsedTypeRate = Number(row.TypeRate);
            const parsedBase = Number(row.Base);
            return {
                ...row,
                EffectiveYear: this.toBEYear(row.EffectiveYear ?? effectiveYearBE),
                Year: this.toBEYear(row.Year),
                TypeRate: parsedTypeRate === 2 ? 2 : 1,
                Base: Number.isFinite(parsedBase) && parsedBase > 0 ? Math.trunc(parsedBase) : 1
            };
        });
    }

    private mapRemarkRow(row: Record<string, unknown> | undefined) {
        return {
            remark: String(row?.Remark || '').trim(),
            levelGroupNo: this.normalizeLevelGroupNo(row?.LevelGroupNo)
        };
    }

    private async getRemarkFromStoredProcedure(pool: sql.ConnectionPool, effectiveYearBE: number) {
        const remarkResult = await pool.request()
            .input('EffectiveYear', sql.Int, effectiveYearBE)
            .execute('mp_BUSupportRateRemarkGet');
        return this.mapRemarkRow(remarkResult.recordset?.[0] as Record<string, unknown> | undefined);
    }

    private async getRemarkFromTable(pool: sql.ConnectionPool, effectiveYear: number) {
        const request = pool.request().input('EffectiveYear', sql.Int, effectiveYear);
        const result = await request.execute('MP_RetirementRemarkRaw');

        if (!Array.isArray(result.recordset) || result.recordset.length === 0) return null;
        return this.mapRemarkRow(result.recordset[0]);
    }

    private async getRetirementRemark(
        pool: sql.ConnectionPool,
        effectiveYearBE: number,
        legacyEffectiveYearAD: number
    ) {
        let { remark, levelGroupNo } = await this.getRemarkFromStoredProcedure(pool, effectiveYearBE);

        try {
            const fallback = await this.getRemarkFromTable(pool, effectiveYearBE);
            if (fallback) {
                remark = fallback.remark;
                levelGroupNo = fallback.levelGroupNo;
            }
        } catch {
            // Keep SP result when direct table fallback is not available.
        }

        if (!remark && legacyEffectiveYearAD !== effectiveYearBE) {
            try {
                const legacyFallback = await this.getRemarkFromTable(pool, legacyEffectiveYearAD);
                if (legacyFallback) {
                    remark = legacyFallback.remark;
                    levelGroupNo = legacyFallback.levelGroupNo;
                }
            } catch {
                // Ignore legacy lookup errors.
            }
        }

        return { remark, levelGroupNo };
    }

    async getRetirementData(effectiveYear: number) {
        const pool = await poolPromise;
        try {
            const effectiveYearBE = this.toBEYear(effectiveYear);
            const legacyEffectiveYearAD = this.toADYear(effectiveYearBE);
            const rateRows = await this.getRetirementRateRows(pool, effectiveYearBE, legacyEffectiveYearAD);
            const rates = this.normalizeRetirementRateRows(rateRows, effectiveYearBE);
            const { remark, levelGroupNo } = await this.getRetirementRemark(pool, effectiveYearBE, legacyEffectiveYearAD);
            const levelGroups = await this.getRetirementLevelOptions(pool);

            return { rates, remark, levelGroupNo, levelGroups };
        } catch (err) {
            console.error('Error in RetirementService.getRetirementData:', err);
            throw err;
        }
    }

    private buildRateUpsertParams(
        transaction: sql.Transaction,
        item: RetirementRateInput,
        effectiveYearBE: number,
        user: string,
        now: Date
    ): RateUpsertParams {
        const parsedTypeRate = Number(item.typeRate);
        const typeRate = parsedTypeRate === 2 ? 2 : 1;
        const year = Number(item.year);
        const rate = Number(item.rate);
        const base = Number(item.base);

        return {
            transaction,
            effectiveYear: effectiveYearBE,
            year: Number.isFinite(year) ? this.toBEYear(year) : effectiveYearBE,
            typeRate,
            rate: Number.isFinite(rate) ? rate : 0,
            base: Number.isFinite(base) && base > 0 ? Math.trunc(base) : 1,
            user,
            now
        };
    }

    private async upsertRateItem(upsertParams: RateUpsertParams, useStoredProcedureWithTypeRate: boolean): Promise<boolean> {
        if (useStoredProcedureWithTypeRate) {
            try {
                await this.upsertRateByStoredProcedure(upsertParams);
                return true;
            } catch (error) {
                if (!this.isTooManyArgumentsError(error)) {
                    throw error;
                }
            }
        }

        await this.upsertRateByDirectTable(upsertParams);
        return false;
    }

    async saveRetirementData(
        effectiveYear: number,
        rates: RetirementRateInput[],
        remark: string,
        levelGroupNo: string,
        user: string
    ) {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const effectiveYearBE = this.toBEYear(effectiveYear);
            const now = new Date();
            const normalizedLevelGroupNo = this.normalizeLevelGroupNo(levelGroupNo);
            let useStoredProcedureWithTypeRate = true;

            // 1. Upsert rates in MP_BUSupportRate
            for (const item of rates) {
                const upsertParams = this.buildRateUpsertParams(transaction, item, effectiveYearBE, user, now);
                useStoredProcedureWithTypeRate = await this.upsertRateItem(upsertParams, useStoredProcedureWithTypeRate);
            }

            // 2. Upsert remark in MP_BUSupportRateRemark
            await new sql.Request(transaction)
                .input('EffectiveYear', sql.Int, effectiveYearBE)
                .input('Remark', sql.VarChar(500), remark)
                .input('User', sql.VarChar(20), user)
                .input('Now', sql.DateTime, now)
                .execute('mp_BUSupportRateRemarkUpsert');

            await new sql.Request(transaction)
                .input('EffectiveYear', sql.Int, effectiveYearBE)
                .input('LevelGroupNo', sql.VarChar(4), normalizedLevelGroupNo || null)
                .execute('MP_RetirementRemarkLevelUpdate');

            await transaction.commit();
            return { success: true };
        } catch (err) {
            await transaction.rollback();
            console.error('Error in RetirementService.saveRetirementData:', err);
            throw err;
        }
    }

    async copyRetirementData(fromYear: number, toYear: number, user: string) {
        const fromYearBE = this.toBEYear(fromYear);
        const toYearBE = this.toBEYear(toYear);
        const data = await this.getRetirementData(fromYearBE);
        if (data.rates.length === 0) {
            return { success: false, message: 'No data found for the source year.' };
        }

        const newRates = data.rates.map((r) => {
            const sourceYear = Number(r.Year);
            const sourceRate = Number(r.Rate);
            return {
                year: toYearBE + ((Number.isFinite(sourceYear) ? this.toBEYear(sourceYear) : fromYearBE) - fromYearBE),
                rate: Number.isFinite(sourceRate) ? sourceRate : 0,
                base: Number.isFinite(Number(r.Base)) && Number(r.Base) > 0 ? Math.trunc(Number(r.Base)) : 1,
                typeRate: Number(r.TypeRate) === 2 ? 2 : 1
            };
        });

        return this.saveRetirementData(toYearBE, newRates, data.remark, data.levelGroupNo || '', user);
    }
}

export default new RetirementService();
