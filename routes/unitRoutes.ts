import { Hono } from 'hono';
import { getUnitsByRole, getLevelsByUnit, getAllUnitsByEffectiveDate } from '../controllers/unitController.js';

const app = new Hono();

// GET /api/units/by-role?empId=XXX&roleId=YYY
app.get('/by-role', getUnitsByRole);

// GET /api/units/levels?checkDate=20260301&unit=80000032&userGroupNo=04
app.get('/levels', getLevelsByUnit);

// GET /api/units/all?effectiveDate=2026-03-01
app.get('/all', getAllUnitsByEffectiveDate);

export default app;
