function buildGameApi(request, app, gameId) {
  return {
    getGame() {
      return request(app).get(`/games/${gameId}`);
    },
    patch(payload) {
      return request(app).patch(`/games/${gameId}`).send(payload);
    },
    sleep() {
      return request(app).post(`/games/${gameId}/actions/sleep`).send({});
    },
    travel(destination) {
      return request(app).post(`/games/${gameId}/actions/travel`).send({ destination });
    },
    heal(percentage) {
      return request(app).post(`/games/${gameId}/actions/heal`).send({ percentage });
    },
    buy(itemName, quantity) {
      return request(app).post(`/games/${gameId}/actions/buy-item`).send({ itemName, quantity });
    },
    sell(itemName, quantity) {
      return request(app).post(`/games/${gameId}/actions/sell-item`).send({ itemName, quantity });
    },
    stash(itemName, quantity) {
      return request(app).post(`/games/${gameId}/actions/stash-item`).send({ itemName, quantity });
    },
    retrieve(itemName, quantity) {
      return request(app).post(`/games/${gameId}/actions/retrieve-item`).send({ itemName, quantity });
    },
    stashTransaction(operations) {
      return request(app).post(`/games/${gameId}/actions/stash-transaction`).send({ operations });
    },
    debt(mode, amount) {
      return request(app).post(`/games/${gameId}/debt`).send({ mode, amount });
    },
    encounter() {
      return request(app).get(`/games/${gameId}/encounter`);
    },
    combat(action) {
      return request(app).post(`/games/${gameId}/actions/combat`).send({ action });
    },
    hideout(settlement) {
      return request(app).get(`/games/${gameId}/hideout`).query(settlement ? { settlement } : {});
    }
  };
}

module.exports = {
  buildGameApi
};
