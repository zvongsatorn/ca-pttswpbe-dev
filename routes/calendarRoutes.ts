import { Hono } from 'hono';
import {
    getCalendarConfigs,
    createCalendarConfig,
    deleteCalendarConfig,
    checkCalendarDuplicate
} from '../controllers/calendarController.js';

const app = new Hono();

// GET /api/calendar
app.get('/', getCalendarConfigs);

// POST /api/calendar
app.post('/', createCalendarConfig);

// DELETE /api/calendar/:id
app.delete('/:id', deleteCalendarConfig);

// GET /api/calendar/check
app.get('/check', checkCalendarDuplicate);

export default app;
