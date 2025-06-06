// public/client.js

// 1) Csatlakozás Socket.io szerverhez
const socket = io();

// Aktuális játékosok adatai a szervertől. Formátum: 
// [
//   { id, name, remainingMs, isActive, hasLost },
//   ...
// ]
let playersData = [];

// Elemkiválasztások
const registerBtn = document.getElementById('register-btn');
const startGameBtn = document.getElementById('start-game-btn');
const nextPlayerBtn = document.getElementById('next-player-btn');
const pauseResumeBtn = document.getElementById('pause-resume-btn');
const playerNameInput = document.getElementById('player-name');
const playerListTbody = document.querySelector('#player-list tbody');

// Helper: milliszekundumból HH:MM:SS string
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

// Frissítsük a táblázatot (playersData alapján)
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

    const tdIdx = document.createElement('td');
    tdIdx.textContent = idx + 1;

    const tdName = document.createElement('td');
    tdName.textContent = pl.name;

    const tdTime = document.createElement('td');
    // Ha kiesett, “00:00:00”-t mutatunk, és pirosan áthúzva
    tdTime.textContent = formatTime(pl.remainingMs);

    tr.appendChild(tdIdx);
    tr.appendChild(tdName);
    tr.appendChild(tdTime);

    playerListTbody.appendChild(tr);
  });
}

// ------------- Socket.io események -------------

// 1) Amikor a szerver “players_data”-t küld, frissítjük a playersData tömböt és újrarendereljük
socket.on('players_data', (allPlayers) => {
  playersData = allPlayers;
  renderTable();

  // Ha legalább 2 játékos regisztrálva van, engedélyezzük a “Játék indítása” gombot,
  // de csak akkor, ha a játék még nem indult (tehát nincs aktív játékos).
  const aliveCount = playersData.filter(pl => !pl.hasLost).length;
  if (aliveCount >= 2 && !playersData.some(pl => pl.isActive)) {
    startGameBtn.disabled = false;
  } else {
    startGameBtn.disabled = true;
  }

  // Ha van aktív játékos, engedélyezzük a “Következő játékos” és “Szünet” gombokat
  if (playersData.some(pl => pl.isActive)) {
    nextPlayerBtn.disabled = false;
    pauseResumeBtn.disabled = false;
  } else {
    nextPlayerBtn.disabled = true;
    pauseResumeBtn.disabled = true;
  }

  // Ha van aktív, de countdown nem fut (például épp szüneteltetve van), akkor a “Szünet” gomb feliratát
  // “Újraindítás”-ra állítjuk. Ha viszont fut, maradjon “Szünet”.
  const isCountdownRunning = playersData.some(pl => pl.isActive && pl.remainingMs > 0);
  if (!isCountdownRunning && playersData.some(pl => pl.isActive && !pl.hasLost && pl.remainingMs > 0)) {
    pauseResumeBtn.textContent = 'Újraindítás';
  } else {
    pauseResumeBtn.textContent = 'Szünet';
  }
});

// 2) Hibaüzenet esetén a szerver “error_message”-et küldhet
socket.on('error_message', (msg) => {
  alert(msg);
});

// ------------- Felhasználói gombnyomások -------------

// Regisztrálás: elküldjük a nevet
registerBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    alert('Írj be egy nevet!');
    return;
  }
  socket.emit('register_player', name);
  playerNameInput.value = '';
});

// Játék indítása
startGameBtn.addEventListener('click', () => {
  socket.emit('start_game');
});

// Következő játékos
nextPlayerBtn.addEventListener('click', () => {
  socket.emit('next_player');
});

// Szünet/Újraindítás
pauseResumeBtn.addEventListener('click', () => {
  socket.emit('toggle_pause');
});
