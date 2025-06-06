// index.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ----------------------------
// Konfigurálható beállítások
// ----------------------------

// Milyen hosszú ideje legyen minden játékosnak (milliszekundumban).
// Például: 10 perc = 10 * 60 * 1000 ms
const DEFAULT_PLAYER_TIME_MS = 10 * 60 * 1000;

// ----------------------------
// Szerver oldali állapot
// ----------------------------

/*
  players: tömb, ahol minden elem egy objektum, amely tartalmazza:
    {
      id: socket.id,             // Socket.io által generált egyedi ID
      name: 'Játékos neve',
      remainingMs: Number,       // Mennyi idő maradt visszafele (ms)
      isActive: Boolean,         // Jelenleg ez a játékos-e az aktív
      hasLost: Boolean           // Lejárt-e már az ideje (kiesett-e)
    }
*/
let players = [];

// Melyik játékos index a players tömbben a “következő” (aktív).
// Ha -1, akkor még nem indult a játék, vagy már mind kiesett.
let currentActiveIndex = -1;

// Az az intervallum‐ID (Node.js setInterval), ami másodpercenként frissíti az aktív játékos idejét:
let countdownIntervalId = null;

// ----------------------------
// Express statikus fájlok
// ----------------------------
//
// A public/ könyvtárból szolgáljuk ki a frontend fájlokat.
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------
// Segédfüggvények
// ----------------------------

// Ha van épp aktív játékos (index >= 0), akkor indítunk egy 1 másodperces újraszámlálást.
// Minden 1 másodpercben csökkentjük az adott játékos remainingMs értékét 1000‐rel.
// Ha ez nulla (vagy alatta) lesz, akkor eldobjuk, hogy “kiesett” (hasLost = true), megállítjuk az intervallumot,
// és átváltunk a következő játékosra (ha van).
function startCountdown() {
  // Ha már futna, ne indítsuk újra
  if (countdownIntervalId !== null) return;

  if (currentActiveIndex < 0 || currentActiveIndex >= players.length) return;
  if (players[currentActiveIndex].hasLost) return;

  countdownIntervalId = setInterval(() => {
    const pl = players[currentActiveIndex];
    pl.remainingMs -= 1000;
    if (pl.remainingMs <= 0) {
      // Az éppen aktív játékos ideje lejárt: kiesett
      pl.remainingMs = 0;
      pl.hasLost = true;
      // Státus frissítése a kliens(ek)nek
      io.emit('players_data', players);

      // Megállítjuk az intervallumot
      clearInterval(countdownIntervalId);
      countdownIntervalId = null;

      // Átváltunk a következőre (ha van olyan, akinek még nem járt le az ideje)
      switchToNextPlayer();
    } else {
      // Még nem járt le – csak küldjük a frissített adatot
      io.emit('players_data', players);
    }
  }, 1000);
}

// Állítsa le a folyamatban lévő intervallumot (ha futna).
function stopCountdown() {
  if (countdownIntervalId !== null) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
}

// Keresünk a következő olyan játékost (körkörösen), akinek még nincs lejárva az ideje.
// Ha van ilyesmi, beállítjuk őt active‐re, elindítjuk a countdownot.
// Ha nincs több “élő” játékos, akkor currentActiveIndex = -1 marad, és nem indítunk új intervallumot.
function switchToNextPlayer() {
  stopCountdown();

  if (players.length === 0) {
    currentActiveIndex = -1;
    io.emit('players_data', players);
    return;
  }

  // Körkörös keresés: a jelenlegi index +1‐től indulva megnézzük, van-e még “élő” (hasLost = false) játékos.
  let foundIndex = -1;
  for (let offset = 1; offset <= players.length; offset++) {
    const idx = (currentActiveIndex + offset) % players.length;
    if (!players[idx].hasLost) {
      foundIndex = idx;
      break;
    }
  }

  if (foundIndex === -1) {
    // Nincs olyan játékos, aki élne → vége a játéknak
    currentActiveIndex = -1;
    io.emit('players_data', players);
    return;
  }

  // Kiválasztottuk az “élő” következő játékost
  currentActiveIndex = foundIndex;
  // Mindenki másnál isActive = false
  players.forEach((pl, i) => {
    pl.isActive = (i === currentActiveIndex);
  });

  // Küldjük a frissített adatot (ki most az aktív)
  io.emit('players_data', players);

  // Megint elindítjuk a visszaszámlálást
  startCountdown();
}

// ----------------------------
// Socket.io eseménykezelés
// ----------------------------

