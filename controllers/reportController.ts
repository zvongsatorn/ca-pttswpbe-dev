import { Context } from 'hono';
import { getDashboardDataService, getDashboardExcelDataService, getReport1ExcelDataService, getReport01DataService, getReport02DataService, getReport03DataService, getReport03FilterOptionsService, getReport04DataService, getReport05DataService, getReport06DataService, getReport07DataService, getReport08DataService, getReport09AuditService, getReport09DataService, getReport10SummaryDataService, getReport10ExportDataService } from '../services/reportService.js';
import ExcelJS from 'exceljs';

const normalizeEmployeeId = (value: string): string => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.toUpperCase().match(/[A-Z]\d{7}/);
    if (match) return match[0];
    return raw.slice(0, 8).toUpperCase();
};

const normalizeUserGroupNo = (value: string): string => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, '0');
    const match = raw.match(/\b(\d{1,2})\b/);
    return match ? match[1].padStart(2, '0') : '';
};

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

const DASHBOARD_EXCEL_NON_NUMERIC_KEYS = new Set([
    'ชื่อย่อ',
    'รหัสหน่วยงาน',
    'ชื่อหน่วยงาน',
    'UnitAbbr',
    'OrgUnitNo',
    'UnitName'
]);

const toDashboardExcelNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    const normalized = String(value).replace(/,/g, '').trim();
    if (!normalized) return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const hasOnlyNumericDashboardValues = (key: string, rows: Record<string, unknown>[]) => {
    if (DASHBOARD_EXCEL_NON_NUMERIC_KEYS.has(key)) return false;

    let sawNumber = false;
    for (const row of rows) {
        const parsed = toDashboardExcelNumber(row[key]);
        if (parsed !== null) {
            sawNumber = true;
            continue;
        }
        if (row[key] !== null && row[key] !== undefined && row[key] !== '') return false;
    }

    return sawNumber;
};

const buildDashboardExcelColumns = (rows: Record<string, unknown>[]) => Object.keys(rows[0]).map(key => ({
    header: key,
    key,
    width: 20
}));

const getDashboardExcelNumericKeys = (
    columns: { key?: string | number }[],
    rows: Record<string, unknown>[]
) => columns
    .map(col => String(col.key))
    .filter((key) => hasOnlyNumericDashboardValues(key, rows));

const normalizeDashboardExcelRows = (
    rows: Record<string, unknown>[],
    numericKeys: string[]
) => rows.map((row) => {
    const nextRow: Record<string, unknown> = { ...row };
    numericKeys.forEach((key) => {
        const parsed = toDashboardExcelNumber(row[key]);
        if (parsed !== null) nextRow[key] = parsed;
    });
    return nextRow;
});

const addDashboardExcelTotalRow = (
    worksheet: ExcelJS.Worksheet,
    columns: { key?: string | number }[],
    rows: Record<string, unknown>[],
    numericKeys: string[]
) => {
    if (numericKeys.length === 0) return;

    const totalRow: Record<string, string | number> = {};
    columns.forEach((col) => {
        totalRow[String(col.key)] = '';
    });

    if (columns.length > 0) {
        totalRow[String(columns[0].key)] = 'รวม';
    }

    numericKeys.forEach((key) => {
        totalRow[key] = rows.reduce((acc, row) => acc + (toDashboardExcelNumber(row[key]) ?? 0), 0);
    });

    const addedRow = worksheet.addRow(totalRow);
    addedRow.font = { bold: true };
    addedRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' }
    };
};

const styleDashboardExcelWorksheet = (
    worksheet: ExcelJS.Worksheet,
    columns: { key?: string | number }[],
    numericKeys: string[]
) => {
    const numericKeySet = new Set(numericKeys);
    columns.forEach((col, index) => {
        const key = String(col.key);
        const worksheetColumn = worksheet.getColumn(index + 1);
        worksheetColumn.alignment = {
            horizontal: numericKeySet.has(key) ? 'right' : 'left',
            vertical: 'middle'
        };
        if (numericKeySet.has(key)) worksheetColumn.numFmt = '#,##0';
    });

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
};

