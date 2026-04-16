import { Hono } from 'hono';
import { uploadInfoData } from '../controllers/interfaceController.js';

const app = new Hono();

app.post('/infodata/upload', uploadInfoData);

export default app;
