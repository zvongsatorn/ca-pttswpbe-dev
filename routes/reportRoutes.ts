import { Hono } from 'hono';
import { getDashboardData, exportDashboardExcel, getReport1Data, getReport1ExcelData, getReport2Data, getReport3Data, getReport3FilterOptions, getReport4Data, getReport4FilterOptions, getReport5Data, getReport5FilterOptions, getReport6Data, getReport6FilterOptions, getReport7Data, getReport7FilterOptions, getReport8Data, getReport9Data, getReport10Data, getReport10ExcelData } from '../controllers/reportController.js';

const router = new Hono();

router.get('/dashboard', getDashboardData);
router.get('/dashboard/excel', exportDashboardExcel);
router.get('/report1', getReport1Data);
router.get('/report1/excel', getReport1ExcelData);
router.get('/report2', getReport2Data);
router.get('/report3/filters', getReport3FilterOptions);
router.get('/report3', getReport3Data);
router.get('/report4/filters', getReport4FilterOptions);
router.get('/report4', getReport4Data);
router.get('/report5/filters', getReport5FilterOptions);
router.get('/report5', getReport5Data);
router.get('/report6/filters', getReport6FilterOptions);
router.get('/report6', getReport6Data);
router.get('/report7/filters', getReport7FilterOptions);
router.get('/report7', getReport7Data);
router.get('/report8', getReport8Data);
router.get('/report9', getReport9Data);
router.get('/report10', getReport10Data);
router.get('/report10/excel', getReport10ExcelData);

export default router;
