// Set App Version (Matching SW) - TOP LEVEL FOR DIAGNOSTICS
const APP_VERSION = "v10.18";
const versionEl = document.getElementById('app-version');
if (versionEl) versionEl.textContent = APP_VERSION;

const SCORING_ACTIONS = {
    'canta': { label: '🎤 Canta', pts: 15 },
    'parla': { label: '🗣️ Parla', pts: 5 },
    'saluta': { label: '👋 Saluta', pts: 2 },
    'battuta': { label: '🤣 Battuta', pts: 8 },
    'errore': { label: '😱 Errore', pts: -10 },
    'ospite': { label: '🌟 Ospite', pts: 20 }
};

let deferredPrompt;
const installBtn = document.getElementById('install-button');

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    });
}

// Handle Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI notify the user they can add to home screen
    if (installBtn) {
        installBtn.style.display = 'inline-block';
    }
});

if (installBtn) {
    installBtn.addEventListener('click', (e) => {
        // hide our user interface that shows our A2HS button
        installBtn.style.display = 'none';
        // Show the prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('User accepted the A2HS prompt');
            } else {
                console.log('User dismissed the A2HS prompt');
            }
            deferredPrompt = null;
        });
    });
}

window.addEventListener('appinstalled', (event) => {
    console.log('App was installed');
    if (installBtn) {
        installBtn.style.display = 'none';
    }
});

// Core Application Initialization
function initApp() {
    // Check if the module script in index.html has finished attaching globals
    if (!window.auth || !window.dbUtils || !window.authUtils) {
        console.log("Waiting for Firebase components (v10.2)...");
        setTimeout(initApp, 100);
        return;
    }

    console.log("Firebase components ready. Initializing app logic.");

    // Firebase Auth Logic
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');

    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            const { provider, signInWithRedirect } = window.authUtils;
            // Use redirect for better mobile/iOS support
            signInWithRedirect(window.auth, provider)
                .catch((error) => {
                    console.error('Sign in error:', error);
                    alert('Errore di autenticazione: ' + error.message);
                });
        });
    }

    // Handle Redirect Result on Load
    if (window.authUtils && window.authUtils.getRedirectResult) {
        window.authUtils.getRedirectResult(window.auth)
            .then((result) => {
                if (result) console.log('Redirect sign in success:', result.user);
            })
            .catch((error) => {
                console.error('Redirect sign in error:', error);
                if (error.code !== 'auth/web-storage-unsupported') {
                    alert('Errore redirect: ' + error.message);
                }
            });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            window.authUtils.signOut(window.auth);
        });
    }

    window.authUtils.onAuthStateChanged(window.auth, async (user) => {
        const loginView = document.getElementById('login-view');
        const dashboardView = document.getElementById('dashboard-view');
        const mainTitle = document.getElementById('main-title');
        const mainSubtitle = document.getElementById('main-subtitle');
        const authError = document.getElementById('auth-error');

        if (user) {
            // CHECK WHITELIST (FIRESTORE)
            try {
                const { doc, getDoc } = window.dbUtils;
                const allowRef = doc(window.db, "allowed_users", user.email);
                const allowSnap = await getDoc(allowRef);

                if (!allowSnap.exists()) {
                    console.warn("Unauthorized access attempt:", user.email);
                    await window.authUtils.signOut(window.auth);
                    if (authError) {
                        authError.style.display = 'block';
                        authError.textContent = `Accesso negato per ${user.email}.`;
                    }
                    if (loginView) loginView.style.display = 'block';
                    if (dashboardView) dashboardView.style.display = 'none';
                    return;
                }
            } catch (err) {
                console.error("Error checking whitelist:", err);
            }

            // AUTHORIZED & LOGGED IN
            if (authError) authError.style.display = 'none';
            if (loginView) loginView.style.display = 'none';
            if (dashboardView) dashboardView.style.display = 'block';
            if (mainTitle) mainTitle.textContent = "Area Personale";
            if (mainSubtitle) mainSubtitle.style.display = 'none';

            // Show Navbar
            const nav = document.getElementById('bottom-nav');
            if (nav) nav.style.display = 'flex';

            // Populate User Info
            const userName = document.getElementById('user-name');
            const userPhoto = document.getElementById('user-photo');
            if (userName) userName.textContent = user.displayName;
            if (userPhoto) userPhoto.src = user.photoURL;

            handleUserProfile(user);
            loadMarketData();
        } else {
            // LOGGED OUT
            if (loginView) loginView.style.display = 'block';
            if (dashboardView) dashboardView.style.display = 'none';
            if (mainTitle) mainTitle.textContent = "Benvenuto";
            if (mainSubtitle) {
                mainSubtitle.textContent = "Accedi per visualizzare la tua squadra";
                mainSubtitle.style.display = 'block';
            }
        }
    });

    // Initialize Navigation
    initNavigation();
}