io.on('connection', (socket) => {
  // Új kliens csatlakozott
  console.log(`Új kliens csatlakozott: ${socket.id}`);

  // 1) Kérjük, küldje el, hogy “szeretné-e regisztrálni a játékos nevét”?
  //    A frontend majd egy popupban/kihajtható panelen megkérdezi a nevet és elküldi.
  //    Ha regisztráció érkezik, hozzáadjuk a players tömbhöz.
  socket.on('register_player', (playerName) => {
    // Ellenőrizhetjük, hogy a név nem üres, nem ismétlődik stb. – itt csak egyszerűsítek.
    const newPlayer = {
      id: socket.id,
      name: playerName || `Játékos_${players.length + 1}`,
      remainingMs: DEFAULT_PLAYER_TIME_MS,
      isActive: false,
      hasLost: false
    };
    players.push(newPlayer);

    // Ha ez az első regisztrált, akkor még nincs aktív (várakozunk, amíg valaki indítja a játékot).
    io.emit('players_data', players);
  });

  // 2) Játék indítása (egy kliens nyomja meg a “Start Game” gombot)
  socket.on('start_game', () => {
    // Ha már ment a játék, ne indítsuk újra
    if (currentActiveIndex !== -1) return;

    // Ha nincs legalább 2 játékos, nem indulunk el (backend-enúgysem, de frontenden is jelezhetjük).
    const alivePlayers = players.filter(pl => !pl.hasLost);
    if (alivePlayers.length < 2) {
      socket.emit('error_message', 'Legalább 2 aktív játékos kell a játékhoz!');
      return;
    }

    // Első aktív játékos a 0. index, akinek még nincs lejárva az ideje
    let firstIdx = -1;
    for (let i = 0; i < players.length; i++) {
      if (!players[i].hasLost) {
        firstIdx = i;
        break;
      }
    }
    if (firstIdx === -1) return; // (nem lehet, mert legalább ketten élnek)

    currentActiveIndex = firstIdx;
    players.forEach((pl, i) => {
      pl.isActive = (i === currentActiveIndex);
    });

    io.emit('players_data', players);

    // Indítjuk az 1 másodperces intervallumot
    startCountdown();
  });

  // 3) Következő játékos gomb (egy kliens elküldi, hogy váltás)
  socket.on('next_player', () => {
    // Csak akkor engedjük, ha van aktív játékos
    if (currentActiveIndex === -1) return;
    // Egyébként átváltunk a következőre
    switchToNextPlayer();
  });

  // 4) Szünet / Újraindítás gomb (egy kliens „toggle_pause” eseménnyel):
  //    Ha épp megy a visszaszámlálás, akkor leállítjuk csak (szerver‐oldalról).
  //    Ha pedig nincs active intervallum, de még van aktív játékos, akkor újraindítjuk.
  socket.on('toggle_pause', () => {
    if (currentActiveIndex === -1) return;
    const pl = players[currentActiveIndex];
    if (pl.hasLost) return;

    // Ha futna az intervallum, leállítjuk (stopCountdown), és pl.isActive marad true,
    // viszont a szerveren jelöljük, hogy “szünet van” (egy plusz változó is kellene, de itt elegendő, ha
    // akkor, amikor jön a következő tick, már nem fut az intervallum).
    if (countdownIntervalId !== null) {
      stopCountdown();
      // A frontenden a kliens tudja a toggletől, hogy mi legyen a gomb címkéje.
    } else {
      // Nincs futó intervallum → elindítjuk újra
      startCountdown();
    }
    io.emit('players_data', players);
  });

  // 5) Kilépés/lecsatlakozás esetén töröljük a players tömbből a socket.id-hez tartozó játékost:
  socket.on('disconnect', () => {
    console.log(`Kliens lecsatlakozott: ${socket.id}`);
    // Eltávolítjuk a játékost (ha épp a listában volt)
    const idx = players.findIndex(pl => pl.id === socket.id);
    if (idx !== -1) {
      // Ha épp ő volt az aktív játékos, akkor az intervallumot is leállítjuk, és váltunk a következőre
      if (idx === currentActiveIndex) {
        stopCountdown();
        players.splice(idx, 1);
        // Friss sorrend → beállítjuk újra a currentActiveIndex‐et, vagy -1, ha már nincs játékos
        if (players.length === 0) {
          currentActiveIndex = -1;
        } else {
          currentActiveIndex = (idx % players.length);
          players.forEach((pl, i) => pl.isActive = (i === currentActiveIndex));
          startCountdown();
        }
      } else {
        players.splice(idx, 1);
        // Csak újra küldjük az adatot; az aktív index helyes marad (de index‐eltolódás lehet!)
        // Biztosítsuk, hogy currentActiveIndex továbbra is jó pozícióra mutasson:
        if (idx < currentActiveIndex) {
          currentActiveIndex--;
        }
      }
    }
    io.emit('players_data', players);
  });

  // +++ Bővítheted még hibakezeléssel, pl. “új játékos egyező névvel” tilos stb.
});

// ----------------------------
// Szerver indítása
// ----------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Szerver fut a http://localhost:${PORT} címen`);
});
