/**
 * LK-flix Dedicated Cinema Player (player.js)
 * Standalone, 100% Isolated Cinema Playback Engine for TV & Mobile
 */

const API_BASE = "https://lk21-app.mustapajefri.workers.dev";

// State
let activeMovie = null;
let activeServerList = [];
let activeServerIndex = 0;
let isStreamLoaded = false;
let isStreamPlaying = false;
let hasPlaybackStarted = false;
let playerHeaderTimer = null;
let seekHudTimer = null;
let lastTogglePlaybackTime = 0;
let tvCursorX = 0;
let tvCursorY = 0;
let tvCursorHideTimer = null;
let hlsInstance = null;

// Parse Query Parameters
function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const movieUrl = params.get("url") || "";
    const title = params.get("title") || "Now Playing";
    const quality = params.get("quality") || "HD";
    const type = params.get("type") || "MOVIE";

    activeMovie = {
        url: movieUrl,
        title: title,
        quality: quality,
        type: type
    };

    const titleEl = document.getElementById("playerTitle");
    const qualityEl = document.getElementById("playerQuality");
    const typeEl = document.getElementById("playerType");

    if (titleEl) titleEl.textContent = title;
    if (qualityEl) qualityEl.textContent = quality;
    if (typeEl) typeEl.textContent = type;

    document.title = `${title} - LK-flix Player`;

    // Initialize TV Detection
    const isTv = document.documentElement.classList.contains("tv-mode") ||
                 (typeof window.AndroidBridge !== "undefined" && window.AndroidBridge.isTv && window.AndroidBridge.isTv());

    if (isTv) {
        document.body.classList.add("tv-mode");
    }

    setupEventListeners();
    resolveAndPlayStream(activeMovie);
}

function setupEventListeners() {
    const closeBtn = document.getElementById("closePlayerBtn");
    const switchBtn = document.getElementById("switchServerBtn");

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = "index.html";
            }
        });
    }

    if (switchBtn) {
        switchBtn.addEventListener("click", () => {
            switchStreamServer();
        });
    }

    // Touch & tap on screen reveals header on mobile
    const isTv = document.documentElement.classList.contains("tv-mode");
    if (!isTv) {
        ["touchstart", "pointerdown", "click"].forEach((evt) => {
            document.addEventListener(evt, () => {
                showPlayerHeaderTemporarily();
            }, { passive: true });
        });
    }

    // Remote D-Pad / Keyboard listener
    document.addEventListener("keydown", handleKeyDown);

    // Iframe postMessage listener
    window.addEventListener("message", handleIframeMessage);
}

function showToast(msg, duration = 3000) {
    const toast = document.getElementById("streamToast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove("hidden");
    setTimeout(() => {
        toast.classList.add("hidden");
    }, duration);
}

// Stream Source Resolution
function resolveAndPlayStream(movie) {
    activeServerList = [];
    activeServerIndex = 0;
    hasPlaybackStarted = false;
    isStreamLoaded = false;
    isStreamPlaying = false;

    showToast("Resolving stream servers...", 2000);
    showPlayerHeaderPersistent();

    // 1. Android Native Bridge Resolution
    if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.resolveDetailStreamSources === "function") {
        try {
            const rawJson = window.AndroidBridge.resolveDetailStreamSources(movie.url);
            if (rawJson) {
                const parsed = JSON.parse(rawJson);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    activeServerList = parsed;
                }
            }
        } catch (e) {
            console.warn("Bridge stream resolution error:", e);
        }
    }

    // 2. Web fallback
    if (!activeServerList || activeServerList.length === 0) {
        const slug = movie.url.replace(/^https?:\/\/[^\/]+\//, "").replace(/\/$/, "");
        activeServerList = [
            `https://videonode.de/iframe/p2p/${slug}`,
            `https://videonode.de/iframe/turbovip/${slug}`,
            `https://videonode.de/iframe/cast/${slug}`,
            `https://videonode.de/iframe/hydrax/${slug}`
        ];
    }

    playCurrentServer();
}

