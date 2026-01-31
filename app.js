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

// Firebase Auth Logic
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');
const userName = document.getElementById('user-name');
const userPhoto = document.getElementById('user-photo');

if (loginBtn && window.auth) {
    loginBtn.addEventListener('click', () => {
        const { provider, signInWithPopup } = window.authUtils;
        signInWithPopup(window.auth, provider)
            .then((result) => console.log('User signed in:', result.user))
            .catch((error) => {
                console.error('Sign in error:', error);
                alert('Errore di autenticazione: ' + error.message + '\n\nAssicurati che il dominio sia autorizzato nella console Firebase.');
            });
    });
}

if (logoutBtn && window.auth) {
    logoutBtn.addEventListener('click', () => {
        window.authUtils.signOut(window.auth);
    });
}

if (window.auth) {
    window.authUtils.onAuthStateChanged(window.auth, async (user) => {
        const loginView = document.getElementById('login-view');
        const dashboardView = document.getElementById('dashboard-view');
        const mainTitle = document.getElementById('main-title');
        const mainSubtitle = document.getElementById('main-subtitle');
        const authError = document.getElementById('auth-error'); // Make sure this element exists in HTML

        if (user) {
            // CHECK WHITELIST (FIRESTORE)
            try {
                // Determine if user is allowed by checking 'allowed_users' collection
                const { doc, getDoc } = window.dbUtils;
                const allowRef = doc(window.db, "allowed_users", user.email);
                const allowSnap = await getDoc(allowRef);

                if (!allowSnap.exists()) {
                    console.warn("Unauthorized access attempt (not in DB whitelist):", user.email);
                    await window.authUtils.signOut(window.auth);

                    if (authError) {
                        authError.style.display = 'block';
                        authError.textContent = `Accesso negato per ${user.email}. Non sei abilitato.`;
                    }

                    // Reset View to Login
                    if (loginView) loginView.style.display = 'block';
                    if (dashboardView) dashboardView.style.display = 'none';
                    return;
                }
            } catch (err) {
                console.error("Error checking whitelist:", err);
                // Optional: handle error gracefully or deny access on error
            }

            // AUTHORIZED & LOGGED IN
            if (authError) authError.style.display = 'none';
            if (loginView) loginView.style.display = 'none';
            if (dashboardView) dashboardView.style.display = 'block';

            if (mainTitle) mainTitle.textContent = "Area Personale";
            if (mainSubtitle) mainSubtitle.style.display = 'none';

            // Populate User Info
            if (userName) userName.textContent = user.displayName;
            if (userPhoto) userPhoto.src = user.photoURL;

            handleUserProfile(user);
            loadMarketData();
        } else {
            // LOGGED OUT
            // Don't hide error here immediately to let user see it if they were just kicked out
            if (loginView) loginView.style.display = 'block';
            if (dashboardView) dashboardView.style.display = 'none';

            if (mainTitle) mainTitle.textContent = "Benvenuto";
            if (mainSubtitle) {
                mainSubtitle.textContent = "Accedi per visualizzare la tua squadra";
                mainSubtitle.style.display = 'block';
            }
        }
    });
}

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
                    // Disable market interaction? Or just styling
                } else {
                    renderEmptyTeamState();
                    // Ensure drafts are cleared if switching users
                    // currentDraft = ... (reset logic if needed)
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
                    <span class="item-price">${item.price} pts</span>
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
        costEl.textContent = `Costo: ${totalCost}`;
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
            saveBtn.onclick = () => showConfirmationModal(totalCost);
        }

    } else {
        draftBar.style.display = 'none';
    }
}

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

    totalEl.textContent = `${totalCost} pts`;
    modal.style.display = 'flex';

    cancelBtn.onclick = () => modal.style.display = 'none';

    confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Salvataggio...";
        await saveTeamToFirestore(totalCost);
        modal.style.display = 'none';
    };
}

async function saveTeamToFirestore(totalCost) {
    const { doc, updateDoc } = window.dbUtils;
    const userDocRef = doc(window.db, "users", window.auth.currentUser.uid);

    try {
        await updateDoc(userDocRef, {
            team: currentDraft,
            credits: currentUserData.credits - totalCost
        });

        // Clear UI
        document.getElementById('draft-bar').style.display = 'none';
        document.querySelectorAll('.market-item.selected').forEach(el => el.classList.remove('selected'));
        currentDraft = { 'Circolo': [], 'Equipe': [], 'Ospite': [] };
        // Success feedback (optional, handled by UI update mostly)

    } catch (e) {
        console.error("Error saving team:", e);
        alert("Errore durante il salvataggio: " + e.message);
    }
}




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
