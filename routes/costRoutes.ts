import { Hono } from 'hono';
import {
    deleteCost,
    exportCost,
    getCostLevelGroups,
    getCostList,
    getCostTemplate,
    importCost,
    updateCost,
    upsertCost
} from '../controllers/costController.js';

const app = new Hono();

app.get('/', getCostList);
app.post('/', upsertCost);
app.put('/', updateCost);
app.put('/delete', deleteCost);
app.post('/import', importCost);
app.get('/export', exportCost);
app.get('/template', getCostTemplate);
app.get('/level-groups', getCostLevelGroups);

export default app;
