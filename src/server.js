const express = require('express');
const gameService = require('./services/gameService');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.status(200).json({
    name: 'wasteland-trader',
    message: 'Wasteland Trader API is online.'
  });
});

app.post('/games', async (_req, res, next) => {
  try {
    const game = await gameService.createGame();
    res.status(201).json(game);
  } catch (error) {
    next(error);
  }
});

app.get('/games/:id', async (req, res, next) => {
  try {
    const game = await gameService.getGame(req.params.id);

    if (!game) {
      return res.status(404).json({
        error: 'Game session not found.'
      });
    }

    return res.status(200).json(game);
  } catch (error) {
    return next(error);
  }
});

app.patch('/games/:id', async (req, res, next) => {
  const validation = gameService.validateUpdatePayload(req.body);

  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  try {
    const result = await gameService.updateGameState(req.params.id, req.body);

    if (result.error === 'not-found') {
      return res.status(404).json({
        error: 'Game session not found.'
      });
    }

    return res.status(200).json(result.game);
  } catch (error) {
    return next(error);
  }
});

app.post('/games/:id/actions/sleep', async (req, res, next) => {
  try {
    const result = await gameService.sleep(req.params.id);

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    if (result.error === 'bad-request') {
      return res.status(400).json({ error: result.message });
    }

    return res.status(200).json(result.game);
  } catch (error) {
    return next(error);
  }
});

app.post('/games/:id/actions/travel', async (req, res, next) => {
  try {
    const result = await gameService.travel(req.params.id, req.body?.destination);

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    if (result.error === 'bad-request') {
      return res.status(400).json({ error: result.message });
    }

    return res.status(200).json(result.game);
  } catch (error) {
    return next(error);
  }
});

app.post('/games/:id/actions/heal', async (req, res, next) => {
  try {
    const result = await gameService.heal(req.params.id, req.body?.percentage);

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    if (result.error === 'bad-request') {
      return res.status(400).json({ error: result.message });
    }

    return res.status(200).json(result.game);
  } catch (error) {
    return next(error);
  }
});

app.get('/games/:id/market', async (req, res, next) => {
  try {
    const result = await gameService.getMarket(req.params.id, req.query?.settlement);

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    return res.status(200).json(result.market);
  } catch (error) {
    return next(error);
  }
});

app.get('/games/:id/hideout', async (req, res, next) => {
  try {
    const result = await gameService.getHideout(req.params.id, req.query?.settlement);

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    return res.status(200).json(result.hideout);
  } catch (error) {
    return next(error);
  }
});

app.get('/games/:id/hideouts', async (req, res, next) => {
  try {
    const result = await gameService.getAllHideouts(req.params.id);

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    const settlementFilterInput = String(req.query?.settlement || '').trim();

    if (!settlementFilterInput) {
      return res.status(200).json(result.hideouts);
    }

    const settlementFilter = gameService.resolveSettlement(settlementFilterInput);

    const filteredItems = settlementFilter
      ? result.hideouts.bySettlement[settlementFilter]
      : undefined;

    if (!Array.isArray(filteredItems)) {
      return res.status(400).json({
        error: 'Unknown settlement filter.'
      });
    }

    return res.status(200).json({
      currentLocation: result.hideouts.currentLocation,
      settlement: settlementFilter,
      items: filteredItems
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/games/:id/actions/buy-item', async (req, res, next) => {
  try {
    const result = await gameService.buyItem(
      req.params.id,
      req.body?.itemName,
      req.body?.quantity
    );

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    if (result.error === 'bad-request') {
      return res.status(400).json({ error: result.message });
    }

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/games/:id/actions/sell-item', async (req, res, next) => {
  try {
    const result = await gameService.sellItem(
      req.params.id,
      req.body?.itemName,
      req.body?.quantity
    );

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    if (result.error === 'bad-request') {
      return res.status(400).json({ error: result.message });
    }

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/games/:id/actions/dump-item', async (req, res, next) => {
  try {
    const result = await gameService.dumpItem(
      req.params.id,
      req.body?.itemName,
      req.body?.quantity
    );

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    if (result.error === 'bad-request') {
      return res.status(400).json({ error: result.message });
    }

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/games/:id/actions/stash-item', async (req, res, next) => {
  try {
    const result = await gameService.stashItem(
      req.params.id,
      req.body?.itemName,
      req.body?.quantity
    );

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    if (result.error === 'bad-request') {
      return res.status(400).json({ error: result.message });
    }

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/games/:id/actions/retrieve-item', async (req, res, next) => {
  try {
    const result = await gameService.retrieveItem(
      req.params.id,
      req.body?.itemName,
      req.body?.quantity
    );

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    if (result.error === 'bad-request') {
      return res.status(400).json({ error: result.message });
    }

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

app.post('/games/:id/debt', async (req, res, next) => {
  try {
    const result = await gameService.handleDebtOperation(
      req.params.id,
      req.body?.mode,
      req.body?.amount
    );

    if (result.error === 'not-found') {
      return res.status(404).json({ error: 'Game session not found.' });
    }

    if (result.error === 'game-ended') {
      return res.status(409).json({
        error: 'Game session has already ended.',
        game: result.game
      });
    }

    if (result.error === 'bad-request') {
      return res.status(400).json({ error: result.message });
    }

    if (result.quote) {
      return res.status(200).json(result.quote);
    }

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

async function startServer() {
  await gameService.initialize();

  return app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer
};