// Start the loop
initApp();

// TEAM & MARKET LOGIC
let currentUserData = null;
let marketData = [];
let currentDraft = {
    'Circolo': [],
    'Equipe': [],
    'Ospite': []
};

async function handleUserProfile(user) {
    const { doc, getDoc, setDoc, onSnapshot } = window.dbUtils;
    const userDocRef = doc(window.db, "users", user.uid);

    try {
        const userDoc = await getDoc(userDocRef);

        if (!userDoc.exists()) {
            await setDoc(userDocRef, {
                displayName: user.displayName,
                email: user.email,
                credits: 100,
                role: "user",
                createdAt: new Date(),
                team: null // No team initially
            });
        }

        onSnapshot(userDocRef, (doc) => {
            const data = doc.data();
            if (data) {
                currentUserData = data;
                updateUserUI(data);

                // If user has a team, show it and disable editing (or handle edit mode later)
                // For now, if simple: if team exists, show it. If not, enable draft mode.
                if (data.team) {
                    renderMyTeam(data.team);
                    // Hide draft bar if it was visible
                    const draftBar = document.getElementById('draft-bar');
                    if (draftBar) draftBar.style.display = 'none';

                    // RESET TEAM BUTTON LOGIC
                    const resetBtn = document.getElementById('reset-team-btn');
                    const deadline = new Date('2026-02-15T00:00:00'); // Enabled until Feb 14 midnight
                    const now = new Date();

                    if (resetBtn && now < deadline) {
                        resetBtn.style.display = 'block';
                        resetBtn.onclick = () => confirmResetTeam();
                    } else if (resetBtn) {
                        resetBtn.style.display = 'none';
                    }
                } else {
                    renderEmptyTeamState();
                    const resetBtn = document.getElementById('reset-team-btn');
                    if (resetBtn) resetBtn.style.display = 'none';
                }
            }
        });

    } catch (error) {
        console.error("Error managing user profile:", error);
    }
}

function updateUserUI(data) {
    if (document.getElementById('user-credits')) {
        document.getElementById('user-credits').textContent = `Crediti: ${data.credits}`;
    }

    // ROLE-BASED UI
    const navAdmin = document.getElementById('nav-admin');
    if (navAdmin) {
        navAdmin.style.display = (data.role === 'admin') ? 'flex' : 'none';
    }
}

function renderEmptyTeamState() {
    const container = document.getElementById('team-display-container');
    if (container) {
        container.innerHTML = '<div class="loading-item">Crea la tua squadra selezionando i componenti qui sotto!</div>';
        container.style.display = 'block';
        container.style.gridTemplateColumns = '1fr';
    }
}

function renderMyTeam(team) {
    const container = document.getElementById('team-display-container');
    if (!container) return;

    container.innerHTML = '';
    container.style.display = 'grid';
    // Restore grid layout
    if (window.innerWidth > 400) container.style.gridTemplateColumns = 'repeat(3, 1fr)';

    // Helper to generic slot
    const createSlot = (label, icon, value) => {
        return `
        <div class="team-slot">
            <div class="slot-icon">${icon}</div>
            <div class="slot-label">${label}</div>
            <div class="slot-value" style="color: var(--accent-color)">${value}</div>
        </div>`;
    };

    // Render Circoli (Max 2)
    if (team.Circolo) {
        team.Circolo.forEach(item => {
            container.innerHTML += createSlot("Circolo", "🏟️", item.name);
        });
    }

    // Render Equipe (Max 2)
    if (team.Equipe) {
        team.Equipe.forEach(item => {
            container.innerHTML += createSlot("Equipe", "👥", item.name);
        });
    }

    // Render Ospite (Max 1)
    if (team.Ospite) {
        team.Ospite.forEach(item => {
            container.innerHTML += createSlot("Ospite", "🌟", item.name);
        });
    }
}


