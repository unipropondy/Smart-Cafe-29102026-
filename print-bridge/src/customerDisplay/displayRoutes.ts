import { Router } from 'express';
import { updateState, getCurrentState } from './DisplayStateStore';
import { pushStateToDisplay } from './CustomerDisplayManager';
import { getSecondaryDisplay } from './MonitorService';
import { pollerStats } from '../poller';

const router = Router();

// 1. POST /customer-display/update - Push active cart/summary/payment screen state
router.post('/update', (req, res) => {
  updateState(req.body);
  pushStateToDisplay(req.body);
  res.json({ success: true });
});

// 2. POST /customer-display/clear - Force display back to idle attract loop
router.post('/clear', (_req, res) => {
  const idleState = { active: false, paymentSuccess: false };
  updateState(idleState);
  pushStateToDisplay(idleState);
  res.json({ success: true });
});

// 3. GET /customer-display/status - Subsystem health check
router.get('/status', (_req, res) => {
  res.json({
    secondaryMonitorDetected: !!getSecondaryDisplay(),
    lastState: getCurrentState(),
  });
});

// 4. GET /customer-display/health - Merged print + display status
router.get('/health', (_req, res) => {
  res.json({
    print: pollerStats.getHealth(),
    display: {
      secondaryMonitorDetected: !!getSecondaryDisplay(),
    },
  });
});

export default router;
