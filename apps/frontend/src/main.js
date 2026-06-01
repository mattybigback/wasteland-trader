import './styles.css';

const appRoot = document.getElementById('app');

appRoot.innerHTML = `
  <main class="layout">
    <section class="hero">
      <h1>Wasteland Trader</h1>
      <p>Static MVP interface prototype.</p>
    </section>

    <section class="panel events-panel">
      <h2>Events</h2>
      <div class="events-list" aria-label="Events log">
        <p>Day 7: Dust storm warnings across the market district.</p>
        <p>Day 7: Caravan rumor says ammo prices may spike tomorrow.</p>
        <p>Day 6: Friendly scavenger shared a food stash lead.</p>
      </div>
    </section>

    <section class="playfield" aria-label="Main game playfield">
      <section class="panel market-panel">
        <h2>Market</h2>
        <ul class="data-list" aria-label="Market items for sale">
          <li class="data-list-header"><span>Name</span><span>Qty</span><span>Price</span></li>
          <li><span>Water</span><span>8</span><span>14 caps</span></li>
          <li><span>Food</span><span>12</span><span>21 caps</span></li>
          <li><span>Chems</span><span>4</span><span>95 caps</span></li>
          <li><span>Scrap</span><span>6</span><span>38 caps</span></li>
          <li><span>Ammo</span><span>10</span><span>17 caps</span></li>
        </ul>
      </section>

      <section class="center-column" aria-label="Actions and status">
        <section class="panel controls-panel">
          <h2>Actions</h2>
          <div class="button-grid one-up">
            <button id="buy-button" type="button">Buy</button>
            <button id="sell-button" type="button">Sell</button>
            <button id="dump-button" type="button">Dump</button>
          </div>
          <p id="action-feedback" class="action-feedback">Select an item row to begin.</p>
        </section>
        <section class="panel controls-panel">
          <h2>Settlement Locations</h2>
          <div class="button-grid one-up">
            <button type="button">Medic</button>
            <button type="button">Armory</button>
          </div>
        </section>
        <section class="panel controls-panel">
          <h2>End of Day</h2>
          <div class="button-grid one-up">
            <button type="button">Sleep</button>
            <button type="button">Travel</button>
          </div>
        </section>

        <section class="panel status-panel">
          <h2>Status</h2>
          <ul class="status-list" aria-label="Player status">
            <li><span>Location</span><span>Market District</span></li>
            <li><span>Caps</span><span>1200</span></li>
            <li><span>Debt</span><span>4200</span></li>
            <li><span>Health</span><span>84</span></li>
            <li><span>Armour</span><span>Combat Vest</span></li>
            <li><span>Day</span><span>7 of 30</span></li>
            <li><span>Weapon Slot 1</span><span>Pipe Rifle</span></li>
            <li><span>Weapon Slot 2</span><span>Shiv</span></li>
            <li><span>Ammo 1</span><span>42</span></li>
            <li><span>Ammo 2</span><span>18</span></li>
            <li><span>Rank</span><span>1</span></li>
          </ul>
        </section>
      </section>

      <section class="panel inventory-panel">
        <h2>Inventory</h2>
        <p class="capacity">Capacity Left: 4 / 15</p>
        <ul class="data-list" aria-label="Inventory contents">
          <li class="data-list-header"><span>Name</span><span>Qty</span><span>Price</span></li>
          <li><span>Water</span><span>3</span><span>14 caps</span></li>
          <li><span>Food</span><span>4</span><span>21 caps</span></li>
          <li><span>Scrap</span><span>2</span><span>38 caps</span></li>
          <li><span>Chems</span><span>1</span><span>95 caps</span></li>
          <li><span>Ammo</span><span>1</span><span>17 caps</span></li>
        </ul>
      </section>
    </section>

    <div id="trade-modal" class="modal" role="dialog" aria-modal="true" aria-labelledby="trade-modal-title" hidden>
      <div class="modal-panel">
        <h3 id="trade-modal-title">Trade</h3>
        <p id="trade-modal-item" class="modal-item">No item selected.</p>
        <label for="trade-quantity" class="modal-label">Qty</label>
        <input id="trade-quantity" class="modal-input" type="number" min="1" step="1" value="1" />
        <div class="modal-actions">
          <button id="trade-ok" type="button">OK</button>
          <button id="trade-cancel" type="button">Cancel</button>
        </div>
      </div>
    </div>
  </main>
`;