const populateDashboardExcelWorksheet = (worksheet: ExcelJS.Worksheet, data: Record<string, unknown>[]) => {
    if (!data || data.length === 0) {
        worksheet.addRow(['No data found']);
        return;
    }

    const columns = buildDashboardExcelColumns(data);
    const numericKeys = getDashboardExcelNumericKeys(columns, data);

    worksheet.columns = columns;
    worksheet.addRows(normalizeDashboardExcelRows(data, numericKeys));
    addDashboardExcelTotalRow(worksheet, columns, data, numericKeys);
    styleDashboardExcelWorksheet(worksheet, columns, numericKeys);
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

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Dashboard');
        populateDashboardExcelWorksheet(worksheet, data as Record<string, unknown>[]);

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

const REPORT01_EXCEL_LEVELS = ['21', '18-20', '16-17', '14-15', '11-13', '9-10', '4-8', 'รวม'];

const addReport01ExcelCols = (
    show: boolean,
    dataKeys: string[],
    headers: string[],
    subKeys: string[],
    subLabels: string[]
) => {
    if (!show) return;
    subKeys.forEach((subKey, index) => {
        dataKeys.push(subKey);
        headers.push(subLabels[index]);
    });
};

const buildReport01ExcelColumns = (checkedList: string[]) => {
    const isShow = (key: string) => checkedList.includes(key);
    const dataKeys: string[] = ['unit', 'unit_name'];
    const headers: string[] = ['กลุ่ม/หน่วยธุรกิจ', 'ชื่อหน่วยงาน'];
    const levels = REPORT01_EXCEL_LEVELS;

    addReport01ExcelCols(isShow('frame_staff'), dataKeys, headers, levels.map((_, i) => 'frame_staff_' + i), levels.map((level) => 'กรอบพนักงาน ' + level));
    addReport01ExcelCols(isShow('people_normal'), dataKeys, headers, levels.map((_, i) => 'people_normal_' + i), levels.map((level) => 'คนปกติ ' + level));
    addReport01ExcelCols(isShow('frame_sec'), dataKeys, headers, levels.map((_, i) => 'frame_sec_' + i), levels.map((level) => 'กรอบSec ' + level));
    addReport01ExcelCols(isShow('people_sec'), dataKeys, headers, levels.map((_, i) => 'people_sec_' + i), levels.map((level) => 'คนSec ' + level));
    addReport01ExcelCols(isShow('total_frame'), dataKeys, headers, ['sum_frame_normal','sum_frame_pool','sum_frame_trad','sum_frame_newbiz','sum_frame_total'], ['รวมกรอบ-ปกติ','รวมกรอบ-Pool','รวมกรอบ-Trad','รวมกรอบ-NB','รวมกรอบ']);
    addReport01ExcelCols(isShow('total_people'), dataKeys, headers, ['sum_people_normal','sum_people_pool','sum_people_trad','sum_people_newbiz','sum_people_total'], ['รวมคน-ปกติ','รวมคน-Pool','รวมคน-Trad','รวมคน-NB','รวมคน']);
    addReport01ExcelCols(isShow('recruit'), dataKeys, headers, ['recruit_total'], ['สรรหา']);
    addReport01ExcelCols(isShow('vacancy'), dataKeys, headers, levels.map((_, i) => 'vacancy_' + i), levels.map((level) => 'ว่าง ' + level));

    if (isShow('contact_out')) {
        dataKeys.push('contact_out');
        headers.push('Contact Out สัญญาใหญ่');
    }
    if (isShow('contact_out_sub')) {
        dataKeys.push('contact_out_sub');
        headers.push('Contact Out สัญญาย่อย');
    }

    return { dataKeys, headers };
};

const configureReport01Worksheet = (worksheet: ExcelJS.Worksheet, dataKeys: string[], headers: string[]) => {
    worksheet.columns = dataKeys.map((_, index) => {
        let width = 10;
        if (index === 0) width = 40;
        if (index === 1) width = 32;
        return { width };
    });

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFDBFE' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
};

const buildReport01ExcelRowData = (item: any, depth: number, dataKeys: string[]) => dataKeys.map((key, index) => {
    if (index === 0) return '    '.repeat(depth) + (item.unit ?? '');
    if (index === 1) return item.unit_name ?? '';
    const value = item[key];
    return (value !== undefined && value !== null && value !== 0) ? value : '';
});

const addReport01ExcelRows = (
    worksheet: ExcelJS.Worksheet,
    rowsData: any[],
    depth: number,
    dataKeys: string[]
): number => {
    let totalRows = 0;
    rowsData.forEach((item) => {
        const row = worksheet.addRow(buildReport01ExcelRowData(item, depth, dataKeys));
        totalRows += 1;
        if (depth === 0) {
            row.font = { bold: true };
            row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
        }
        if (item.children?.length) {
            totalRows += addReport01ExcelRows(worksheet, item.children, depth + 1, dataKeys);
        }
    });
    return totalRows;
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

        console.log('[Backend Excel] Starting report 1 Excel generation.');
        const data = await getReport1ExcelDataService(effectiveDateStr, employeeId, userGroupNo);

        if (!data || data.length === 0) {
            console.warn('[Backend Excel] No data found');
            return c.json({ status: 404, message: "ไม่พบข้อมูล" }, 404);
        }
        console.log('[Backend Excel] Data retrieved: ' + data.length + ' root records');

        const { dataKeys, headers } = buildReport01ExcelColumns(checkedList);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Report 01');
        console.log('[Backend Excel] Headers count: ' + headers.length + ', DataKeys count: ' + dataKeys.length);

        configureReport01Worksheet(worksheet, dataKeys, headers);
        const totalRows = addReport01ExcelRows(worksheet, data, 0, dataKeys);
        console.log('[Backend Excel] Total rows processed: ' + totalRows);

        const buffer = await workbook.xlsx.writeBuffer();
        const dateLabel = effectiveDateStr.replace(/-/g, '');
        const filename = 'Report01_' + dateLabel + '.xlsx';

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
        const orgUnitNo = c.req.query('orgUnitNo') || '';
        const bgNo = c.req.query('bgNo') || '';

        if (!effectiveDate || !employeeId || !userGroupNo) {
            return c.json({ status: 400, message: 'Missing required parameters: effectiveDate, employeeId, userGroupNo' }, 400);
        }

        const data = await getReport07DataService(effectiveDate, employeeId, userGroupNo, division, orgUnitNo, bgNo);

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
        const employeeId = normalizeEmployeeId(c.req.query('employeeId') || '');
        const userGroupNo = normalizeUserGroupNo(c.req.query('userGroupNo') || '');

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
        const errorMessage = String(error?.message || 'Internal server error');
        return c.json({
            status: 500,
            message: errorMessage,
            error: errorMessage
        }, 500);
    }
};

export const getReport9AuditData = async (c: Context) => {
    try {
        const effectiveYear = parseInt(c.req.query('effectiveYear') || '0', 10);

        if (!effectiveYear) {
            return c.json({ status: 400, message: 'Missing required parameter: effectiveYear' }, 400);
        }

        const data = await getReport09AuditService(effectiveYear);

        return c.json({
            status: 200,
            data
        });
    } catch (error: any) {
        console.error('Error in getReport9AuditData controller:', error);
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
