import { Hono } from 'hono';
import {
    getSecondmentPools,
    createSecondmentPool,
    updateSecondmentPool,
    getParentUnits,
    getUnitCombo,
    searchUnits
} from '../controllers/secondmentController.js';

const secondmentRoutes = new Hono();

secondmentRoutes.get('/pools', getSecondmentPools);
secondmentRoutes.post('/pools', createSecondmentPool);
secondmentRoutes.put('/pools', updateSecondmentPool);
secondmentRoutes.get('/parent-units', getParentUnits);
secondmentRoutes.get('/units/combo', getUnitCombo);
secondmentRoutes.get('/units/search', searchUnits);

export default secondmentRoutes;