let marketLoaded = false;
async function loadMarketData() {
    if (marketLoaded) return;
    marketLoaded = true;

    const { collection, getDocs, query, orderBy } = window.dbUtils;

    try {
        const q = query(collection(window.db, "market"), orderBy("name"));
        const querySnapshot = await getDocs(q);

        marketData = []; // Reset local cache

        // Reset lists UI
        const lists = {
            'Circolo': document.getElementById('list-circolo'),
            'Equipe': document.getElementById('list-equipe'),
            'Ospite': document.getElementById('list-ospite')
        };
        Object.values(lists).forEach(el => { if (el) el.innerHTML = ''; });

        if (querySnapshot.empty) {
            // Handle empty
            return;
        }

        querySnapshot.forEach((doc) => {
            const item = { id: doc.id, ...doc.data() };
            marketData.push(item);

            const listContainer = lists[item.category];
            if (listContainer) {
                const itemEl = document.createElement('div');
                itemEl.className = 'market-item';
                itemEl.dataset.id = item.id;
                itemEl.dataset.category = item.category;
                itemEl.onclick = () => toggleSelection(itemEl, item);

                itemEl.innerHTML = `
                    <div class="item-header">
                        <span class="item-name">${item.name}</span>
                        <div class="check-icon">✓</div>
                    </div>
                    <span class="item-price">${item.price} crediti</span>
                `;
                listContainer.appendChild(itemEl);
            }
        });

    } catch (error) {
        console.error("Error loading market:", error);
    }
}

function toggleSelection(element, item) {
    // If user already has a team saved, prevent changes (optional: read only mode)
    if (currentUserData && currentUserData.team) {
        alert("Hai già confermato la tua squadra!");
        return;
    }

    const category = item.category;
    const list = currentDraft[category];

    // Check if already selected
    const index = list.findIndex(i => i.id === item.id);

    if (index > -1) {
        // Deselect
        list.splice(index, 1);
        element.classList.remove('selected');
    } else {
        // Select - Check Constraints
        if (category === 'Circolo' && list.length >= 2) return alert("Puoi selezionare massimo 2 Circoli.");
        if (category === 'Equipe' && list.length >= 2) return alert("Puoi selezionare massimo 2 membri di Equipe.");
        if (category === 'Ospite' && list.length >= 1) return alert("Puoi selezionare massimo 1 Ospite.");

        // Add
        list.push(item);
        element.classList.add('selected');
    }

    updateDraftUI();
}

function updateDraftUI() {
    const draftBar = document.getElementById('draft-bar');
    const costEl = document.getElementById('draft-cost');
    const countEl = document.getElementById('draft-count');
    const saveBtn = document.getElementById('save-team-btn');

    let totalCost = 0;
    let totalCount = 0;

    Object.values(currentDraft).forEach(list => {
        list.forEach(item => {
            totalCost += item.price;
            totalCount++;
        });
    });

    if (totalCount > 0) {
        draftBar.style.display = 'flex';
        costEl.textContent = `Costo: ${totalCost} crediti`;
        countEl.textContent = `${totalCount}/5`;

        // Validate Budget
        const budget = currentUserData ? currentUserData.credits : 100;

        if (totalCost > budget) {
            saveBtn.disabled = true;
            saveBtn.textContent = "Crediti Insufficienti";
            costEl.style.color = "#ef4444";
        } else {
            saveBtn.disabled = false;
            saveBtn.textContent = "Conferma Squadra";
            costEl.style.color = "var(--accent-color)";

            // Re-bind click (simple way)
            // Re-bind click (simple way)
            saveBtn.onclick = () => showConfirmationModal(totalCost);
        }

    } else {
        draftBar.style.display = 'none';
    }
}

