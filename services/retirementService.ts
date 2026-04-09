import { sql, poolPromise } from '../config/db.js';

class RetirementService {
    async getRetirementData(effectiveYear: number) {
        const pool = await poolPromise;
        try {
            const ratesResult = await pool.request()
                .input('EffectiveYear', sql.Int, effectiveYear)
                .execute('mp_BUSupportRateGet');

            const rates = ratesResult.recordset;
            let remark = '';

            const remarkResult = await pool.request()
                .input('EffectiveYear', sql.Int, effectiveYear)
                .execute('mp_BUSupportRateRemarkGet');

            if (remarkResult.recordset.length > 0) {
                remark = remarkResult.recordset[0].Remark;
            }

            return { rates, remark };
        } catch (err) {
            console.error('Error in RetirementService.getRetirementData:', err);
            throw err;
        }
    }

    async saveRetirementData(effectiveYear: number, rates: { year: number, rate: number }[], remark: string, user: string) {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const now = new Date();

            // 1. Upsert rates in MP_BUSupportRate
            for (const item of rates) {
                await new sql.Request(transaction)
                    .input('EffectiveYear', sql.Int, effectiveYear)
                    .input('Year', sql.Int, item.year)
                    .input('Rate', sql.Decimal(18, 2), item.rate)
                    .input('User', sql.VarChar(20), user)
                    .input('Now', sql.DateTime, now)
                    .execute('mp_BUSupportRateUpsert');
            }

            // 2. Upsert remark in MP_BUSupportRateRemark
            await new sql.Request(transaction)
                .input('EffectiveYear', sql.Int, effectiveYear)
                .input('Remark', sql.VarChar(500), remark)
                .input('User', sql.VarChar(20), user)
                .input('Now', sql.DateTime, now)
                .execute('mp_BUSupportRateRemarkUpsert');

            await transaction.commit();
            return { success: true };
        } catch (err) {
            await transaction.rollback();
            console.error('Error in RetirementService.saveRetirementData:', err);
            throw err;
        }
    }

    async copyRetirementData(fromYear: number, toYear: number, user: string) {
        const data = await this.getRetirementData(fromYear);
        if (data.rates.length === 0) {
            return { success: false, message: 'No data found for the source year.' };
        }

        const newRates = data.rates.map(r => ({
            year: toYear + (r.Year - fromYear),
            rate: r.Rate
        }));

        return this.saveRetirementData(toYear, newRates, data.remark, user);
    }
}

export default new RetirementService();
