import { sql, poolPromise } from './config/db.js';

async function runTest() {
    try {
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        try {
            await transaction.request().query(`
                ALTER PROCEDURE mp_TransactionFileInsert
                    @EffectiveDate DATETIME,
                    @TransactionNo VARCHAR(10),
                    @FileName      NVARCHAR(100),
                    @FileUpload    NVARCHAR(50),
                    @CreateBy      VARCHAR(20),
                    @CreateDate    DATETIME,
                    @RefID         DECIMAL(18, 0) = NULL
                AS
                BEGIN
                    SET NOCOUNT ON;
                    INSERT INTO MP_TransactionFile
                        (EffectiveDate, TransactionNo, FileName, FileUpload, CreateBy, CreateDate, RefID, FileStatus)
                    VALUES
                        (@EffectiveDate, @TransactionNo, @FileName, @FileUpload, @CreateBy, @CreateDate, @RefID, 1);
                END
            `);
            
            await transaction.request().query(`
                UPDATE MP_TransactionFile
                SET FileStatus = 1
                WHERE FileStatus IS NULL;
            `);
            
            await transaction.request().query(`
                UPDATE MP_TransactionFile
                SET RefID = NULL
                WHERE RefID = 0;
            `);
            
            await transaction.commit();
            console.log("Database fixed successfully!");
        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
runTest();