// MODAL CONFIRMATION LOGIC
function showConfirmationModal(totalCost) {
    const modal = document.getElementById('confirm-modal');
    const recapContainer = document.getElementById('modal-recap');
    const totalEl = document.getElementById('modal-total-cost');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    recapContainer.innerHTML = '';

    Object.entries(currentDraft).forEach(([category, items]) => {
        items.forEach(item => {
            recapContainer.innerHTML += `
                <div class="recap-row">
                    <span>${item.name} <small style="opacity:0.7">(${category})</small></span>
                    <span>${item.price}</span>
                </div>
            `;
        });
    });

    totalEl.textContent = `${totalCost} crediti`;
    modal.style.display = 'flex';

    cancelBtn.onclick = () => modal.style.display = 'none';

    confirmBtn.onclick = async () => {
        if (!window.dbUtils || !window.dbUtils.updateDoc) {
            alert("Errore di sistema: Funzione di salvataggio non caricata. Ricarica la pagina.");
            return;
        }

        try {
            confirmBtn.disabled = true;
            confirmBtn.textContent = "Elaborazione...";
            await saveTeamToFirestore(totalCost);
            modal.style.display = 'none';
            // Reset button just in case logic is reused without reload (though saveTeam clears UI)
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Conferma Acquisto";
        } catch (error) {
            console.error(error);
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Riprova";
            alert("Errore: " + error.message);
        }
    };
}

async function saveTeamToFirestore(totalCost) {
    const { doc, updateDoc } = window.dbUtils;

    if (!window.auth.currentUser) throw new Error("Utente non autenticato.");

    const userDocRef = doc(window.db, "users", window.auth.currentUser.uid);

    // Perform Update
    await updateDoc(userDocRef, {
        team: currentDraft,
        credits: currentUserData.credits - totalCost
    });

    // Reset local state & UI
    document.getElementById('draft-bar').style.display = 'none';
    document.querySelectorAll('.market-item.selected').forEach(el => el.classList.remove('selected'));
    currentDraft = { 'Circolo': [], 'Equipe': [], 'Ospite': [] };

    alert("Squadra confermata con successo! 🎉");
    location.reload(); // Reload to refresh state cleanly
}

async function confirmResetTeam() {
    if (!confirm("Sei sicuro di voler eliminare la tua squadra? Avrai di nuovo 100 crediti per rifarla.")) return;

    const { doc, updateDoc } = window.dbUtils;
    if (!window.auth.currentUser) return;

    try {
        const userDocRef = doc(window.db, "users", window.auth.currentUser.uid);
        await updateDoc(userDocRef, {
            team: null,
            credits: 100,
            fantaScore: 0
        });
        alert("Squadra eliminata e punteggio azzerato. Ora puoi crearne una nuova! 🔄");
        location.reload();
    } catch (error) {
        console.error("Error resetting team:", error);
        alert("Errore durante il reset: " + error.message);
    }
}

// ------------------------------------------------------------------
// NAVIGATION & LEADERBOARD LOGIC
// ------------------------------------------------------------------

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add active to click
            item.classList.add('active');

            const targetId = item.dataset.target;
            handleNavigation(targetId);
        });
    });
}

function handleNavigation(targetId) {
    const dashboardView = document.getElementById('dashboard-view');
    const leaderboardView = document.getElementById('leaderboard-view');
    const eventsView = document.getElementById('events-view');
    const mainTitle = document.getElementById('main-title');
    const draftBar = document.getElementById('draft-bar');
    const card = document.querySelector('.card');

    const adminView = document.getElementById('admin-view');

    // Hide all main views
    dashboardView.style.display = 'none';
    leaderboardView.style.display = 'none';
    if (eventsView) eventsView.style.display = 'none';
    if (adminView) adminView.style.display = 'none';

    // Logic for specific targets
    if (targetId === 'dashboard-view') {
        dashboardView.style.display = 'block';
        card.classList.remove('compact'); // Normal Mode
        if (mainTitle) mainTitle.textContent = "Area Personale";
        // Restore draft bar if applicable
        if (Object.values(currentDraft).flat().length > 0) {
            draftBar.style.display = 'flex';
        }
    }
    else if (targetId === 'leaderboard-view') {
        leaderboardView.style.display = 'block';
        draftBar.style.display = 'none';
        card.classList.add('compact'); // Compact Mode
        if (mainTitle) mainTitle.textContent = "Classifica";
        loadLeaderboard();
        loadCharacterScores();
    }
    else if (targetId === 'events-view') {
        if (eventsView) eventsView.style.display = 'block';
        draftBar.style.display = 'none';
        card.classList.add('compact');
        if (mainTitle) mainTitle.textContent = "Cronologia Live";
        loadPublicEvents();
    }
    else if (targetId === 'admin-view') {
        const adminView = document.getElementById('admin-view');
        adminView.style.display = 'block';
        draftBar.style.display = 'none';
        card.classList.add('compact');
        if (mainTitle) mainTitle.textContent = "Pannello Admin";
        loadAdminMarket();
    }
    else if (targetId === 'user-info') {
        // Special case: Scroll to Rules in Dashboard
        dashboardView.style.display = 'block';
        card.classList.remove('compact');
        if (mainTitle) mainTitle.textContent = "Regolamento";
        const rules = document.querySelector('.rules-container');
        if (rules) rules.scrollIntoView({ behavior: 'smooth' });
    }
}

