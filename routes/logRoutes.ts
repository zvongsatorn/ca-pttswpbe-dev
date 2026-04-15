import { Hono } from 'hono';
import { exportLogAction, getLogAction, insertLogAction, testMailAlert } from '../controllers/logController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const logRoutes = new Hono();

logRoutes.get('/action', getLogAction);
logRoutes.get('/action/export', exportLogAction);
logRoutes.post('/action', verifyToken, insertLogAction);
logRoutes.post('/mail-alert/test', verifyToken, testMailAlert);

export default logRoutes;
