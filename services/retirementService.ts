import { sql, poolPromise } from '../config/db.js';

class RetirementService {
    async getRetirementData(effectiveYear: number) {
        const pool = await poolPromise;
        try {
            const request = pool.request();
            request.input('EffectiveYear', sql.Int, effectiveYear);
            
            // Fetch rates for 5 years starting from EffectiveYear
            const ratesResult = await request.query(`
                SELECT BUSupportRateID, EffectiveYear, Year, Rate 
                FROM MP_BUSupportRate 
                WHERE EffectiveYear = @EffectiveYear AND BUSupportRateStatus = 1
                ORDER BY Year ASC
            `);

            const rates = ratesResult.recordset;
            let remark = '';

            // Fetch remark directly by EffectiveYear
            const remarkResult = await pool.request()
                .input('EffectiveYear', sql.Int, effectiveYear)
                .query(`
                    SELECT Remark 
                    FROM MP_BUSupportRateRemark 
                    WHERE EffectiveYear = @EffectiveYear AND RemarkStatus = 1
                `);
            
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

            // 1. Upsert rates in MP_BUSupportRate (Match by EffectiveYear and Year)
            for (const item of rates) {
                const upsertRateReq = new sql.Request(transaction);
                upsertRateReq.input('EffectiveYear', sql.Int, effectiveYear);
                upsertRateReq.input('Year', sql.Int, item.year);
                upsertRateReq.input('Rate', sql.Decimal(18, 2), item.rate);
                upsertRateReq.input('User', sql.VarChar(20), user);
                upsertRateReq.input('Now', sql.DateTime, now);

                await upsertRateReq.query(`
                    IF EXISTS (SELECT 1 FROM MP_BUSupportRate WHERE EffectiveYear = @EffectiveYear AND Year = @Year)
                    BEGIN
                        UPDATE MP_BUSupportRate 
                        SET Rate = @Rate, BUSupportRateStatus = 1, UpdateBy = @User, UpdateDate = @Now
                        WHERE EffectiveYear = @EffectiveYear AND Year = @Year
                    END
                    ELSE
                    BEGIN
                        INSERT INTO MP_BUSupportRate (EffectiveYear, Year, Rate, BUSupportRateStatus, CreateBy, CreateDate)
                        VALUES (@EffectiveYear, @Year, @Rate, 1, @User, @Now)
                    END
                `);
            }

            // 2. Upsert remark in MP_BUSupportRateRemark (Match by EffectiveYear)
            const upsertRemarkReq = new sql.Request(transaction);
            upsertRemarkReq.input('EffectiveYear', sql.Int, effectiveYear);
            upsertRemarkReq.input('Remark', sql.VarChar(500), remark);
            upsertRemarkReq.input('User', sql.VarChar(20), user);
            upsertRemarkReq.input('Now', sql.DateTime, now);

            await upsertRemarkReq.query(`
                IF EXISTS (SELECT 1 FROM MP_BUSupportRateRemark WHERE EffectiveYear = @EffectiveYear)
                BEGIN
                    UPDATE MP_BUSupportRateRemark
                    SET Remark = @Remark, RemarkStatus = 1
                    WHERE EffectiveYear = @EffectiveYear
                END
                ELSE
                BEGIN
                    INSERT INTO MP_BUSupportRateRemark (EffectiveYear, Remark, RemarkStatus)
                    VALUES (@EffectiveYear, @Remark, 1)
                END
            `);

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
