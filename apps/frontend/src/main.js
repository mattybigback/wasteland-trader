import './styles.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const appRoot = document.getElementById('app');

appRoot.innerHTML = `
  <main class="layout">
    <section class="hero">
      <h1>Wasteland Trader</h1>
      <p>Frontend shell for the Wasteland Trader API monorepo.</p>
    </section>

    <section class="panel">
      <h2>Create Game Session</h2>
      <button id="create-game" type="button">Create Game</button>
      <p id="status" class="status">No request sent yet.</p>
    </section>

    <section class="panel">
      <h2>Session Snapshot</h2>
      <pre id="response" class="response">{}</pre>
    </section>
  </main>
`;

const createButton = document.getElementById('create-game');
const statusElement = document.getElementById('status');
const responseElement = document.getElementById('response');

async function createGameSession() {
  statusElement.textContent = 'Creating session...';

  try {
    const response = await fetch(`${API_BASE_URL}/games`, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    statusElement.textContent = `Session created: ${payload.id}`;
    responseElement.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    statusElement.textContent = `Failed to create session: ${error.message}`;
  }
}

createButton.addEventListener('click', createGameSession);
