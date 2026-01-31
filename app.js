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
