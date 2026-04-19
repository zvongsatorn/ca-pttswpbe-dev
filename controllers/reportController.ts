import { Context } from 'hono';
import { getDashboardDataService, getDashboardExcelDataService, getReport1ExcelDataService, getReport01DataService, getReport02DataService, getReport03DataService, getReport03FilterOptionsService, getReport04DataService, getReport05DataService, getReport06DataService, getReport07DataService, getReport08DataService, getReport09DataService, getReport10SummaryDataService, getReport10ExportDataService } from '../services/reportService.js';
import ExcelJS from 'exceljs';

export const getDashboardData = async (c: Context) => {
    try {
        const effectiveMonth = c.req.query('effectiveMonth') || '';
        const effectiveYear = c.req.query('effectiveYear') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        
        const isSecondmentId = parseInt(c.req.query('isSecondment') || '0', 10);
        // Map frontend ID to backend DB logic: dropdown index minus 1 (legacy: IsSecondment = IsSecondment.Value - 1)
        const isSecondment = isSecondmentId - 1; 

        const division = c.req.query('division') || '';

        if (!effectiveMonth || !effectiveYear || !employeeId) {
            return c.json({ status: 400, message: "Missing required parameters" }, 400);
        }

        const data = await getDashboardDataService(
            effectiveMonth,
            effectiveYear,
            employeeId,
            userGroupNo,
            isSecondment,
            division
        );

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getDashboardData controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const exportDashboardExcel = async (c: Context) => {
    try {
        const effectiveMonth = c.req.query('effectiveMonth') || '';
        const effectiveYear = c.req.query('effectiveYear') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        
        const isSecondmentId = parseInt(c.req.query('isSecondment') || '0', 10);
        const isSecondment = isSecondmentId - 1; 

        const division = c.req.query('division') || '';
        const orgUnits = (c.req.query('orgUnits') || '')
            .split(',')
            .map(v => v.trim())
            .filter(Boolean);

        if (!effectiveMonth || !effectiveYear || !employeeId) {
            return c.json({ status: 400, message: "Missing required parameters" }, 400);
        }

        const data = await getDashboardExcelDataService(
            effectiveMonth,
            effectiveYear,
            employeeId,
            userGroupNo,
            isSecondment,
            division,
            orgUnits
        );

        // Generate Excel using ExcelJS
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Dashboard');

        if (data && data.length > 0) {
            const toNumber = (value: unknown): number | null => {
                if (value === null || value === undefined || value === '') return null;
                if (typeof value === 'number') return Number.isFinite(value) ? value : null;
                const normalized = String(value).replace(/,/g, '').trim();
                if (!normalized) return null;
                const parsed = Number(normalized);
                return Number.isFinite(parsed) ? parsed : null;
            };

            // Define columns based on keys of the first row
            const columns = Object.keys(data[0]).map(key => ({
                header: key,
                key: key,
                width: 20
            }));
            worksheet.columns = columns;

            const rows = data as Record<string, unknown>[];

            // Detect numeric columns for alignment/formatting and total row.
            const nonNumericKeys = new Set(['ชื่อย่อ', 'รหัสหน่วยงาน', 'ชื่อหน่วยงาน', 'UnitAbbr', 'OrgUnitNo', 'UnitName']);
            const numericKeys = columns
                .map(col => String(col.key))
                .filter((key) => {
                    if (nonNumericKeys.has(key)) return false;
                    let sawNumber = false;
                    for (const row of rows) {
                        const parsed = toNumber(row[key]);
                        if (parsed === null) {
                            if (row[key] === null || row[key] === undefined || row[key] === '') continue;
                            return false;
                        }
                        sawNumber = true;
                    }
                    return sawNumber;
                });
            const numericKeySet = new Set(numericKeys);

            // Normalize numeric cells to numbers so Excel aligns/calculates correctly.
            const normalizedRows = rows.map((row) => {
                const nextRow: Record<string, unknown> = { ...row };
                numericKeys.forEach((key) => {
                    const parsed = toNumber(row[key]);
                    if (parsed !== null) {
                        nextRow[key] = parsed;
                    }
                });
                return nextRow;
            });

            // Add rows
            worksheet.addRows(normalizedRows);

            if (numericKeys.length > 0) {
                const totalRow: Record<string, string | number> = {};
                columns.forEach((col) => {
                    totalRow[String(col.key)] = '';
                });
                if (columns.length > 0) {
                    const firstKey = String(columns[0].key);
                    totalRow[firstKey] = 'รวม';
                }

                numericKeys.forEach((key) => {
                    const sum = rows.reduce((acc, row) => acc + (toNumber(row[key]) ?? 0), 0);
                    totalRow[key] = sum;
                });

                const addedRow = worksheet.addRow(totalRow);
                addedRow.font = { bold: true };
                addedRow.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF3F4F6' }
                };
            }

            // Column alignment: text left, numeric right.
            columns.forEach((col, index) => {
                const key = String(col.key);
                const worksheetColumn = worksheet.getColumn(index + 1);

                if (numericKeySet.has(key)) {
                    worksheetColumn.alignment = { horizontal: 'right', vertical: 'middle' };
                    worksheetColumn.numFmt = '#,##0';
                } else {
                    worksheetColumn.alignment = { horizontal: 'left', vertical: 'middle' };
                }
            });

            // Style header after column styles so header keeps centered alignment.
            const headerRow = worksheet.getRow(1);
            headerRow.font = { bold: true };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
            worksheet.addRow(['No data found']);
        }

        const buffer = await workbook.xlsx.writeBuffer();

        return c.body(Buffer.from(buffer), 200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename=Dashboard_${effectiveYear}${effectiveMonth}.xlsx`,
        });

    } catch (error: any) {
        console.error('Error in exportDashboardExcel controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport1Data = async (c: Context) => {
    try {
        const effectiveDateStr = c.req.query('effectiveDate');
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';

        if (!effectiveDateStr || !employeeId) {
            return c.json({ status: 400, message: "Missing required parameters: effectiveDate, employeeId" }, 400);
        }

        const data = await getReport01DataService(effectiveDateStr, employeeId, userGroupNo);

        return c.json({
            status: 200,
            data
        });

    } catch (error: any) {
        console.error('Error in getReport1Data controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport1ExcelData = async (c: Context) => {
    try {
        const effectiveDateStr = c.req.query('effectiveDate');
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const colsQuery = c.req.query('cols') || '';
        const checkedList = colsQuery ? colsQuery.split(',') : [];

        if (!effectiveDateStr || !employeeId) {
            return c.json({ status: 400, message: "Missing required parameters: effectiveDate, employeeId" }, 400);
        }

        console.log(`[Backend Excel] Starting generation for ${effectiveDateStr}, employee: ${employeeId}`);
        const data = await getReport1ExcelDataService(effectiveDateStr, employeeId, userGroupNo);

        if (!data || data.length === 0) {
            console.warn('[Backend Excel] No data found');
            return c.json({ status: 404, message: "ไม่พบข้อมูล" }, 404);
        }
        console.log(`[Backend Excel] Data retrieved: ${data.length} root records`);

        const isShow = (key: string) => checkedList.includes(key);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Report 01');

        const levels = ['21', '18-20', '16-17', '14-15', '11-13', '9-10', '4-8', 'รวม'];
        const dataKeys: string[] = ['unit'];
        const headers: string[] = ['กลุ่ม/หน่วยธุรกิจ'];

        const addCols = (show: boolean, subKeys: string[], subLabels: string[]) => {
            if (!show) return;
            subKeys.forEach((sk, i) => { dataKeys.push(sk); headers.push(subLabels[i]); });
        };

        addCols(isShow('frame_staff'),   levels.map((_, i) => `frame_staff_${i}`),   levels.map(l => `กรอบพนักงาน ${l}`));
        addCols(isShow('people_normal'), levels.map((_, i) => `people_normal_${i}`), levels.map(l => `คนปกติ ${l}`));
        addCols(isShow('frame_sec'),     levels.map((_, i) => `frame_sec_${i}`),     levels.map(l => `กรอบSec ${l}`));
        addCols(isShow('people_sec'),    levels.map((_, i) => `people_sec_${i}`),    levels.map(l => `คนSec ${l}`));
        addCols(isShow('total_frame'),   ['sum_frame_normal','sum_frame_pool','sum_frame_trad','sum_frame_newbiz','sum_frame_total'],  ['รวมกรอบ-ปกติ','รวมกรอบ-Pool','รวมกรอบ-Trad','รวมกรอบ-NB','รวมกรอบ']);
        addCols(isShow('total_people'),  ['sum_people_normal','sum_people_pool','sum_people_trad','sum_people_newbiz','sum_people_total'],['รวมคน-ปกติ','รวมคน-Pool','รวมคน-Trad','รวมคน-NB','รวมคน']);
        addCols(isShow('recruit'),       ['recruit_total'], ['สรรหา']);
        addCols(isShow('vacancy'),       levels.map((_, i) => `vacancy_${i}`),       levels.map(l => `ว่าง ${l}`));
        
        if (isShow('contact_out'))     { dataKeys.push('contact_out');     headers.push('Contact Out'); }
        if (isShow('contact_out_sub')) { dataKeys.push('contact_out_sub'); headers.push('Contact Out สัญญาย่อย'); }

        console.log(`[Backend Excel] Headers count: ${headers.length}, DataKeys count: ${dataKeys.length}`);
        
        worksheet.columns = dataKeys.map((_, i) => ({ width: i === 0 ? 40 : 10 }));

        const hRow = worksheet.addRow(headers);
        hRow.font = { bold: true };
        hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFDBFE' } };
        hRow.alignment = { vertical: 'middle', horizontal: 'center' };

        let totalRows = 0;
        const addRows = (rowsData: any[], depth: number) => {
            rowsData.forEach(item => {
                const rowData = dataKeys.map((k, i) => {
                    if (i === 0) return '    '.repeat(depth) + (item.unit ?? '');
                    const v = item[k];
                    return (v !== undefined && v !== null && v !== 0) ? v : '';
                });
                const row = worksheet.addRow(rowData);
                totalRows++;
                if (depth === 0) { 
                    row.font = { bold: true }; 
                    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }; 
                }
                if (item.children?.length) addRows(item.children, depth + 1);
            });
        };
        addRows(data, 0);
        console.log(`[Backend Excel] Total rows processed: ${totalRows}`);

        const buffer = await workbook.xlsx.writeBuffer();

        const dateLabel = effectiveDateStr.replace(/-/g, '');
        const filename = `Report01_${dateLabel}.xlsx`;

        c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        c.header('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        c.header('Access-Control-Expose-Headers', 'Content-Disposition');

        return c.body(Buffer.from(buffer), 200);

    } catch (error: any) {
        console.error('Error in getReport1ExcelData controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport2Data = async (c: Context) => {
    try {
        const fromDate = (c.req.query('fromDate') || c.req.query('fromdate') || '').trim();
        const toDate = (c.req.query('toDate') || c.req.query('todate') || '').trim();
        const employeeId = (c.req.query('employeeId') || '').trim();
        const userGroupNo = (c.req.query('userGroupNo') || '').trim();

        if (!fromDate || !toDate || !employeeId || !userGroupNo) {
            return c.json({ status: 400, message: "Missing required parameters: fromDate, toDate, employeeId, userGroupNo" }, 400);
        }

        const fromDateObj = new Date(fromDate);
        const toDateObj = new Date(toDate);

        if (Number.isNaN(fromDateObj.getTime()) || Number.isNaN(toDateObj.getTime())) {
            return c.json({ status: 400, message: "Invalid date format. Expected YYYY-MM-DD." }, 400);
        }

        if (fromDateObj > toDateObj) {
            return c.json({ status: 400, message: "fromDate must be less than or equal to toDate" }, 400);
        }

        const data = await getReport02DataService(fromDate, toDate, employeeId, userGroupNo);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport2Data controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport3Data = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const division = c.req.query('division') || '';
        const orgUnitNo = c.req.query('orgUnitNo') || '';
        const bgNo = c.req.query('bgNo') || '';
        const reportType = c.req.query('reportType') || '0';

        if (!effectiveDate || !employeeId) {
            return c.json({ status: 400, message: "Missing required parameters: effectiveDate, employeeId" }, 400);
        }

        const data = await getReport03DataService(
            effectiveDate,
            employeeId,
            userGroupNo,
            division,
            orgUnitNo,
            bgNo,
            reportType
        );

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport3Data controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport3FilterOptions = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const bgNo = c.req.query('bgNo') || '';
        const division = c.req.query('division') || '';

        if (!effectiveDate || !employeeId || !userGroupNo) {
            return c.json(
                { status: 400, message: "Missing required parameters: effectiveDate, employeeId, userGroupNo" },
                400
            );
        }

        const data = await getReport03FilterOptionsService(effectiveDate, employeeId, userGroupNo, bgNo, division);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport3FilterOptions controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport4FilterOptions = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const bgNo = c.req.query('bgNo') || '';
        const division = c.req.query('division') || '';

        if (!effectiveDate || !employeeId || !userGroupNo) {
            return c.json(
                { status: 400, message: "Missing required parameters: effectiveDate, employeeId, userGroupNo" },
                400
            );
        }

        const data = await getReport03FilterOptionsService(effectiveDate, employeeId, userGroupNo, bgNo, division);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport4FilterOptions controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport4Data = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const division = c.req.query('division') || '';
        const orgUnitNo = c.req.query('orgUnitNo') || '';
        const bgNo = c.req.query('bgNo') || '';

        if (!effectiveDate || !employeeId) {
            return c.json({ status: 400, message: "Missing required parameters: effectiveDate, employeeId" }, 400);
        }

        const data = await getReport04DataService(effectiveDate, employeeId, userGroupNo, division, orgUnitNo, bgNo);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport4Data controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport5FilterOptions = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || c.req.query('fromDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const bgNo = c.req.query('bgNo') || '';
        const division = c.req.query('division') || '';

        if (!effectiveDate || !employeeId || !userGroupNo) {
            return c.json(
                { status: 400, message: "Missing required parameters: effectiveDate/fromDate, employeeId, userGroupNo" },
                400
            );
        }

        const data = await getReport03FilterOptionsService(effectiveDate, employeeId, userGroupNo, bgNo, division);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport5FilterOptions controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport5Data = async (c: Context) => {
    try {
        const fromDate = c.req.query('fromDate') || c.req.query('fromdate') || '';
        const toDate = c.req.query('toDate') || c.req.query('todate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const division = c.req.query('division') || '';
        const orgUnitNo = c.req.query('orgUnitNo') || '';

        if (!fromDate || !toDate || !employeeId) {
            return c.json({ status: 400, message: "Missing required parameters: fromDate, toDate, employeeId" }, 400);
        }

        const data = await getReport05DataService(fromDate, toDate, employeeId, userGroupNo, division, orgUnitNo);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport5Data controller:', error);
        return c.json({
            status: 500,
            message: "Internal server error",
            error: error.message
        }, 500);
    }
};

export const getReport6FilterOptions = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const bgNo = c.req.query('bgNo') || '';
        const division = c.req.query('division') || '';

        if (!effectiveDate || !employeeId || !userGroupNo) {
            return c.json(
                { status: 400, message: 'Missing required parameters: effectiveDate, employeeId, userGroupNo' },
                400
            );
        }

        const data = await getReport03FilterOptionsService(effectiveDate, employeeId, userGroupNo, bgNo, division);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport6FilterOptions controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getReport6Data = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const division = c.req.query('division') || '';
        const bgNo = c.req.query('bgNo') || '';

        if (!effectiveDate || !employeeId || !userGroupNo) {
            return c.json({ status: 400, message: 'Missing required parameters: effectiveDate, employeeId, userGroupNo' }, 400);
        }

        const data = await getReport06DataService(effectiveDate, employeeId, userGroupNo, division, bgNo);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport6Data controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getReport7FilterOptions = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const bgNo = c.req.query('bgNo') || '';
        const division = c.req.query('division') || '';

        if (!effectiveDate || !employeeId || !userGroupNo) {
            return c.json(
                { status: 400, message: 'Missing required parameters: effectiveDate, employeeId, userGroupNo' },
                400
            );
        }

        const data = await getReport03FilterOptionsService(effectiveDate, employeeId, userGroupNo, bgNo, division);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport7FilterOptions controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getReport7Data = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const division = c.req.query('division') || '';
        const bgNo = c.req.query('bgNo') || '';

        if (!effectiveDate || !employeeId || !userGroupNo) {
            return c.json({ status: 400, message: 'Missing required parameters: effectiveDate, employeeId, userGroupNo' }, 400);
        }

        const data = await getReport07DataService(effectiveDate, employeeId, userGroupNo, division, bgNo);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport7Data controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getReport8Data = async (c: Context) => {
    try {
        const fromDate = c.req.query('fromDate') || c.req.query('fromdate') || '';
        const toDate = c.req.query('toDate') || c.req.query('todate') || '';
        const effectiveDate = c.req.query('effectiveDate') || toDate || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';
        const bgNo = c.req.query('bgNo') || '';
        const division = c.req.query('division') || '';

        if (!fromDate || !toDate || !employeeId) {
            return c.json({ status: 400, message: 'Missing required parameters: fromDate, toDate, employeeId' }, 400);
        }

        const data = await getReport08DataService(fromDate, toDate, employeeId, userGroupNo, effectiveDate, bgNo, division);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport8Data controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getReport9Data = async (c: Context) => {
    try {
        const effectiveYear = parseInt(c.req.query('effectiveYear') || '0', 10);
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';

        if (!effectiveYear || !employeeId) {
            return c.json({ status: 400, message: 'Missing required parameters: effectiveYear, employeeId' }, 400);
        }

        const data = await getReport09DataService(effectiveYear, employeeId, userGroupNo);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport9Data controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getReport10Data = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';

        if (!effectiveDate || !employeeId) {
            return c.json({ status: 400, message: 'Missing required parameters: effectiveDate, employeeId' }, 400);
        }

        const data = await getReport10SummaryDataService(effectiveDate, employeeId, userGroupNo);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport10Data controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};

export const getReport10ExcelData = async (c: Context) => {
    try {
        const effectiveDate = c.req.query('effectiveDate') || '';
        const employeeId = c.req.query('employeeId') || '';
        const userGroupNo = c.req.query('userGroupNo') || '';

        if (!effectiveDate || !employeeId) {
            return c.json({ status: 400, message: 'Missing required parameters: effectiveDate, employeeId' }, 400);
        }

        const data = await getReport10ExportDataService(effectiveDate, employeeId, userGroupNo);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport10ExcelData controller:', error);
        return c.json({
            status: 500,
            message: 'Internal server error',
            error: error.message
        }, 500);
    }
};
