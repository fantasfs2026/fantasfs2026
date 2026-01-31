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

async function handleUserProfile(user) {
    const { doc, getDoc, setDoc, onSnapshot } = window.dbUtils;
    const userDocRef = doc(window.db, "users", user.uid);

    try {
        const userDoc = await getDoc(userDocRef);

        if (!userDoc.exists()) {
            // New user initialization
            await setDoc(userDocRef, {
                displayName: user.displayName,
                email: user.email,
                credits: 100, // Initial 100 points
                role: "user", // Required by Security Rules
                createdAt: new Date()
            });
        }

        // Live credits & Team listener
        onSnapshot(userDocRef, (doc) => {
            const data = doc.data();
            if (data) {
                // Update Credits
                if (document.getElementById('user-credits')) {
                    document.getElementById('user-credits').textContent = `Crediti: ${data.credits}`;
                }

                // Update Team Slots
                const team = data.team || {};

                const updateSlot = (id, value) => {
                    const el = document.querySelector(`#${id} .slot-value`);
                    if (el) el.textContent = value || "Vuoto";
                    if (value) el.style.color = "var(--accent-color)";
                    else el.style.color = "var(--text-secondary)";
                };

                updateSlot('slot-circolo', team.circolo);
                updateSlot('slot-equipe', team.equipe);
                updateSlot('slot-ospite', team.ospite);

                // Show Sections
                const teamSection = document.getElementById('team-section');
                const marketSection = document.getElementById('market-section');
                const rulesContainer = document.querySelector('.rules-container');

                if (teamSection) teamSection.style.display = 'block';
                if (marketSection) {
                    marketSection.style.display = 'block';
                    loadMarketData(); // Load market only when logged in
                }
                if (rulesContainer) rulesContainer.style.display = 'none';
            }
        });

    } catch (error) {
        console.error("Error managing user profile:", error);
    }
}

let marketLoaded = false;
async function loadMarketData() {
    if (marketLoaded) return; // Prevent double loads
    marketLoaded = true;

    const { collection, getDocs, query, orderBy } = window.dbUtils;

    try {
        const q = query(collection(window.db, "market"), orderBy("name"));
        const querySnapshot = await getDocs(q);

        // Reset lists
        const lists = {
            'Circolo': document.getElementById('list-circolo'),
            'Equipe': document.getElementById('list-equipe'),
            'Ospite': document.getElementById('list-ospite')
        };

        Object.values(lists).forEach(el => {
            if (el) el.innerHTML = ''; // Clear loading
        });

        if (querySnapshot.empty) {
            Object.values(lists).forEach(el => {
                if (el) el.innerHTML = '<div class="loading-item">Nessun elemento disponibile</div>';
            });
            return;
        }

        querySnapshot.forEach((doc) => {
            const item = doc.data();
            const listContainer = lists[item.category];

            if (listContainer) {
                const itemEl = document.createElement('div');
                itemEl.className = 'market-item';
                itemEl.innerHTML = `
                    <span class="item-name">${item.name}</span>
                    <span class="item-price">${item.price} pts</span>
                `;
                listContainer.appendChild(itemEl);
            }
        });

    } catch (error) {
        console.error("Error loading market:", error);
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
