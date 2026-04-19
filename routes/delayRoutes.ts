import { Hono } from 'hono';
import { verifyToken } from '../middleware/authMiddleware.js';
import {
    getDelayRecords,
    getDelayEmployeeOptions,
    getDelayRetireYearOptions,
    createDelayRecord,
    updateDelayRecord,
    deleteDelayRecord
} from '../controllers/delayController.js';

const app = new Hono();

app.get('/', verifyToken, getDelayRecords);
app.get('/employees', verifyToken, getDelayEmployeeOptions);
app.get('/retire-years', verifyToken, getDelayRetireYearOptions);
app.post('/', verifyToken, createDelayRecord);
app.put('/:delayId', verifyToken, updateDelayRecord);
app.delete('/:delayId', verifyToken, deleteDelayRecord);

export default app;