function getServerDisplayName(url, index) {
    const num = index + 1;
    if (url.includes("p2p")) return `P2P Fast Server (${num})`;
    if (url.includes("turbovip") || url.includes("turbovid")) return `TurboVIP Server (${num})`;
    if (url.includes("cast")) return `Cast Stream (${num})`;
    if (url.includes("hydrax")) return `Hydrax Server (${num})`;
    if (url.includes("playcdn")) return `PlayCDN Server (${num})`;
    return `Server ${num}`;
}

function updateServerUI() {
    const switchBtn = document.getElementById("switchServerBtn");
    if (!switchBtn) return;
    if (activeServerList.length > 1) {
        const currentUrl = activeServerList[activeServerIndex] || "";
        switchBtn.style.display = "inline-flex";
        switchBtn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> <span>${getServerDisplayName(currentUrl, activeServerIndex)}</span>`;
    } else {
        switchBtn.style.display = "none";
    }
}

function playCurrentServer() {
    hasPlaybackStarted = false;
    isStreamLoaded = false;
    isStreamPlaying = false;

    if (!activeServerList || activeServerList.length === 0) {
        showToast("No stream sources available.");
        return;
    }

    if (activeServerIndex >= activeServerList.length) {
        showToast("All servers tried. Please go back and try another title.");
        return;
    }

    updateServerUI();

    let playUrl = activeServerList[activeServerIndex];
    const serverNum = activeServerIndex + 1;
    const totalServers = activeServerList.length;
    console.log(`[Player] Playing server ${serverNum}/${totalServers}: ${playUrl}`);

    if (activeServerIndex > 0) {
        showToast(`Connecting to Server ${serverNum}/${totalServers}...`, 2000);
    }

    if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.resolveDirectStream === "function") {
        try {
            const resolved = window.AndroidBridge.resolveDirectStream(playUrl);
            if (resolved && resolved.startsWith("http")) {
                playUrl = resolved;
            }
        } catch (e) {}
    }

    const iframe = document.getElementById("videoIframe");
    const nativeVideo = document.getElementById("nativeVideoPlayer");
    const isDirectHls = playUrl.endsWith(".m3u8") || (playUrl.includes(".m3u8") && !playUrl.includes(".php"));

    if (isDirectHls) {
        if (iframe) {
            iframe.src = "about:blank";
            iframe.classList.add("hidden");
        }
        if (nativeVideo) {
            nativeVideo.classList.remove("hidden");
            if (typeof Hls !== "undefined" && Hls.isSupported()) {
                if (hlsInstance) hlsInstance.destroy();
                hlsInstance = new Hls({ enableWorker: true });
                hlsInstance.loadSource(playUrl);
                hlsInstance.attachMedia(nativeVideo);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    isStreamLoaded = true;
                    isStreamPlaying = true;
                    hasPlaybackStarted = true;
                    hideTvCursor();
                    nativeVideo.play().catch(e => {});
                });
            } else {
                nativeVideo.src = playUrl;
                nativeVideo.play().then(() => {
                    isStreamLoaded = true;
                    isStreamPlaying = true;
                    hasPlaybackStarted = true;
                    hideTvCursor();
                }).catch(e => {});
            }
        }
    } else {
        if (nativeVideo) {
            nativeVideo.pause();
            nativeVideo.removeAttribute("src");
            nativeVideo.classList.add("hidden");
            if (hlsInstance) {
                hlsInstance.destroy();
                hlsInstance = null;
            }
        }
        if (iframe) {
            iframe.classList.remove("hidden");
            let embedUrl = playUrl;
            if (typeof window.AndroidBridge === "undefined") {
                if (!embedUrl.includes("/api/embed?url=")) {
                    embedUrl = `${API_BASE}/api/embed?url=${encodeURIComponent(embedUrl)}`;
                }
            }
            iframe.src = embedUrl;

            iframe.onload = () => {
                try {
                    iframe.contentWindow.postMessage(JSON.stringify({ type: "play", func: "play" }), "*");
                } catch(e) {}
                if (!hasPlaybackStarted) {
                    showTvCursor();
                }
            };
        }
    }

    startPlayerHeaderHideCountdown();
}

function switchStreamServer() {
    if (activeServerList.length <= 1) return;
    activeServerIndex = (activeServerIndex + 1) % activeServerList.length;
    playCurrentServer();
}

// Header & Virtual Pointer Controls
function showPlayerHeaderPersistent() {
    const header = document.getElementById("playerHeader");
    if (!header) return;
    if (playerHeaderTimer) {
        clearTimeout(playerHeaderTimer);
        playerHeaderTimer = null;
    }
    header.classList.remove("fade-out");
    if (!hasPlaybackStarted) {
        showTvCursor(true);
    }
}

function startPlayerHeaderHideCountdown() {
    const header = document.getElementById("playerHeader");
    if (!header) return;
    header.classList.remove("fade-out");
    if (!hasPlaybackStarted) {
        showTvCursor(true);
    }
    if (playerHeaderTimer) clearTimeout(playerHeaderTimer);
    playerHeaderTimer = setTimeout(() => {
        header.classList.add("fade-out");
        hideTvCursor();
    }, 4000);
}

function showPlayerHeaderTemporarily() {
    startPlayerHeaderHideCountdown();
}

function showTvCursor(preservePosition = false) {
    if (hasPlaybackStarted) {
        hideTvCursor();
        return;
    }
    const isTv = document.documentElement.classList.contains("tv-mode");
    const cursor = document.getElementById("tvVirtualCursor");
    if (!cursor) return;

    if (isTv) {
        cursor.style.display = "";
        cursor.classList.remove("hidden");
        cursor.style.opacity = "1";
        if (!preservePosition || !tvCursorX || !tvCursorY || tvCursorY < 120) {
            updateTvCursorPosition((window.innerWidth || 1920) / 2, (window.innerHeight || 1080) / 2);
        } else {
            updateTvCursorPosition(tvCursorX, tvCursorY);
        }
    } else {
        cursor.classList.add("hidden");
        cursor.style.display = "none";
    }
}

function hideTvCursor() {
    if (tvCursorHideTimer) clearTimeout(tvCursorHideTimer);
    const cursor = document.getElementById("tvVirtualCursor");
    if (cursor) {
        cursor.style.opacity = "0";
        cursor.classList.add("hidden");
        if (hasPlaybackStarted) {
            cursor.style.display = "none";
        }
    }
}

function updateTvCursorPosition(newX, newY) {
    if (hasPlaybackStarted) return;
    const cursor = document.getElementById("tvVirtualCursor");
    if (!cursor) return;
    const maxX = window.innerWidth || 1920;
    const maxY = window.innerHeight || 1080;
    tvCursorX = Math.max(20, Math.min(maxX - 20, newX));
    tvCursorY = Math.max(20, Math.min(maxY - 20, newY));
    cursor.style.transform = `translate3d(${tvCursorX}px, ${tvCursorY}px, 0)`;
}

// Playback State & HUD
function handleIframeMessage(event) {
    try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (!data) return;

        if (data.type === "timeupdate" || data.type === "time" || data.event === "time") {
            const pos = Number(data.position || data.currentTime || 0);
            if (pos > 0) {
                hasPlaybackStarted = true;
                isStreamLoaded = true;
                isStreamPlaying = true;
                hideTvCursor();
            }
        } else if (data.type === "play" || data.event === "play" || data.state === "playing") {
            hasPlaybackStarted = true;
            isStreamLoaded = true;
            isStreamPlaying = true;
            hideTvCursor();
            startPlayerHeaderHideCountdown();
        } else if (data.type === "pause" || data.event === "pause" || data.state === "paused") {
            isStreamPlaying = false;
            showPlayerHeaderPersistent();
        }
    } catch(e) {}
}

function showSeekHud(text, iconClass) {
    const hud = document.getElementById("playerSeekHud");
    const icon = document.getElementById("seekHudIcon");
    const textEl = document.getElementById("seekHudText");
    if (!hud || !icon || !textEl) return;

    icon.className = `fa-solid ${iconClass}`;
    textEl.textContent = text;
    hud.classList.remove("hidden");
    if (seekHudTimer) clearTimeout(seekHudTimer);
    seekHudTimer = setTimeout(() => {
        hud.classList.add("hidden");
    }, 1200);
}

function seekPlayer(seconds) {
    showSeekHud(seconds > 0 ? `+${seconds}s` : `${seconds}s`, seconds > 0 ? "fa-forward" : "fa-backward");
    const nativeVideo = document.getElementById("nativeVideoPlayer");
    if (nativeVideo && !nativeVideo.classList.contains("hidden")) {
        nativeVideo.currentTime = Math.max(0, nativeVideo.currentTime + seconds);
        return;
    }
    const iframe = document.getElementById("videoIframe");
    if (iframe && iframe.contentWindow) {
        try {
            iframe.contentWindow.postMessage(JSON.stringify({ type: "seek", offset: seconds }), "*");
            iframe.contentWindow.postMessage({ type: "seek", offset: seconds }, "*");
        } catch(e) {}
    }
}

function togglePlay() {
    const now = Date.now();
    if (now - lastTogglePlaybackTime < 500) return;
    lastTogglePlaybackTime = now;

    const nativeVideo = document.getElementById("nativeVideoPlayer");
    if (nativeVideo && !nativeVideo.classList.contains("hidden")) {
        if (nativeVideo.paused) {
            nativeVideo.play();
            showSeekHud("PLAY", "fa-play");
            hasPlaybackStarted = true;
            hideTvCursor();
        } else {
            nativeVideo.pause();
            showSeekHud("PAUSE", "fa-pause");
            showPlayerHeaderPersistent();
        }
        return;
    }

    const iframe = document.getElementById("videoIframe");
    if (iframe && iframe.contentWindow) {
        try {
            iframe.contentWindow.postMessage(JSON.stringify({ type: "togglePlay" }), "*");
        } catch(e) {}
    }
}

// Native D-Pad Bridge Hook
window.handleNativeDpad = function(keyCode) {
    const activeEl = document.activeElement;
    const isCloseBtn = activeEl && activeEl.id === "closePlayerBtn";
    const isSwitchBtn = activeEl && activeEl.id === "switchServerBtn";
    const isHeaderBtnFocused = isCloseBtn || isSwitchBtn;

    // === 1. PLAYBACK STARTED (NO VIRTUAL CURSOR EVER) ===
    if (hasPlaybackStarted) {
        if (isHeaderBtnFocused) {
            if (keyCode === 20) { // DPAD_DOWN: Return to video
                if (activeEl) activeEl.blur();
                startPlayerHeaderHideCountdown();
                return;
            } else if (keyCode === 21) { // DPAD_LEFT: Back
                const closeBtn = document.getElementById("closePlayerBtn");
                if (closeBtn) closeBtn.focus();
                return;
            } else if (keyCode === 22) { // DPAD_RIGHT: Server
                const switchBtn = document.getElementById("switchServerBtn");
                if (switchBtn && switchBtn.style.display !== "none") switchBtn.focus();
                return;
            } else if (keyCode === 23 || keyCode === 66) { // OK / Enter
                if (activeEl && typeof activeEl.click === "function") activeEl.click();
                return;
            }
            return;
        }

        if (keyCode === 19) { // DPAD_UP: Unhide header & focus Back
            showPlayerHeaderPersistent();
            const closeBtn = document.getElementById("closePlayerBtn");
            if (closeBtn) closeBtn.focus();
            return;
        } else if (keyCode === 20) { // DPAD_DOWN
            showPlayerHeaderTemporarily();
            return;
        } else if (keyCode === 21) { // DPAD_LEFT: Rewind 10s
            seekPlayer(-10);
            return;
        } else if (keyCode === 22) { // DPAD_RIGHT: Fast-Forward 10s
            seekPlayer(10);
            return;
        } else if (keyCode === 23 || keyCode === 66) { // OK: Toggle Play
            togglePlay();
            return;
        }
        return;
    }

    // === 2. PRE-PLAYBACK (VIRTUAL CURSOR ACTIVE FOR BOT VERIFICATION) ===
    if (isHeaderBtnFocused) {
        if (keyCode === 20) { // DPAD_DOWN
            if (activeEl) activeEl.blur();
            showTvCursor(true);
            updateTvCursorPosition(tvCursorX, Math.max(120, tvCursorY));
            showPlayerHeaderTemporarily();
            return;
        } else if (keyCode === 21) {
            const closeBtn = document.getElementById("closePlayerBtn");
            if (closeBtn) closeBtn.focus();
            return;
        } else if (keyCode === 22) {
            const switchBtn = document.getElementById("switchServerBtn");
            if (switchBtn && switchBtn.style.display !== "none") switchBtn.focus();
            return;
        } else if (keyCode === 23 || keyCode === 66) {
            if (activeEl && typeof activeEl.click === "function") activeEl.click();
            return;
        }
        return;
    }

    const step = 25;
    if (keyCode === 19) { // DPAD_UP
        const newY = tvCursorY - step;
        if (newY <= 75 || tvCursorY <= 75) {
            showPlayerHeaderPersistent();
            const closeBtn = document.getElementById("closePlayerBtn");
            const switchBtn = document.getElementById("switchServerBtn");
            if (tvCursorX > (window.innerWidth || 1920) / 2 && switchBtn && switchBtn.style.display !== "none") {
                switchBtn.focus();
            } else if (closeBtn) {
                closeBtn.focus();
            }
            hideTvCursor();
            return;
        }
        updateTvCursorPosition(tvCursorX, newY);
        return;
    } else if (keyCode === 20) { // DPAD_DOWN
        updateTvCursorPosition(tvCursorX, tvCursorY + step);
        return;
    } else if (keyCode === 21) { // DPAD_LEFT
        updateTvCursorPosition(tvCursorX - step, tvCursorY);
        return;
    } else if (keyCode === 22) { // DPAD_RIGHT
        updateTvCursorPosition(tvCursorX + step, tvCursorY);
        return;
    } else if (keyCode === 23 || keyCode === 66) { // OK / Click
        const cursorEl = document.getElementById("tvVirtualCursor");
        if (cursorEl) {
            cursorEl.classList.add("clicking");
            setTimeout(() => cursorEl.classList.remove("clicking"), 220);
        }
        const normX = tvCursorX / (window.innerWidth || 1920);
        const normY = tvCursorY / (window.innerHeight || 1080);
        if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.simulateNativeTouchNormalized === "function") {
            window.AndroidBridge.simulateNativeTouchNormalized(normX, normY);
        }
        return;
    }
};

function handleKeyDown(e) {
    const key = e.key;
    const keyCode = e.keyCode;

    if (keyCode === 19 || key === "ArrowUp") window.handleNativeDpad(19);
    else if (keyCode === 20 || key === "ArrowDown") window.handleNativeDpad(20);
    else if (keyCode === 21 || key === "ArrowLeft") window.handleNativeDpad(21);
    else if (keyCode === 22 || key === "ArrowRight") window.handleNativeDpad(22);
    else if (keyCode === 23 || keyCode === 66 || keyCode === 13 || key === "Enter" || key === " ") window.handleNativeDpad(23);
}

// Start player on load
document.addEventListener("DOMContentLoaded", initFromUrl);