const marketList = document.querySelector('.market-panel .data-list');
const inventoryList = document.querySelector('.inventory-panel .data-list');
const buyButton = document.getElementById('buy-button');
const sellButton = document.getElementById('sell-button');
const dumpButton = document.getElementById('dump-button');
const actionFeedback = document.getElementById('action-feedback');

const tradeModal = document.getElementById('trade-modal');
const tradeModalTitle = document.getElementById('trade-modal-title');
const tradeModalItem = document.getElementById('trade-modal-item');
const tradeQuantityInput = document.getElementById('trade-quantity');
const tradeOkButton = document.getElementById('trade-ok');
const tradeCancelButton = document.getElementById('trade-cancel');

let selectedItem = null;

function readRowData(row) {
  const cells = row.querySelectorAll('span');
  return {
    name: cells[0]?.textContent?.trim() || '',
    qty: Number.parseInt(cells[1]?.textContent?.trim() || '0', 10),
    price: cells[2]?.textContent?.trim() || ''
  };
}

function clearSelection() {
  document.querySelectorAll('.data-list li.selected').forEach((row) => {
    row.classList.remove('selected');
  });
}

function selectRow(row, source) {
  clearSelection();
  row.classList.add('selected');
  selectedItem = {
    ...readRowData(row),
    source
  };
  actionFeedback.textContent = `Selected ${selectedItem.name} from ${source}.`;
}

function addSelectableRows(listElement, source) {
  listElement.querySelectorAll('li:not(.data-list-header)').forEach((row) => {
    row.classList.add('selectable');
    row.tabIndex = 0;

    row.addEventListener('click', () => {
      selectRow(row, source);
    });

    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectRow(row, source);
      }
    });
  });
}

function openTradeModal(action) {
  if (!selectedItem) {
    actionFeedback.textContent = 'Select an item from market or inventory first.';
    return;
  }

  if (action === 'buy' && selectedItem.source !== 'market') {
    actionFeedback.textContent = 'Buy requires selecting an item from Market.';
    return;
  }

  if (action === 'sell' && selectedItem.source !== 'inventory') {
    actionFeedback.textContent = 'Sell requires selecting an item from Inventory.';
    return;
  }

  if (action === 'dump' && selectedItem.source !== 'inventory') {
    actionFeedback.textContent = 'Dump requires selecting an item from Inventory.';
    return;
  }

  const maxQty = Number.isFinite(selectedItem.qty) ? Math.max(selectedItem.qty, 1) : 1;

  tradeModal.dataset.action = action;
  tradeModal.dataset.itemName = selectedItem.name;
  tradeModal.dataset.maxQty = String(maxQty);

  if (action === 'buy') {
    tradeModalTitle.textContent = 'Buy Item';
  } else if (action === 'sell') {
    tradeModalTitle.textContent = 'Sell Item';
  } else {
    tradeModalTitle.textContent = 'Dump Item';
  }
  tradeModalItem.textContent = `${selectedItem.name} (${selectedItem.price}) - available ${selectedItem.qty}`;

  tradeQuantityInput.value = '1';
  tradeQuantityInput.min = '1';
  tradeQuantityInput.max = String(maxQty);

  tradeModal.hidden = false;
  tradeQuantityInput.focus();
}

function closeTradeModal() {
  tradeModal.hidden = true;
}

function confirmTrade() {
  const action = tradeModal.dataset.action;
  const itemName = tradeModal.dataset.itemName;
  const maxQty = Number.parseInt(tradeModal.dataset.maxQty || '1', 10);
  const qty = Number.parseInt(tradeQuantityInput.value || '0', 10);

  if (!Number.isInteger(qty) || qty < 1 || qty > maxQty) {
    actionFeedback.textContent = `Qty must be between 1 and ${maxQty}.`;
    return;
  }

  actionFeedback.textContent = `Prototype ${action}: ${qty} x ${itemName}.`;
  closeTradeModal();
}

buyButton.addEventListener('click', () => {
  openTradeModal('buy');
});

sellButton.addEventListener('click', () => {
  openTradeModal('sell');
});

dumpButton.addEventListener('click', () => {
  openTradeModal('dump');
});

tradeOkButton.addEventListener('click', confirmTrade);
tradeCancelButton.addEventListener('click', closeTradeModal);

tradeModal.addEventListener('click', (event) => {
  if (event.target === tradeModal) {
    closeTradeModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !tradeModal.hidden) {
    closeTradeModal();
  }
});

addSelectableRows(marketList, 'market');
addSelectableRows(inventoryList, 'inventory');