async function loadLeaderboard() {
    const listContainer = document.getElementById('leaderboard-list');
    listContainer.innerHTML = '<div class="loading-item">Aggiornamento...</div>';

    const { getDocs, collection, query, orderBy } = window.dbUtils;

    try {
        // Fetch users ordered by fantaScore desc
        const q = query(collection(window.db, "users"), orderBy("fantaScore", "desc"));
        const querySnapshot = await getDocs(q);

        listContainer.innerHTML = '';

        let rank = 1;

        querySnapshot.forEach((doc) => {
            const userData = doc.data();
            const score = userData.fantaScore || 0;
            const name = userData.displayName || "Utente";
            const photo = userData.photoURL || "https://img.icons8.com/ios-glyphs/30/ffffff/user--v1.png";

            // Determine styling based on rank
            let itemClass = "leaderboard-item";
            if (rank <= 3) itemClass += ` top-${rank}`;

            const isMe = window.auth.currentUser && doc.id === window.auth.currentUser.uid;
            if (isMe) itemClass += " is-me";

            listContainer.innerHTML += `
                <div class="${itemClass}" onclick='openUserTeamModal(${JSON.stringify(userData).replace(/'/g, "&#39;")})'>
                    <div class="rank-badge">${rank}</div>
                    <img src="${photo}" alt="${name}" class="user-avatar-small">
                    <div class="leaderboard-info">
                        <span class="leaderboard-name">${name} ${isMe ? '<span class="me-badge">Tu</span>' : ''}</span>
                    </div>
                    <span class="leaderboard-score">${score} pts</span>
                </div>
            `;
            rank++;
        });

        if (querySnapshot.empty) {
            listContainer.innerHTML = '<div class="loading-item">Nessun punteggio disponibile.</div>';
        }

    } catch (error) {
        console.error("Error loading leaderboard:", error);
        listContainer.innerHTML = '<div class="loading-item" style="color:red">Errore caricamento.</div>';
    }
}

