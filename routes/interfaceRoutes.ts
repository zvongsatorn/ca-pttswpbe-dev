import { Hono } from 'hono';
import { uploadHrpData, uploadInfoData } from '../controllers/interfaceController.js';

const app = new Hono();

app.post('/infodata/upload', uploadInfoData);
app.post('/hrp/upload', uploadHrpData);

export default app;
