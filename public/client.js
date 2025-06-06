// public/client.js

// Socket.io kliens inicializálása
const socket = io();

// Helyi változó: itt tartjuk majd a szerverről érkező játékos‐adatokat
let playersData = [];

// DOM-elemek kiválasztása
const registerBtn      = document.getElementById('register-btn');
const startGameBtn     = document.getElementById('start-game-btn');
const nextPlayerBtn    = document.getElementById('next-player-btn');
const pauseResumeBtn   = document.getElementById('pause-resume-btn');
const playerNameInput  = document.getElementById('player-name');
const playerTimeInput  = document.getElementById('player-time');
const playerListTbody  = document.querySelector('#player-list tbody');

// Segédfüggvény: milliszekundumból HH:MM:SS formátum
function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Frissítjük a táblázatot a playersData alapján
function renderTable() {
  playerListTbody.innerHTML = '';

  playersData.forEach((pl, idx) => {
    const tr = document.createElement('tr');
    if (pl.isActive) {
      tr.classList.add('active');
    }
    if (pl.hasLost) {
      tr.classList.add('lost');
    }

    const tdIdx   = document.createElement('td');
    tdIdx.textContent = idx + 1;

    const tdName  = document.createElement('td');
    tdName.textContent = pl.name;

    const tdTime  = document.createElement('td');
    tdTime.textContent = formatTime(pl.remainingMs);

    tr.appendChild(tdIdx);
    tr.appendChild(tdName);
    tr.appendChild(tdTime);
    playerListTbody.appendChild(tr);
  });
}

// -------------------- Socket.io események --------------------

// 1) Szerver küldi a full players tömböt (id, name, remainingMs, isActive, hasLost)
socket.on('players_data', (allPlayers) => {
  playersData = allPlayers;
  renderTable();

  // Ha legalább 2 élő játékos van, és még senki sem aktív, engedélyezzük a "Játék indítása" gombot
  const aliveCount = playersData.filter(pl => !pl.hasLost).length;
  if (aliveCount >= 2 && !playersData.some(pl => pl.isActive)) {
    startGameBtn.disabled = false;
  } else {
    startGameBtn.disabled = true;
  }

  // Ha van aktív játékos, engedélyezzük a "Következő játékos" és a "Szünet" gombokat
  if (playersData.some(pl => pl.isActive)) {
    nextPlayerBtn.disabled = false;
    pauseResumeBtn.disabled = false;
  } else {
    nextPlayerBtn.disabled = true;
    pauseResumeBtn.disabled = true;
  }

  // Szünet / újraindítás felirat kezelése
  // Ha van aktív de a visszaszámlálás nem fut (remainingMs > 0, de pl. szüneteltetve), akkor 'Újraindítás'
  const isCountdownRunning = playersData.some(pl => pl.isActive && pl.remainingMs > 0);
  if (!isCountdownRunning && playersData.some(pl => pl.isActive && !pl.hasLost && pl.remainingMs > 0)) {
    pauseResumeBtn.textContent = 'Újraindítás';
  } else {
    pauseResumeBtn.textContent = 'Szünet';
  }
});

// 2) Ha a szerver hibaüzenetet küld
socket.on('error_message', (msg) => {
  alert(msg);
});

// -------------------- Felhasználói események --------------------

// Játékos regisztrálása: elküldjük a 'register_player' eseményt névvel és idővel (millisec)
registerBtn.addEventListener('click', () => {
  const name  = playerNameInput.value.trim();
  const mins  = parseInt(playerTimeInput.value, 10);

  if (!name) {
    alert('Írj be egy nevet!');
    return;
  }
  if (isNaN(mins) || mins <= 0) {
    alert('Adj meg egy pozitív számot percekben!');
    return;
  }

  // Átkonvertáljuk milliszekundumba
  const initialMs = mins * 60 * 1000;

  // Küldjük a szervernek: { name: string, initialMs: number }
  socket.emit('register_player', { name, initialMs });

  // Kiürítjük a beviteli mezőket
  playerNameInput.value = '';
  playerTimeInput.value = '10';
});

// Játék indítása
startGameBtn.addEventListener('click', () => {
  socket.emit('start_game');
});

// Következő játékos
nextPlayerBtn.addEventListener('click', () => {
  socket.emit('next_player');
});

// Szünet / Újraindítás
pauseResumeBtn.addEventListener('click', () => {
  socket.emit('toggle_pause');
});