async function loadCharacterScores() {
    const lists = {
        'Circolo': document.getElementById('char-scores-circolo'),
        'Equipe': document.getElementById('char-scores-equipe'),
        'Ospite': document.getElementById('char-scores-ospite')
    };

    Object.values(lists).forEach(el => { if (el) el.innerHTML = '<div class="loading-item" style="font-size:0.8rem">...</div>'; });

    if (!window.dbUtils) return;

    try {
        const { getDocs, collection, query, orderBy } = window.dbUtils;
        const q = query(collection(window.db, "market"), orderBy("fantaScore", "desc"));
        const snapshot = await getDocs(q);

        Object.values(lists).forEach(el => { if (el) el.innerHTML = ''; });

        snapshot.forEach(doc => {
            const item = doc.data();
            const listEl = lists[item.category];
            if (listEl) {
                listEl.innerHTML += `
                    <div class="market-item accordion" onclick="toggleCharacterAccordion(this, '${doc.id}')" style="padding: 10px; margin-bottom: 5px; background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.05); cursor: pointer; display: block; text-align: left;">
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                            <span class="item-name" style="font-size: 0.9rem;">${item.name}</span>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="item-price" style="color: var(--lavender); font-size: 0.9rem;">${item.fantaScore || 0} pts</span>
                                <span class="chevron" style="opacity: 0.3; font-size: 0.7rem; transition: transform 0.3s;">▼</span>
                            </div>
                        </div>
                        <div class="accordion-panel" id="panel-${doc.id}" style="max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out; margin-top: 0;">
                            <div class="character-event-list" style="padding-top: 10px; font-size: 0.8rem; border-top: 1px solid rgba(255,255,255,0.05); margin-top: 10px;">
                                <div class="loading-item" style="font-size: 0.7rem;">Caricamento...</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        });

    } catch (error) {
        console.error("Error loading character scores:", error);
    }
}

async function toggleCharacterAccordion(element, charId) {
    const panel = element.querySelector('.accordion-panel');
    const chevron = element.querySelector('.chevron');
    const isActive = element.classList.contains('active');

    if (isActive) {
        element.classList.remove('active');
        panel.style.maxHeight = '0px';
        chevron.style.transform = 'rotate(0deg)';
    } else {
        element.classList.add('active');
        panel.style.maxHeight = '500px';
        chevron.style.transform = 'rotate(180deg)';
        loadCharacterDetailsInline(charId, panel.querySelector('.character-event-list'));
    }
}

async function loadCharacterDetailsInline(charId, container) {
    if (!window.dbUtils) return;

    try {
        const { getDocs, collection, query, where } = window.dbUtils;
        // Simple query without orderBy to avoid index requirements
        const q = query(
            collection(window.db, "events"),
            where("characterId", "==", charId)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = '<div style="opacity:0.5; font-style:italic; padding: 10px;">Nessun evento registrato.</div>';
            return;
        }

        // Sort locally by timestamp desc
        const events = [];
        snapshot.forEach(docSnap => events.push(docSnap.data()));
        events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        container.innerHTML = '';
        events.forEach(ev => {
            const time = new Date(ev.timestamp).toLocaleTimeString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const ptsClass = ev.points >= 0 ? 'positive' : 'negative';

            container.innerHTML += `
                <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <span style="flex: 1; text-align: left;">${ev.actionLabel} <small style="opacity:0.4">(${time})</small></span>
                    <span class="${ptsClass}" style="font-weight:bold; min-width: 40px; text-align: right;">${ev.points > 0 ? '+' : ''}${ev.points}</span>
                </div>
            `;
        });
    } catch (error) {
        console.error("Error loading inline details:", error);
        container.innerHTML = `<div style="color:red; font-size: 0.7rem; padding: 10px;">Errore: ${error.message}</div>`;
    }
}

// Global scope for onclick access
window.toggleCharacterAccordion = toggleCharacterAccordion;
window.recordEvent = recordEvent;
window.loadAdminMarket = loadAdminMarket;
window.openUserTeamModal = function (userData) {
    console.log("Opening modal for user:", userData);
    const modal = document.getElementById('user-team-modal');
    const photoEl = document.getElementById('detail-user-photo');
    const nameEl = document.getElementById('detail-user-name');
    const scoreEl = document.getElementById('detail-user-score');
    const listEl = document.getElementById('detail-team-list');
    const closeBtn = document.getElementById('close-team-modal');

    // Populate Header
    photoEl.src = userData.photoURL || "https://img.icons8.com/ios-glyphs/80/ffffff/user--v1.png";
    nameEl.textContent = userData.displayName || "Utente";
    scoreEl.textContent = (userData.fantaScore || 0) + " pts";

    // Populate List
    listEl.innerHTML = '';
    const team = userData.team || {};
    let hasTeam = false;

    Object.entries(team).forEach(([category, items]) => {
        if (items && items.length > 0) {
            hasTeam = true;
            items.forEach(item => {
                listEl.innerHTML += `
                    <div class="detail-item">
                        <span>${item.name}</span>
                        <span>${category}</span>
                    </div>
                `;
            });
        }
    });

    if (!hasTeam) {
        listEl.innerHTML = '<div class="loading-item">Nessuna squadra formata.</div>';
    }

    // Show Modal
    modal.style.display = 'flex';

    // Close Actions
    closeBtn.onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = 'none';
    };
};



async function loadAdminMarket() {
    const select = document.getElementById('admin-character-select');
    const grid = document.getElementById('admin-actions-grid');
    if (!select || !grid) return;

    // 1. Populate Actions Grid IMMEDIATELY (No DB dependency)
    grid.innerHTML = '';
    Object.entries(SCORING_ACTIONS).forEach(([key, action]) => {
        grid.innerHTML += `
            <button class="action-btn" onclick="recordEvent('${key}')">
                <span>${action.label}</span>
                <span class="pts">${action.pts > 0 ? '+' : ''}${action.pts} pts</span>
            </button>
        `;
    });

    if (!window.dbUtils) {
        console.warn("dbUtils not ready yet.");
        return;
    }

    try {
        const { getDocs, collection, query, orderBy } = window.dbUtils;
        const q = query(collection(window.db, "market"), orderBy("name"));
        const snapshot = await getDocs(q);

        // 2. Populate Character Select
        select.innerHTML = '<option value="">Scegli un personaggio...</option>';
        snapshot.forEach(doc => {
            const item = doc.data();
            select.innerHTML += `<option value="${doc.id}">${item.name} (${item.category})</option>`;
        });

        loadAdminEvents();

    } catch (error) {
        console.error("Error loading admin market:", error);
    }
}

async function recordEvent(actionKey) {
    const charId = document.getElementById('admin-character-select').value;
    if (!charId) {
        alert("Per favore, seleziona prima un personaggio!");
        return;
    }

    const action = SCORING_ACTIONS[actionKey];
    if (!confirm(`Vuoi registrare "${action.label}" per questo personaggio?`)) return;

    if (!window.dbUtils) return;
    const { writeBatch, doc, collection, getDocs, getDoc } = window.dbUtils;
    const batch = writeBatch(window.db);

    try {
        // 1. Update character score in market
        const charRef = doc(window.db, "market", charId);
        const charSnap = await getDoc(charRef);
        const charData = charSnap.data();
        const newCharScore = (charData.fantaScore || 0) + action.pts;
        batch.update(charRef, { fantaScore: newCharScore });

        // 2. Log the event
        const eventRef = doc(collection(window.db, "events"));
        batch.set(eventRef, {
            characterId: charId,
            characterName: charData.name,
            actionKey: actionKey,
            actionLabel: action.label,
            points: action.pts,
            timestamp: new Date().toISOString()
        });

        // 3. Propagate to users (Targeted)
        const usersSnapshot = await getDocs(collection(window.db, "users"));
        let updatedCount = 0;
        let totalUsers = 0;

        usersSnapshot.forEach(userDoc => {
            totalUsers++;
            const userData = userDoc.data();
            const team = userData.team || {};
            let hasCharacter = false;

            // Robust check for character in team
            Object.keys(team).forEach(cat => {
                const members = team[cat];
                if (Array.isArray(members)) {
                    members.forEach(m => {
                        if (m && (m.id === charId || m.name === charData.name)) hasCharacter = true;
                    });
                }
            });

            if (hasCharacter) {
                const userRef = doc(window.db, "users", userDoc.id);
                const newUserScore = (userData.fantaScore || 0) + action.pts;
                batch.update(userRef, { fantaScore: newUserScore });
                updatedCount++;
            }
        });

        await batch.commit();
        alert(`Evento registrato per ${charData.name}!\n- Punti: ${action.pts}\n- Utenti aggiornati: ${updatedCount} su ${totalUsers}.\n\nSe il numero di utenti aggiornati è troppo basso, verifica che i personaggi abbiano l'ID corretto nelle squadre.`);
        loadAdminEvents();

    } catch (error) {
        console.error("Error recording event:", error);
        alert("Errore durante la registrazione: " + error.message);
    }
}

async function loadAdminEvents() {
    const container = document.getElementById('admin-events-log');
    if (!container) return;

    if (!window.dbUtils) return;

    try {
        const { getDocs, collection, query, orderBy, limit } = window.dbUtils;
        const q = query(collection(window.db, "events"), orderBy("timestamp", "desc"), limit(20));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = '<div class="loading-item">Nessun evento registrato.</div>';
            return;
        }

        container.innerHTML = '';
        snapshot.forEach(docSnap => {
            const ev = docSnap.data();
            const time = new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const ptsClass = ev.points >= 0 ? 'positive' : 'negative';

            container.innerHTML += `
                <div class="event-item">
                    <div class="event-info">
                        <span class="event-char">${ev.characterName}</span>
                        <span class="event-action">${time} - ${ev.actionLabel}</span>
                    </div>
                    <span class="event-pts ${ptsClass}">${ev.points > 0 ? '+' : ''}${ev.points}</span>
                </div>
            `;
        });
    } catch (error) {
        console.error("Error loading events:", error);
    }
}

async function loadPublicEvents() {
    const container = document.getElementById('public-events-log');
    if (!container) return;

    if (!window.dbUtils) return;

    try {
        const { getDocs, collection, query, orderBy, limit } = window.dbUtils;
        const q = query(collection(window.db, "events"), orderBy("timestamp", "desc"), limit(30));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = '<div class="loading-item">Ancora nessun evento registrato.</div>';
            return;
        }

        container.innerHTML = '';
        snapshot.forEach(docSnap => {
            const ev = docSnap.data();
            const time = new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const ptsClass = ev.points >= 0 ? 'positive' : 'negative';

            container.innerHTML += `
                <div class="event-item" style="padding: 15px; background: rgba(255,255,255,0.03); margin-bottom: 8px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05)">
                    <div class="event-info">
                        <span class="event-char" style="font-size: 1rem;">${ev.characterName}</span>
                        <span class="event-action" style="font-size: 0.8rem; opacity: 0.7;">${time} - ${ev.actionLabel}</span>
                    </div>
                    <span class="event-pts ${ptsClass}" style="font-size: 1.1rem;">${ev.points > 0 ? '+' : ''}${ev.points}</span>
                </div>
            `;
        });
    } catch (error) {
        console.error("Error loading public events:", error);
        container.innerHTML = '<div class="loading-item" style="color:red">Errore nel caricamento eventi.</div>';
    }
}

document.getElementById('save-scores-btn').onclick = async function () {
    const btn = this;
    const inputs = document.querySelectorAll('.admin-score-input');
    const { writeBatch, doc, collection, getDocs } = window.dbUtils;

    if (!confirm("Stai per aggiornare i punti di tutti i personaggi e ricalcolare la classifica. Procedere?")) return;

    btn.disabled = true;
    btn.textContent = "Aggiornamento in corso...";

    try {
        const batch = writeBatch(window.db);
        console.log("--- START PROPAGATION (v8.8) ---");

        // 1. Map new scores
        const newScoresMap = {};
        const scoresByName = {};
        inputs.forEach(input => {
            const itemId = input.dataset.id;
            const score = parseInt(input.value) || 0;
            const parent = input.closest('.market-item');
            const itemName = parent ? parent.querySelector('.item-name').textContent : null;

            newScoresMap[itemId] = score;
            if (itemName) scoresByName[itemName] = score;

            const itemRef = doc(window.db, "market", itemId);
            batch.set(itemRef, { fantaScore: score }, { merge: true });
        });

        // 2. Fetch all users
        const usersSnapshot = await getDocs(collection(window.db, "users"));
        console.log(`Found ${usersSnapshot.size} total users in DB.`);

        usersSnapshot.forEach(userDoc => {
            const userData = userDoc.data();
            const team = userData.team || {};
            const userName = userData.displayName || userDoc.id;
            let totalScore = 0;

            console.log(`Recalculating for ${userName}...`);

            // Flatten items from all categories
            const items = [];
            Object.values(team).forEach(categoryItems => {
                if (Array.isArray(categoryItems)) items.push(...categoryItems);
            });

            items.forEach(item => {
                if (item) {
                    let itemScore = newScoresMap[item.id];
                    if (itemScore === undefined && item.name) {
                        itemScore = scoresByName[item.name];
                    }
                    const finalItemScore = itemScore || 0;
                    totalScore += finalItemScore;
                    console.log(`  - Item: ${item.name}, Score: ${finalItemScore}`);
                }
            });

            console.log(`  - Final Total for ${userName}: ${totalScore}`);
            const userRef = doc(window.db, "users", userDoc.id);
            batch.set(userRef, { fantaScore: totalScore }, { merge: true });
        });

        await batch.commit();
        alert(`Propagazione completata! Aggiornati ${usersSnapshot.size} utenti. 🚀`);
        btn.disabled = false;
        btn.textContent = "Salva e Aggiorna Classifica";

    } catch (error) {
        console.error("Score update error:", error);
        alert("Errore: " + error.message);
        btn.disabled = false;
        btn.textContent = "Riprova";
    }
};

// Navigation listner moved to inside initApp loop via initNavigation() call

// Call init navigation once DOM is ready (or here if deferred)
document.addEventListener('DOMContentLoaded', initNavigation);





// iOS Detection & Hint
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

if (isIOS && !isStandalone) {
    const iosHint = document.getElementById('ios-hint');
    if (iosHint) {
        iosHint.style.display = 'block';
    }
}

// Background Image Swap (Optimized)
/* 
window.addEventListener('load', () => {
    const bg = document.querySelector('.background-image');
    if (bg) {
        // Try to use optimized image
        const img = new Image();
        img.src = 'Sfondo_optimized.jpg';
        img.onload = () => {
            bg.style.backgroundImage = "url('Sfondo_optimized.jpg')";
        };
    }
});
*/
