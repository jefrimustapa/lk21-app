/* ==========================================================================
   LK-flix - Application Logic & Cloudflare D1 Infinite Scroll Integration
   ========================================================================== */

const API_BASE = "https://lk21-api.lkapp.workers.dev";
const PAGE_LIMIT = 24;

// Application Global State
let focusableElements = [];
let isTvMode = false;

let loadedMoviesPool = [];
let loadedMoviesMap = new Map();

let activeGenre = "ALL";
let currentSearchQuery = "";
let currentPage = 1;
let totalMoviesCount = 0;
let isLoading = false;
let hasMore = true;

document.addEventListener("DOMContentLoaded", () => {
    detectDeviceMode();
    initApp();
    setupEventListeners();
    setupInfiniteScroll();
});

/* ==========================================================================
   1. Device Mode Detection (TV vs Phone/Desktop)
   ========================================================================== */
function detectDeviceMode() {
    const userAgent = navigator.userAgent.toLowerCase();

    // #1 BEST: Native Android bridge via MainActivity.java JavascriptInterface
    // Uses UiModeManager.getCurrentModeType() == UI_MODE_TYPE_TELEVISION — definitive
    const isNativeTV = typeof window.AndroidBridge !== "undefined" && window.AndroidBridge.isTv();

    // #2 Check UA for known TV/set-top-box strings
    const isTVUserAgent = userAgent.includes("googletv") ||
                          userAgent.includes("android tv") ||
                          userAgent.includes("smart-tv") ||
                          userAgent.includes("hbbtv") ||
                          userAgent.includes("crkey") ||
                          userAgent.includes("firetv") ||
                          userAgent.includes("aftb") ||
                          userAgent.includes("aftt");

    // #3 Screen width — use innerWidth directly (900 CSS px covers any 1280p+ TV at any DPR)
    // Also check screen.width which on some WebViews reports physical pixels directly
    const cssWidth = window.innerWidth;
    const physicalWidth = cssWidth * (window.devicePixelRatio || 1);
    const isWideScreen = cssWidth >= 900 || screen.width >= 900 || physicalWidth >= 1280;

    // Force TV mode via URL param ?tv=1 for testing
    let forceTv = false;
    try {
        forceTv = new URLSearchParams(window.location.search).get("tv") === "1";
    } catch(e){}

    // Check if device is a phone/tablet with touch
    const isTouchDevice = navigator.maxTouchPoints > 0;

    // Determine TV mode:
    // 1. If running on Android App: strictly follow native bridge result
    // 2. If running on web browser: check TV UA, or desktop widescreen without touch
    let shouldBeTv = false;
    if (forceTv) {
        shouldBeTv = true;
    } else if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.isTv === "function") {
        shouldBeTv = window.AndroidBridge.isTv();
    } else if (isTVUserAgent) {
        shouldBeTv = true;
    } else if (!isTouchDevice && (cssWidth >= 900 || physicalWidth >= 1280)) {
        shouldBeTv = true;
    }

    if (shouldBeTv) {
        enableTvMode();
    } else {
        enableMobileMode();
    }

    window.addEventListener("resize", () => {
        if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.isTv === "function") {
            if (window.AndroidBridge.isTv()) {
                enableTvMode();
            } else {
                enableMobileMode();
            }
        }
    });
}

function enableTvMode() {
    isTvMode = true;
    document.documentElement.classList.add("tv-mode");
    document.body.classList.add("tv-mode");
    const modeText = document.getElementById("deviceModeText");
    if (modeText) modeText.textContent = "TV";
    const icon = document.getElementById("deviceModeIcon");
    if (icon) icon.className = "fa-solid fa-tv";
    refreshFocusableElements();
}

function enableMobileMode() {
    isTvMode = false;
    document.documentElement.classList.remove("tv-mode");
    document.body.classList.remove("tv-mode");
    const modeText = document.getElementById("deviceModeText");
    if (modeText) modeText.textContent = "Mobile";
    const icon = document.getElementById("deviceModeIcon");
    if (icon) icon.className = "fa-solid fa-mobile-screen";
}

/* ==========================================================================
   2. App Initialization & Initial Data Fetch
   ========================================================================== */
async function initApp() {
    await loadMovies(1, true);
}

/* ==========================================================================
   3. Core Movie Loading & Infinite Scroll Engine
   ========================================================================== */
async function loadMovies(page, resetGrid = false) {
    if (isLoading || (!hasMore && !resetGrid)) return;
    isLoading = true;
    showLoader(true);

    if (resetGrid) {
        currentPage = 1;
        hasMore = true;
        document.getElementById("mainMovieGrid").innerHTML = "";
    }

    try {
        let fetchUrl = "";
        if (currentSearchQuery) {
            fetchUrl = `${API_BASE}/api/search?q=${encodeURIComponent(currentSearchQuery)}`;
        } else if (activeGenre && activeGenre !== "ALL") {
            fetchUrl = `${API_BASE}/api/movies?genre=${encodeURIComponent(activeGenre)}&page=${page}&limit=${PAGE_LIMIT}`;
        } else {
            fetchUrl = `${API_BASE}/api/movies?page=${page}&limit=${PAGE_LIMIT}`;
        }

        const res = await fetch(fetchUrl);
        const json = await res.json();

        if (json.status === "success" && json.data) {
            const rawMovies = json.data;
            const rawCount = rawMovies.length;

            rawMovies.forEach(m => {
                if (m && m.id && !loadedMoviesMap.has(m.id)) {
                    loadedMoviesMap.set(m.id, m);
                    loadedMoviesPool.push(m);
                }
            });

            // Always apply client-side genre filter (works regardless of whether
            // the backend supports genre filtering)
            let movies = rawMovies;
            if (activeGenre && activeGenre !== "ALL") {
                movies = rawMovies.filter(m => (m.genres || '').toLowerCase().includes(activeGenre.toLowerCase()));
            }

            if (json.total) totalMoviesCount = json.total;

            if (movies.length === 0 && resetGrid) {
                document.getElementById("mainMovieGrid").innerHTML = `<p style="color:#A3A3A3; padding: 30px; grid-column: 1/-1; text-align: center;">No movies found.</p>`;
                hasMore = false;
            } else if (movies.length > 0) {
                if (resetGrid) {
                    setupHeroCarousel(movies);
                }
                appendMoviesToGrid(movies);

                // Use raw API page count (not filtered count) to determine if more pages exist
                if (currentSearchQuery) {
                    hasMore = false; // search returns all at once
                } else if (rawCount < PAGE_LIMIT) {
                    hasMore = false; // last page from DB
                } else {
                    currentPage++;
                }
            } else {
                // filtered to 0 but more DB pages may exist — keep paginating
                if (rawCount >= PAGE_LIMIT) {
                    currentPage++;
                } else {
                    hasMore = false;
                }
            }

            updateCatalogTitle();

            // In TV mode on initial load or navigation to main view, default focus directly onto the Hero "Watch Now" button,
            // so the full hero banner poster is in clear view, UNLESS user is searching
            if (resetGrid && (document.documentElement.classList.contains("tv-mode") || document.body.classList.contains("tv-mode"))) {
                const activeEl = document.activeElement;
                const isSearching = activeEl && (activeEl.id === "searchInput" || activeEl.id === "searchTrigger" || activeEl.closest("#searchContainer"));
                if (!isSearching && !currentSearchQuery) {
                    setTimeout(() => {
                        const heroPlayBtn = document.getElementById("heroPlayBtn");
                        if (heroPlayBtn) {
                            heroPlayBtn.focus();
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        } else {
                            const firstCard = document.querySelector("#mainMovieGrid .movie-card");
                            if (firstCard) {
                                firstCard.focus();
                                firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                            }
                        }
                    }, 150);
                }
            }
        }
    } catch (err) {
        console.error("Error loading movies:", err);
    } finally {
        isLoading = false;
        showLoader(false);
        refreshFocusableElements();
    }
}

function appendMoviesToGrid(movies) {
    const grid = document.getElementById("mainMovieGrid");

    movies.forEach(movie => {
        const card = document.createElement("div");
        card.className = "movie-card";
        card.setAttribute("tabindex", "0");
        card.setAttribute("data-movie-id", movie.id);

        // Format title so year appears in parentheses e.g. "Spider-Man (2026)"
        let displayTitle = movie.title || "Untitled";
        displayTitle = displayTitle.replace(/\s*(?:-|\b)\s*(\d{4})\s*$/, ' ($1)');
        if (!/\(\d{4}\)/.test(displayTitle)) {
            const yrMatch = displayTitle.match(/\b(19\d\d|20\d\d)\b/);
            if (yrMatch && !displayTitle.includes(`(${yrMatch[1]})`)) {
                displayTitle = displayTitle.replace(yrMatch[1], `(${yrMatch[1]})`);
            }
        }

        card.innerHTML = `
            <img class="movie-poster" src="${movie.poster_image || 'https://via.placeholder.com/200x300'}" alt="${movie.title}" loading="lazy">
            <div class="movie-card-overlay">
                <div class="card-title">${displayTitle}</div>
                <div class="card-meta">
                    <span class="card-rating"><i class="fa-solid fa-star"></i> ${movie.rating || 'N/A'}</span>
                    <span class="card-quality">${movie.quality || 'HD'}</span>
                </div>
            </div>
        `;

        card.addEventListener("click", () => openDetailModal(movie));
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66) {
                e.preventDefault();
                e.stopPropagation();
                openDetailModal(movie);
            }
        });

        grid.appendChild(card);
    });
}

function updateCatalogTitle() {
    const titleEl = document.getElementById("catalogTitle");
    const countEl = document.getElementById("resultsCount");
    const displayedCount = document.querySelectorAll("#mainMovieGrid .movie-card").length;

    if (currentSearchQuery) {
        titleEl.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Search: "${currentSearchQuery}"`;
    } else if (activeGenre && activeGenre !== "ALL") {
        titleEl.innerHTML = `<i class="fa-solid fa-film"></i> ${activeGenre} Movies`;
    } else {
        titleEl.innerHTML = `<i class="fa-solid fa-fire"></i> All Movies & Cinema`;
    }

    countEl.innerText = `Showing ${displayedCount} of ${totalMoviesCount || 1200} titles`;
}

function showLoader(visible) {
    const loader = document.getElementById("infiniteLoader");
    if (loader) {
        if (visible) loader.style.display = "flex";
        else loader.style.display = "none";
    }
}

/* Setup Intersection Observer for Infinite Scroll with Mobile Scroll Fallback */
function setupInfiniteScroll() {
    const sentinel = document.getElementById("scrollSentinel");
    if (!sentinel) return;

    const checkAndLoadMore = () => {
        if (!isLoading && hasMore) {
            loadMovies(currentPage, false);
        }
    };

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            checkAndLoadMore();
        }
    }, {
        root: null,
        rootMargin: "300px",
        threshold: 0.01
    });

    observer.observe(sentinel);

    // Fallback for mobile browsers where IntersectionObserver might lag
    window.addEventListener("scroll", () => {
        if ((window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 400)) {
            checkAndLoadMore();
        }
    });
}

/* ==========================================================================
   4. UI Components (Hero, Player & Details Modals)
   ========================================================================== */
let heroCarouselItems = [];
let heroCarouselIndex = 0;
let heroCarouselTimer = null;

function setupHeroCarousel(movies) {
    if (!movies || movies.length === 0) return;

    // Shuffle and pick 5 random movies from current filtered dataset
    const shuffled = [...movies].sort(() => 0.5 - Math.random());
    heroCarouselItems = shuffled.slice(0, 5);
    heroCarouselIndex = 0;

    renderHeroCarouselSlide(heroCarouselIndex);

    // Build indicator dots
    const container = document.getElementById("heroIndicators");
    if (container) {
        container.innerHTML = heroCarouselItems.map((_, idx) => 
            `<div class="hero-dot ${idx === 0 ? 'active' : ''}" data-idx="${idx}"></div>`
        ).join("");

        container.querySelectorAll(".hero-dot").forEach(dot => {
            dot.onclick = (e) => {
                const targetIdx = parseInt(e.currentTarget.getAttribute("data-idx"));
                heroCarouselIndex = targetIdx;
                renderHeroCarouselSlide(heroCarouselIndex);
                resetHeroCarouselTimer();
            };
        });
    }

    resetHeroCarouselTimer();
}

function renderHeroCarouselSlide(index) {
    if (!heroCarouselItems || heroCarouselItems.length === 0) return;
    const movie = heroCarouselItems[index % heroCarouselItems.length];

    const hero = document.getElementById("heroBillboard");
    const backdropImg = movie.poster_image || 'https://cover.showcdnx.com/wp-content/uploads/2021/12/film-spider-man-no-way-home-2021-lk21-d21.jpg';
    
    hero.style.backgroundImage = `url('${backdropImg}')`;
    document.getElementById("heroTitle").innerText = movie.title || "Featured Title";
    document.getElementById("heroRating").innerHTML = `<i class="fa-solid fa-star"></i> ${movie.rating || '8.0'}`;
    document.getElementById("heroQuality").innerText = movie.quality || 'HD';
    document.getElementById("heroType").innerText = (movie.type || 'MOVIE').toUpperCase();
    document.getElementById("heroGenres").innerText = movie.genres || 'Action • Adventure';
    document.getElementById("heroSynopsis").innerText = movie.synopsis || 'No synopsis available.';

    document.getElementById("heroPlayBtn").onclick = () => openPlayerModal(movie);
    document.getElementById("heroInfoBtn").onclick = () => openDetailModal(movie);

    // Update active dot indicator
    const dots = document.querySelectorAll("#heroIndicators .hero-dot");
    dots.forEach((dot, idx) => {
        if (idx === index) dot.classList.add("active");
        else dot.classList.remove("active");
    });
}

function resetHeroCarouselTimer() {
    if (heroCarouselTimer) clearInterval(heroCarouselTimer);
    heroCarouselTimer = setInterval(() => {
        if (heroCarouselItems && heroCarouselItems.length > 0) {
            heroCarouselIndex = (heroCarouselIndex + 1) % heroCarouselItems.length;
            renderHeroCarouselSlide(heroCarouselIndex);
        }
    }, 6000);
}

let playerHeaderTimer = null;

function showPlayerHeaderTemporarily() {
    const header = document.querySelector(".player-header");
    if (!header) return;
    
    header.classList.remove("fade-out");
    if (playerHeaderTimer) clearTimeout(playerHeaderTimer);
    
    playerHeaderTimer = setTimeout(() => {
        const modal = document.getElementById("playerModal");
        if (modal && !modal.classList.contains("hidden")) {
            header.classList.add("fade-out");
        }
    }, 10000);
}

let seekHudTimer = null;

function showSeekHud(seconds) {
    const hud = document.getElementById("playerSeekHud");
    const icon = document.getElementById("seekHudIcon");
    const text = document.getElementById("seekHudText");
    if (!hud || !icon || !text) return;

    if (seconds > 0) {
        icon.className = "fa-solid fa-forward";
        text.textContent = `+${seconds}s`;
    } else {
        icon.className = "fa-solid fa-backward";
        text.textContent = `${seconds}s`;
    }

    hud.classList.remove("hidden");
    if (seekHudTimer) clearTimeout(seekHudTimer);
    seekHudTimer = setTimeout(() => {
        hud.classList.add("hidden");
    }, 1200);
}

function togglePlayerPlayback() {
    const nativeVideo = document.getElementById("nativeVideoPlayer");
    if (nativeVideo && !nativeVideo.classList.contains("hidden")) {
        if (nativeVideo.paused) {
            nativeVideo.play().catch(e => console.log("Play error:", e));
            showSeekHudText("PLAY", "fa-play");
        } else {
            nativeVideo.pause();
            showSeekHudText("PAUSE", "fa-pause");
        }
        return;
    }

    const iframe = document.getElementById("videoIframe");
    if (iframe && iframe.contentWindow) {
        try {
            iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: "togglePlay" }), "*");
            iframe.contentWindow.postMessage({ type: "togglePlay" }, "*");
        } catch (e) {
            console.warn("Iframe toggle error:", e);
        }
    }
}

function showSeekHudText(text, iconClass) {
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

function seekPlayerStream(seconds) {
    showSeekHud(seconds);
    const nativeVideo = document.getElementById("nativeVideoPlayer");
    if (nativeVideo && !nativeVideo.classList.contains("hidden")) {
        const newTime = Math.max(0, Math.min(nativeVideo.currentTime + seconds, (nativeVideo.duration || 999999)));
        nativeVideo.currentTime = newTime;
        return;
    }

    const iframe = document.getElementById("videoIframe");
    if (!iframe || !iframe.contentWindow) return;

    try {
        iframe.contentWindow.postMessage(JSON.stringify({
            event: "command",
            func: seconds > 0 ? "fastForward" : "rewind",
            args: [Math.abs(seconds)]
        }), "*");

        iframe.contentWindow.postMessage({
            type: "seek",
            offset: seconds
        }, "*");
    } catch (e) {
        console.warn("Player seek postMessage dispatch error:", e);
    }
}

let activeServerList = [];
window.activeServerList = activeServerList;
let activeServerIndex = 0;
let activeMovieForPlayer = null;
let streamFallbackTimer = null;

function showStreamToast(message, duration = 3000) {
    const hud = document.getElementById("playerSeekHud");
    const text = document.getElementById("seekHudText");
    if (!hud || !text) return;
    text.textContent = message;
    hud.classList.remove("hidden");
    clearTimeout(window.streamToastTimer);
    window.streamToastTimer = setTimeout(() => {
        hud.classList.add("hidden");
    }, duration);
}

function getServerDisplayName(url, index) {
    if (!url) return `Server ${index + 1}`;
    if (url.includes(".m3u8")) return `Server ${index + 1}: Direct HD`;
    if (url.includes("gn1r5n") || url.includes("filelions") || url.includes("cast")) return `Server ${index + 1}: HD Cast`;
    if (url.includes("turbovidhls") || url.includes("emturbovid") || url.includes("turbovip")) return `Server ${index + 1}: Turbo`;
    if (url.includes("abyssplayer") || url.includes("hydrax")) return `Server ${index + 1}: Hydrax`;
    if (url.includes("playcdn")) return `Server ${index + 1}: PlayCDN`;
    if (url.includes("videonode")) return `Server ${index + 1}: VIP`;
    return `Server ${index + 1}`;
}

function updatePlayerServerUI() {
    const switchBtn = document.getElementById("switchServerBtn");
    if (switchBtn) {
        if (!activeServerList || activeServerList.length <= 1) {
            switchBtn.style.display = "none";
            switchBtn.tabIndex = -1;
        } else {
            switchBtn.style.display = "inline-flex";
            switchBtn.tabIndex = 0;
        }
        switchBtn.onclick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (!activeServerList || activeServerList.length <= 1) {
                showStreamToast("No alternative server available");
                return;
            }
            activeServerIndex = (activeServerIndex + 1) % activeServerList.length;
            playCurrentServerStream();
            showPlayerHeaderTemporarily();
            setTimeout(() => {
                if (switchBtn && switchBtn.style.display !== "none") {
                    switchBtn.focus();
                }
            }, 100);
        };
    }
}

function playCurrentServerStream() {
    if (!activeServerList || activeServerList.length === 0) {
        showStreamToast("No stream sources available.");
        return;
    }

    if (activeServerIndex >= activeServerList.length) {
        showStreamToast("All stream servers failed. Try again later.");
        return;
    }

    updatePlayerServerUI();

    let playUrl = activeServerList[activeServerIndex];
    const serverNum = activeServerIndex + 1;
    const totalServers = activeServerList.length;
    console.log(`[StreamEngine] Playing server ${serverNum}/${totalServers} (${getServerDisplayName(playUrl, activeServerIndex)}): ${playUrl}`);

    if (activeServerIndex > 0) {
        showStreamToast(`Connecting to ${getServerDisplayName(playUrl, activeServerIndex)} (${serverNum}/${totalServers})...`, 2500);
    }

    // Un-wrap direct player host if it points to videonode in AndroidBridge
    if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.resolveDirectStream === "function") {
        try {
            const resolved = window.AndroidBridge.resolveDirectStream(playUrl);
            if (resolved && resolved.startsWith("http")) {
                playUrl = resolved;
            }
        } catch (e) {
            console.warn("Direct stream resolution error:", e);
        }
    }

    const iframe = document.getElementById("videoIframe");
    const nativeVideo = document.getElementById("nativeVideoPlayer");

    // Check if playUrl is a direct .m3u8 stream or an embed URL
    const isDirectHls = playUrl.endsWith(".m3u8") || (playUrl.includes(".m3u8") && !playUrl.includes(".php"));

    if (streamFallbackTimer) {
        clearTimeout(streamFallbackTimer);
        streamFallbackTimer = null;
    }

    if (isDirectHls) {
        if (iframe) {
            iframe.src = "about:blank";
            iframe.classList.add("hidden");
        }
        if (nativeVideo) {
            nativeVideo.classList.remove("hidden");
            if (typeof Hls !== "undefined" && Hls.isSupported()) {
                if (window.currentHlsInstance) {
                    window.currentHlsInstance.destroy();
                }
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    backBufferLength: 90,
                    maxBufferLength: 60,
                    maxMaxBufferLength: 120,
                    xhrSetup: function (xhr, url) {
                        xhr.withCredentials = false;
                    }
                });
                hls.loadSource(playUrl);
                hls.attachMedia(nativeVideo);
                hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    isStreamLoaded = true;
                    isStreamPlaying = true;
                    hideTvCursor();
                    nativeVideo.play().catch(e => console.log("Auto-play error:", e));
                });
                hls.on(Hls.Events.ERROR, function (event, data) {
                    if (data.fatal) {
                        console.warn(`[StreamEngine] HLS Fatal Error on server ${serverNum}:`, data);
                        hls.destroy();
                        tryNextServerFallback();
                    }
                });
                window.currentHlsInstance = hls;
            } else if (nativeVideo.canPlayType("application/vnd.apple.mpegurl")) {
                nativeVideo.src = playUrl;
                nativeVideo.play().then(() => {
                    isStreamLoaded = true;
                    isStreamPlaying = true;
                    hideTvCursor();
                }).catch(e => {
                    console.log("Native m3u8 play error:", e);
                    tryNextServerFallback();
                });
            }
        }
    } else {
        if (nativeVideo) {
            nativeVideo.pause();
            nativeVideo.removeAttribute("src");
            nativeVideo.classList.add("hidden");
            if (window.currentHlsInstance) {
                window.currentHlsInstance.destroy();
                window.currentHlsInstance = null;
            }
        }
        if (iframe) {
            iframe.classList.remove("hidden");
            
            // Append autoplay query param if missing
            let embedUrl = playUrl;
            if (!embedUrl.includes("autoplay=")) {
                embedUrl += (embedUrl.includes("?") ? "&" : "?") + "autoplay=1&autostart=true";
            }
            
            // On web browsers (outside native Android webview bridge), route through embed proxy to bypass CSP and neutralize anti-inspect blockers
            if (typeof window.AndroidBridge === "undefined") {
                if (!embedUrl.includes("/api/embed?url=")) {
                    embedUrl = `${API_BASE}/api/embed?url=${encodeURIComponent(embedUrl)}`;
                }
            }
            
            iframe.src = embedUrl;

            // Trigger autoplay postMessage commands once loaded & display virtual cursor near play button
            iframe.onload = () => {
                try {
                    iframe.contentWindow.postMessage(JSON.stringify({ type: "play", func: "play", event: "play" }), "*");
                    iframe.contentWindow.postMessage("play", "*");
                } catch(e) {}

                // Pointer loads after iframe complete load, positioned near center play button
                if (!isStreamLoaded) {
                    showTvCursor();
                }
            };

            // Handle iframe error fallback
            iframe.onerror = () => {
                console.warn(`[StreamEngine] iframe onerror fired on server ${serverNum}`);
                tryNextServerFallback();
            };
        }
    }
}

function tryNextServerFallback() {
    if (activeServerIndex < activeServerList.length - 1) {
        activeServerIndex++;
        const nextNum = activeServerIndex + 1;
        showStreamToast(`Switching to Server ${nextNum}: ${getServerDisplayName(activeServerList[activeServerIndex], activeServerIndex)}...`, 2500);
        setTimeout(() => {
            playCurrentServerStream();
        }, 300);
    } else {
        showStreamToast("All stream servers tested. Please try another server or title.", 4000);
    }
}

// Global listener for postMessage events and errors from player iframes
window.addEventListener("message", (event) => {
    try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data && (data.event === "error" || data.status === "error" || data.type === "error" || data.error)) {
            console.warn("[StreamEngine] Received error message from embedded player:", data);
            tryNextServerFallback();
        } else if (data && (data.type === "userActivity" || data.event === "click" || data.type === "tap" || data.type === "play" || data.type === "pause")) {
            showPlayerHeaderTemporarily();
            if (data.type === "play" || data.event === "play") {
                isStreamLoaded = true;
                isStreamPlaying = true;
                hideTvCursor();
            }
        }
    } catch (e) {}
});

let currentDynamicStreamAbortCtrl = null;

async function resolveWebDynamicStreams(movie) {
    if (!movie) return;
    const targetUrl = movie.url || (movie.slug ? `https://tv12.lk21official.cc/${movie.slug}` : "");
    if (!targetUrl) return;

    if (currentDynamicStreamAbortCtrl) {
        currentDynamicStreamAbortCtrl.abort();
    }
    currentDynamicStreamAbortCtrl = new AbortController();

    try {
        console.log(`[StreamEngine] Dynamically resolving live stream sources on web for: ${movie.title || targetUrl}`);
        const res = await fetch(`${API_BASE}/api/resolve?url=${encodeURIComponent(targetUrl)}`, {
            signal: currentDynamicStreamAbortCtrl.signal
        });
        if (!res.ok) return;
        const result = await res.json();
        if (result && result.status === "success" && Array.isArray(result.sources) && result.sources.length > 0) {
            console.log(`[StreamEngine] Resolved ${result.sources.length} dynamic stream sources:`, result.sources);
            
            // Replace server list with fresh prioritized live streams (turbovidhls, gn1r5n, abyssplayer, playcdn)
            activeServerList = result.sources;
            window.activeServerList = activeServerList;

            // Automatically switch to the top working direct stream server
            activeServerIndex = 0;
            playCurrentServerStream();

            showStreamToast(`Dynamic streams loaded (${activeServerList.length} servers available)`, 2500);
        }
    } catch (e) {
        if (e.name !== "AbortError") {
            console.warn("[StreamEngine] Web dynamic stream resolution error:", e);
        }
    }
}

function checkAndApplyPlayerTitleMarquee() {
    const titleEl = document.getElementById("playerTitle");
    if (!titleEl) return;
    const parentBox = titleEl.closest(".player-title-box") || titleEl.parentElement;
    if (!parentBox) return;

    // Reset marquee to measure natural scrollWidth accurately
    titleEl.classList.remove("marquee");
    titleEl.style.removeProperty("--marquee-distance");

    // Allow browser layout and font rendering to settle before measurement
    requestAnimationFrame(() => {
        const containerWidth = parentBox.clientWidth;
        const textWidth = titleEl.scrollWidth;
        
        // Strictly only apply marquee animation if the title text does not fit inside the container
        if (containerWidth > 0 && textWidth > containerWidth + 2) {
            const overflowPx = textWidth - containerWidth;
            titleEl.style.setProperty("--marquee-distance", `-${overflowPx + 20}px`);
            titleEl.classList.add("marquee");
        }
    });
}

let isStreamLoaded = false;
let isStreamPlaying = false;

function openPlayerModal(movie) {
    const modal = document.getElementById("playerModal");
    activeMovieForPlayer = movie;
    isStreamLoaded = false;
    isStreamPlaying = false;
    
    // Hide virtual cursor initially until iframe finishes loading
    hideTvCursor();
    
    const titleEl = document.getElementById("playerTitle");
    if (titleEl) {
        titleEl.textContent = movie.title || "Now Playing";
        setTimeout(checkAndApplyPlayerTitleMarquee, 100);
        setTimeout(checkAndApplyPlayerTitleMarquee, 350);
    }

    const qualityEl = document.getElementById("playerQuality");
    if (qualityEl) qualityEl.textContent = movie.quality || "HD";

    const typeEl = document.getElementById("playerType");
    if (typeEl) typeEl.textContent = (movie.type || "MOVIE").toUpperCase();

    // Prepare list of candidate stream servers
    activeServerList = [];
    window.activeServerList = activeServerList;
    activeServerIndex = 0;

    // 1. Dynamic stream resolution from detail page via AndroidBridge (Native Android App)
    if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.resolveDetailStreamSources === "function" && movie.url) {
        try {
            const rawSources = window.AndroidBridge.resolveDetailStreamSources(movie.url);
            if (rawSources && rawSources !== "[]") {
                const sources = JSON.parse(rawSources);
                if (Array.isArray(sources) && sources.length > 0) {
                    sources.forEach(s => {
                        if (s && typeof s === "string" && s.startsWith("http") && !activeServerList.includes(s)) {
                            activeServerList.push(s);
                        }
                    });
                }
            }
        } catch (e) {
            console.warn("Method 2 dynamic stream resolution error:", e);
        }
    }

    // 2. Pre-scraped iframe_url & stream_url fallbacks (Immediate zero-latency playback)
    if (movie.iframe_url && !activeServerList.includes(movie.iframe_url)) {
        activeServerList.push(movie.iframe_url);
    }
    if (movie.stream_url && !activeServerList.includes(movie.stream_url)) {
        activeServerList.push(movie.stream_url);
    }

    // 3. Fallback default placeholder if completely empty
    if (activeServerList.length === 0) {
        activeServerList.push("https://videonode.de/iframe/p2p/fa848b1095647d3c9865199f5020636d");
    }

    // 4. Web Dynamic Stream Resolver (fetch & append fresh live streams asynchronously on web)
    if (typeof window.AndroidBridge === "undefined" && (movie.url || movie.slug)) {
        resolveWebDynamicStreams(movie);
    }

    console.log("[StreamEngine] Initialized candidate stream servers:", activeServerList);

    playCurrentServerStream();

    modal.classList.remove("hidden");

    // Auto hide top header overlay over stream after 10 seconds of inactivity
    showPlayerHeaderTemporarily();

    // Re-show header when user touches screen, taps, or moves mouse/TV remote over player modal
    ["touchstart", "touchend", "touchmove", "pointerdown", "pointerup", "pointermove", "mousemove", "mousedown", "click"].forEach((evtName) => {
        modal.addEventListener(evtName, () => {
            if (!modal.classList.contains("hidden")) {
                showPlayerHeaderTemporarily();
            }
        }, { passive: true, capture: true });
    });

    // Push history state so Android hardware back button / browser back closes player & returns to detail/catalog
    history.pushState({ modalOpen: "player" }, "");
    refreshFocusableElements();
    
    const iframe = document.getElementById("videoIframe");
    const nativeVideo = document.getElementById("nativeVideoPlayer");

    // Automatically focus the stream player container so D-Pad and remote controls immediately interact with the stream
    setTimeout(() => {
        if (iframe && !iframe.classList.contains("hidden")) {
            iframe.focus();
            try {
                if (iframe.contentWindow) {
                    iframe.contentWindow.focus();
                }
            } catch(e){}
        } else if (nativeVideo && !nativeVideo.classList.contains("hidden")) {
            nativeVideo.focus();
        }
    }, 200);
}

let tvCursorX = 0;
let tvCursorY = 0;
let tvCursorHideTimer = null;

function resetTvCursorHideTimer() {
    if (tvCursorHideTimer) clearTimeout(tvCursorHideTimer);
    const cursor = document.getElementById("tvVirtualCursor");
    if (cursor) cursor.style.opacity = "1";
    tvCursorHideTimer = setTimeout(() => {
        if (cursor) cursor.style.opacity = "0";
    }, 4000);
}

function updateTvCursorPosition(newX, newY) {
    const cursor = document.getElementById("tvVirtualCursor");
    if (!cursor) return;
    const maxX = window.innerWidth || 1920;
    const maxY = window.innerHeight || 1080;
    tvCursorX = Math.max(20, Math.min(maxX - 20, newX));
    tvCursorY = Math.max(20, Math.min(maxY - 20, newY));
    cursor.style.transform = `translate3d(${tvCursorX}px, ${tvCursorY}px, 0)`;
    resetTvCursorHideTimer();
}

function showTvCursor() {
    if (isStreamLoaded) return; // Do not show cursor if stream has already loaded/playing
    const cursor = document.getElementById("tvVirtualCursor");
    if (!cursor) return;
    const isTv = document.body.classList.contains("tv-mode") || (typeof window.AndroidBridge !== "undefined" && window.AndroidBridge.isTv && window.AndroidBridge.isTv());
    if (isTv) {
        cursor.classList.remove("hidden");
        cursor.style.opacity = "1";
        // Position near center / play button
        updateTvCursorPosition(window.innerWidth / 2, window.innerHeight / 2);
    } else {
        cursor.classList.add("hidden");
    }
}

function hideTvCursor() {
    if (tvCursorHideTimer) clearTimeout(tvCursorHideTimer);
    const cursor = document.getElementById("tvVirtualCursor");
    if (cursor) {
        cursor.classList.add("hidden");
        cursor.style.opacity = "0";
    }
}

function closePlayerModal(fromHistory = false) {
    const modal = document.getElementById("playerModal");
    if (modal.classList.contains("hidden")) return;
    
    hideTvCursor();
    
    if (currentDynamicStreamAbortCtrl) {
        currentDynamicStreamAbortCtrl.abort();
        currentDynamicStreamAbortCtrl = null;
    }

    if (playerHeaderTimer) clearTimeout(playerHeaderTimer);
    const header = document.querySelector(".player-header");
    if (header) header.classList.remove("fade-out");

    const iframe = document.getElementById("videoIframe");
    if (iframe) {
        iframe.src = "about:blank";
        iframe.removeAttribute("src");
        iframe.classList.remove("hidden");
    }

    const nativeVideo = document.getElementById("nativeVideoPlayer");
    if (nativeVideo) {
        nativeVideo.pause();
        nativeVideo.removeAttribute("src");
        nativeVideo.classList.add("hidden");
        if (window.currentHlsInstance) {
            window.currentHlsInstance.destroy();
            window.currentHlsInstance = null;
        }
    }

    modal.classList.add("hidden");
    
    if (!fromHistory && history.state && history.state.modalOpen === "player") {
        history.back();
    }
    refreshFocusableElements();

    // Restore focus to detailPlayBtn or detailBackBtn if detail view is still open
    const detailModal = document.getElementById("detailModal");
    if (detailModal && !detailModal.classList.contains("hidden")) {
        const detailPlay = document.getElementById("detailPlayBtn");
        if (detailPlay) detailPlay.focus();
    }
}

let lastFocusedElement = null;

function openDetailModal(movie) {
    // Remember which movie card had focus before opening modal
    if (document.activeElement && (document.activeElement.classList.contains('movie-card') || document.activeElement.id === 'heroInfoBtn' || document.activeElement.id === 'heroPlayBtn')) {
        lastFocusedElement = document.activeElement;
    }

    const modal = document.getElementById("detailModal");

    // Backdrop (blurred bg)
    document.getElementById("detailBanner").style.backgroundImage = `url('${movie.poster_image || ''}')`;

    // Poster image
    const posterImg = document.getElementById("detailPosterImg");
    if (posterImg) {
        posterImg.src = movie.poster_image || '';
        posterImg.alt = movie.title || 'Movie Poster';
    }

    const titleEl = document.getElementById("detailTitle");
    if (titleEl) titleEl.textContent = movie.title || "Untitled";

    const ratingEl = document.getElementById("detailRating");
    if (ratingEl) ratingEl.innerHTML = `<i class="fa-solid fa-star"></i> ${movie.rating || 'N/A'}`;

    const qualityEl = document.getElementById("detailQuality");
    if (qualityEl) qualityEl.textContent = movie.quality || 'HD';

    const typeEl = document.getElementById("detailType");
    if (typeEl) typeEl.textContent = (movie.type || 'MOVIE').toUpperCase();

    const synEl = document.getElementById("detailSynopsis");
    if (synEl) synEl.textContent = movie.synopsis || "No synopsis available.";

    const genresEl = document.getElementById("detailGenres");
    if (genresEl) genresEl.textContent = movie.genres || "-";

    const castEl = document.getElementById("detailCast");
    if (castEl) castEl.textContent = movie.cast || "-";

    const playBtn = document.getElementById("detailPlayBtn");
    playBtn.onclick = () => {
        // Do NOT close detail modal so it remains directly underneath the player view
        openPlayerModal(movie);
    };
    playBtn.onfocus = () => {
        const isTv = document.documentElement.classList.contains("tv-mode") || document.body.classList.contains("tv-mode") || (typeof window.AndroidBridge !== "undefined" && window.AndroidBridge.isTv && window.AndroidBridge.isTv());
        if (isTv && modal) {
            modal.scrollTop = 0;
            if (typeof modal.scrollTo === "function") {
                modal.scrollTo({ top: 0, behavior: "smooth" });
            }
        }
    };

    const posterCard = document.getElementById("detailPoster");
    if (posterCard) {
        posterCard.onclick = () => {
            openPlayerModal(movie);
        };
        posterCard.onkeydown = (e) => {
            if (e.key === "Enter" || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66) {
                e.preventDefault();
                openPlayerModal(movie);
            }
        };
    }

    // Render "You May Also Like" recommendation carousel
    renderRelatedMovies(movie);

    // Make visible, slide in, and ensure it scrolls directly to the top
    modal.scrollTop = 0;
    if (typeof modal.scrollTo === "function") modal.scrollTo(0, 0);
    modal.classList.remove("hidden");
    modal.style.display = "block";

    const backBtn = document.getElementById("closeDetailBtn");

    requestAnimationFrame(() => {
        modal.classList.add("detail-open");
        modal.scrollTop = 0;
        if (typeof modal.scrollTo === "function") modal.scrollTo(0, 0);
        refreshFocusableElements();
        if (backBtn) {
            backBtn.focus({ preventScroll: true });
        }
    });

    // Ensure scrollTop is 0 after CSS transition starts
    setTimeout(() => {
        modal.scrollTop = 0;
        if (typeof modal.scrollTo === "function") modal.scrollTo(0, 0);
        refreshFocusableElements();
        if (backBtn) {
            backBtn.focus({ preventScroll: true });
        }
    }, 50);

    const searchInput = document.getElementById("searchInput");
    if (searchInput) searchInput.blur();

    history.pushState({ modalOpen: "detail" }, "");
}

/* ==========================================================================
   Recommendation Engine: "You May Also Like" (Title, Summary & Genre based)
   ========================================================================== */
function getRelatedMovies(currentMovie, limit = 10) {
    if (!currentMovie) return [];

    const candidates = loadedMoviesPool.filter(m => m && m.id !== currentMovie.id);
    if (candidates.length === 0) return [];

    // Helper: tokenize text into clean normalized words
    const tokenize = (text) => {
        if (!text) return new Set();
        return new Set(
            text
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter(w => w.length > 2 && !["the", "and", "for", "with", "this", "that", "from", "yang", "dan", "untuk", "dari", "movie", "film"].includes(w))
        );
    };

    // Extract current movie features
    const currentGenres = (currentMovie.genres || "")
        .toLowerCase()
        .split(/[,/|]/)
        .map(g => g.trim())
        .filter(Boolean);

    const currentTitleWords = tokenize(currentMovie.title);
    const currentSynopsisWords = tokenize(currentMovie.synopsis);

    // Score candidates based on Genre (40%), Summary (35%), and Title (25%) + random jitter
    const scoredCandidates = candidates.map(candidate => {
        let score = 0;

        // 1. Genre similarity (Weight: 40 pts max)
        if (currentGenres.length > 0 && candidate.genres) {
            const candGenres = candidate.genres.toLowerCase().split(/[,/|]/).map(g => g.trim());
            let genreMatches = 0;
            currentGenres.forEach(cg => {
                if (candGenres.some(candG => candG.includes(cg) || cg.includes(candG))) {
                    genreMatches++;
                }
            });
            score += (genreMatches / currentGenres.length) * 40;
        }

        // 2. Summary / Synopsis similarity (Weight: 35 pts max)
        if (currentSynopsisWords.size > 0 && candidate.synopsis) {
            const candSynWords = tokenize(candidate.synopsis);
            let synMatches = 0;
            currentSynopsisWords.forEach(w => {
                if (candSynWords.has(w)) synMatches++;
            });
            const ratio = Math.min(1, synMatches / Math.max(3, currentSynopsisWords.size * 0.3));
            score += ratio * 35;
        }

        // 3. Title similarity (Weight: 25 pts max)
        if (currentTitleWords.size > 0 && candidate.title) {
            const candTitleWords = tokenize(candidate.title);
            let titleMatches = 0;
            currentTitleWords.forEach(w => {
                if (candTitleWords.has(w)) titleMatches++;
            });
            const ratio = Math.min(1, titleMatches / Math.max(1, currentTitleWords.size));
            score += ratio * 25;
        }

        // Add small random noise (0-15 pts) so recommendations feel dynamic and varied
        score += Math.random() * 15;

        return { movie: candidate, score };
    });

    // Sort descending by score and pick top limit
    scoredCandidates.sort((a, b) => b.score - a.score);
    return scoredCandidates.slice(0, limit).map(item => item.movie);
}

function renderRelatedMovies(currentMovie) {
    const scrollContainer = document.getElementById("detailRelatedScroll");
    const section = document.getElementById("detailRelatedSection");
    if (!scrollContainer || !section) return;

    scrollContainer.innerHTML = "";
    const related = getRelatedMovies(currentMovie, 10);

    if (related.length === 0) {
        section.style.display = "none";
        return;
    }

    section.style.display = "block";

    related.forEach(movie => {
        const card = document.createElement("div");
        card.className = "related-movie-card";
        card.setAttribute("tabindex", "0");
        card.setAttribute("data-movie-id", movie.id);

        let displayTitle = movie.title || "Untitled";
        displayTitle = displayTitle.replace(/\s*(?:-|\b)\s*(\d{4})\s*$/, ' ($1)');

        card.innerHTML = `
            <img src="${movie.poster_image || 'https://via.placeholder.com/200x300'}" alt="${movie.title}" loading="lazy">
            <div class="related-overlay">
                <div class="related-title">${displayTitle}</div>
                <div class="related-rating"><i class="fa-solid fa-star"></i> ${movie.rating || 'N/A'}</div>
            </div>
        `;

        card.addEventListener("click", () => {
            openDetailModal(movie);
        });

        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66) {
                e.preventDefault();
                openDetailModal(movie);
            }
        });

        scrollContainer.appendChild(card);
    });
}

function closeDetailModal(fromHistory = false) {
    const modal = document.getElementById("detailModal");
    if (!modal.classList.contains("detail-open")) return;

    modal.classList.remove("detail-open");
    setTimeout(() => {
        modal.classList.add("hidden");
        modal.style.display = "none";
        refreshFocusableElements();
        
        // Restore focus to the movie card or hero button that opened the detail view
        if (lastFocusedElement && document.body.contains(lastFocusedElement)) {
            lastFocusedElement.focus();
            lastFocusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        } else {
            const firstCard = document.querySelector("#mainMovieGrid .movie-card, #heroPlayBtn");
            if (firstCard) firstCard.focus();
        }
    }, 350);

    if (!fromHistory && history.state && history.state.modalOpen === "detail") {
        history.back();
    }
}


/* ==========================================================================
   5. Android TV D-Pad Remote Controller Navigation Logic
   ========================================================================== */
function refreshFocusableElements() {
    const detailModal = document.getElementById("detailModal");
    const isDetailOpen = detailModal && !detailModal.classList.contains("hidden");
    const playerModal = document.getElementById("playerModal");
    const isPlayerOpen = playerModal && !playerModal.classList.contains("hidden");

    const isVisible = (el) => {
        if (!el) return false;
        if (el.classList.contains('hidden')) return false;
        if (el.style.display === 'none') return false;
        if (el.offsetParent === null && el.getClientRects && el.getClientRects().length === 0 && !el.closest('#detailModal, #playerModal')) {
            return false;
        }
        return true;
    };

    if (isPlayerOpen) {
        focusableElements = Array.from(playerModal.querySelectorAll('button:not(.hidden), [tabindex="0"]:not(.hidden)'))
                                 .filter(isVisible);
    } else if (isDetailOpen) {
        focusableElements = Array.from(detailModal.querySelectorAll('button:not(.hidden), [tabindex="0"]:not(.hidden), .btn:not(.hidden)'))
                                 .filter(isVisible);
    } else {
        focusableElements = Array.from(document.querySelectorAll('button:not(.hidden), [tabindex="0"]:not(.hidden), .movie-card:not(.hidden), .genre-item'))
                                 .filter(el => !el.closest('.hidden') && isVisible(el));
    }
}

function navigateDpad(direction) {
    refreshFocusableElements();
    if (focusableElements.length === 0) return;

    const currentEl = document.activeElement;
    let currentIndex = focusableElements.indexOf(currentEl);

    if (currentIndex === -1) {
        focusableElements[0].focus();
        return;
    }

    const detailModal = document.getElementById("detailModal");
    const isDetailOpen = detailModal && !detailModal.classList.contains("hidden");
    const playerModal = document.getElementById("playerModal");
    const isPlayerOpen = playerModal && !playerModal.classList.contains("hidden");

    // If inside detail page, handle direct navigation between Back, Poster, Watch Now, and Related Cards
    if (isDetailOpen) {
        const backBtn = document.getElementById("closeDetailBtn");
        const playBtn = document.getElementById("detailPlayBtn");
        const posterEl = document.getElementById("detailPoster");

        if (currentEl === backBtn) {
            if (direction === "DOWN" || direction === "RIGHT") {
                if (playBtn) playBtn.focus();
                return;
            }
        } else if (currentEl === playBtn) {
            if (direction === "UP") {
                if (backBtn) backBtn.focus();
                return;
            } else if (direction === "LEFT") {
                if (posterEl) posterEl.focus();
                else if (backBtn) backBtn.focus();
                return;
            } else if (direction === "DOWN") {
                const firstRelated = document.querySelector("#detailRelatedScroll .related-movie-card");
                if (firstRelated) {
                    firstRelated.focus();
                    return;
                }
            }
        } else if (currentEl === posterEl) {
            if (direction === "UP" || direction === "LEFT") {
                if (backBtn) backBtn.focus();
                return;
            } else if (direction === "RIGHT" || direction === "DOWN") {
                if (playBtn) playBtn.focus();
                return;
            }
        } else if (currentEl && currentEl.classList.contains("related-movie-card")) {
            if (direction === "UP") {
                if (playBtn) {
                    playBtn.focus();
                    if (detailModal) {
                        detailModal.scrollTop = 0;
                        if (typeof detailModal.scrollTo === "function") detailModal.scrollTo({ top: 0, behavior: "smooth" });
                    }
                    return;
                }
            }
        }
    }

    const navbar = document.querySelector('.navbar');
    const isTv = document.documentElement.classList.contains('tv-mode') || document.body.classList.contains('tv-mode');

    // In TV mode, determine if current focus is already inside the sidebar
    const currentInSidebar = isTv && navbar && navbar.contains(currentEl);

    const currentRect = currentEl.getBoundingClientRect();
    let bestNextEl = null;
    let minDistance = Infinity;

    focusableElements.forEach(el => {
        if (el === currentEl) return;

        // In TV mode, sidebar nav items should NEVER be reachable via UP/DOWN/RIGHT from grid.
        // They are only reachable via LEFT when there's no other left-side candidate.
        if (isTv && navbar && navbar.contains(el) && !currentInSidebar) {
            return;
        }

        const rect = el.getBoundingClientRect();

        let isCandidate = false;
        if (direction === "UP" && rect.bottom <= currentRect.top + 10) isCandidate = true;
        if (direction === "DOWN" && rect.top >= currentRect.bottom - 10) isCandidate = true;
        if (direction === "LEFT" && rect.right <= currentRect.left + 10) isCandidate = true;
        if (direction === "RIGHT" && rect.left >= currentRect.right - 10) isCandidate = true;

        if (isCandidate) {
            const dx = (rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2);
            const dy = (rect.top + rect.height / 2) - (currentRect.top + currentRect.height / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minDistance) {
                minDistance = dist;
                bestNextEl = el;
            }
        }
    });

    // In TV mode: handle custom looping in sidebar navigation
    if (isTv && currentInSidebar) {
        const allItem = document.querySelector('.genre-item[data-genre="ALL"]');
        const searchTrig = document.getElementById("searchTrigger");
        const searchInp = document.getElementById("searchInput");
        const searchBox = document.getElementById("searchContainer");

        // 1. If at most top item ("All") and pressing UP -> go directly to search bar input
        if (direction === "UP" && (currentEl === allItem || currentEl.dataset?.genre === "ALL" || currentEl.id === "brandLogo")) {
            if (searchInp) {
                searchInp.focus();
                return;
            }
        }

        // 2. If at search input / container and pressing DOWN -> move directly to "All"
        if (direction === "DOWN" && (currentEl === searchInp || currentEl === searchTrig || currentEl === searchBox || currentEl.closest("#searchContainer"))) {
            if (allItem) {
                allItem.focus();
                return;
            }
        }
    }

    // In TV mode: if pressing LEFT and no candidate found (we're at leftmost grid column)
    // AND NOT inside a modal/detail page, open sidebar by focusing active genre item.
    if (isTv && direction === "LEFT" && !bestNextEl && !currentInSidebar && !isDetailOpen && !isPlayerOpen && navbar) {
        const activeItem = navbar.querySelector('.genre-item.active') || navbar.querySelector('.genre-item, [tabindex="0"]');
        if (activeItem) {
            activeItem.focus();
        }
        return;
    }

    // In TV mode: if pressing RIGHT while inside the sidebar, jump focus to Hero Play button or first movie card
    if (isTv && direction === "RIGHT" && currentInSidebar) {
        const firstMainContentEl = document.querySelector('#heroPlayBtn, #mainMovieGrid .movie-card');
        if (firstMainContentEl) {
            firstMainContentEl.focus();
            if (firstMainContentEl.id === 'heroPlayBtn') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                firstMainContentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            }
            return;
        }
    }

    if (bestNextEl) {
        bestNextEl.focus();
        if (bestNextEl.id === 'heroPlayBtn' || bestNextEl.id === 'heroInfoBtn' || bestNextEl.closest('.hero-billboard')) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            bestNextEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    } else {
        // Fallback 1: If moving UP from the top row of movie cards and no element found directly above,
        // jump focus to the Hero Play / Watch Now button and scroll to absolute top to reveal header
        if (direction === "UP" && currentEl.classList.contains('movie-card')) {
            const allCards = Array.from(document.querySelectorAll('#mainMovieGrid .movie-card'));
            const cardIdx = allCards.indexOf(currentEl);
            if (cardIdx < 4) { // Top row cards
                const heroPlayBtn = document.getElementById("heroPlayBtn") || document.getElementById("heroInfoBtn");
                if (heroPlayBtn) {
                    heroPlayBtn.focus();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    return;
                }
            }
        }

        // Fallback 2: If moving DOWN from Hero Action buttons, jump to the first movie card in the grid
        if (direction === "DOWN" && (currentEl.id === 'heroPlayBtn' || currentEl.id === 'heroInfoBtn')) {
            const firstCard = document.querySelector('#mainMovieGrid .movie-card');
            if (firstCard) {
                firstCard.focus();
                firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                return;
            }
        }

        // Fallback 3: If moving DOWN from a movie card and spatial check missed the card below,
        // move to the card in next row DOM order
        if (direction === "DOWN" && currentEl.classList.contains('movie-card')) {
            const allCards = Array.from(document.querySelectorAll('#mainMovieGrid .movie-card'));
            const cardIdx = allCards.indexOf(currentEl);
            if (cardIdx !== -1 && cardIdx + 4 < allCards.length) {
                allCards[cardIdx + 4].focus();
                allCards[cardIdx + 4].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            }
        }
    }
}

/* Setup Keyboard, Top Genre Navigation & Search Listeners */
function setupEventListeners() {
    // Top-Left & Mobile Sub-Header Genre Menu Listeners
    const genreItems = document.querySelectorAll(".genre-item, .genre-pill");
    genreItems.forEach(item => {
        const handler = () => {
            genreItems.forEach(i => i.classList.remove("active"));
            const targetGenre = item.getAttribute("data-genre");
            
            // Highlight matching genre pills on both desktop nav and mobile sub-bar
            document.querySelectorAll(`[data-genre="${targetGenre}"]`).forEach(el => el.classList.add("active"));

            activeGenre = targetGenre;
            currentSearchQuery = "";
            document.getElementById("searchInput").value = "";
            loadMovies(1, true);

            // In TV mode: automatically move focus to the hero banner button to show the full hero poster
            const navbar = document.getElementById("navbar");
            if (navbar) navbar.classList.remove("sidebar-expanded");
            
            setTimeout(() => {
                const targetFocus = document.querySelector("#heroPlayBtn, #mainMovieGrid .movie-card");
                if (targetFocus) {
                    targetFocus.focus();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }, 300);
        };

        item.addEventListener("click", handler);
        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66) {
                e.preventDefault();
                handler();
            }
        });
    });

    // Search Trigger & Input Listeners
    const searchTrigger = document.getElementById("searchTrigger");
    const searchInput = document.getElementById("searchInput");
    if (searchTrigger && searchInput) {
        const activateSearch = () => {
            searchInput.focus();
        };
        searchTrigger.addEventListener("click", activateSearch);
        searchTrigger.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.keyCode === 13) {
                activateSearch();
            }
        });
    }

    let searchTimeout;
    searchInput.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearchQuery = e.target.value.trim();
            loadMovies(1, true);
        }, 400);
    });

    // Keyboard Event Listener for Android TV Remote Keys & Player Controls
    document.addEventListener("keydown", (e) => {
        const playerModal = document.getElementById("playerModal");
        const isPlayerOpen = playerModal && !playerModal.classList.contains("hidden");

        // Handle Android TV Player Remote Controls when video player is open
        if (isPlayerOpen) {
            const key = e.key;
            const keyCode = e.keyCode;
            const isTv = document.body.classList.contains("tv-mode") || (typeof window.AndroidBridge !== "undefined" && window.AndroidBridge.isTv && window.AndroidBridge.isTv());

            // 1. Re-appear top cinematic header overlay on ANY D-Pad / remote key press (up, down, left, right, ok)
            showPlayerHeaderTemporarily();

            const activeEl = document.activeElement;
            const isCloseBtn = activeEl && activeEl.id === "closePlayerBtn";
            const isSwitchBtn = activeEl && activeEl.id === "switchServerBtn";
            const isHeaderBtnFocused = isCloseBtn || isSwitchBtn;

            // === 2. IF FOCUS IS ON BUTTONS IN THE HEADER ===
            if (isHeaderBtnFocused) {
                if (key === "Enter" || keyCode === 13 || keyCode === 23 || keyCode === 66 || key === " " || keyCode === 32) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isCloseBtn) {
                        closePlayerModal();
                    } else if (isSwitchBtn) {
                        const switchBtn = document.getElementById("switchServerBtn");
                        if (switchBtn) switchBtn.click();
                    }
                    return;
                }

                if (key === "ArrowLeft" || keyCode === 37) {
                    e.preventDefault();
                    if (isSwitchBtn) {
                        const closeBtn = document.getElementById("closePlayerBtn");
                        if (closeBtn) closeBtn.focus();
                    }
                    return;
                }

                if (key === "ArrowRight" || keyCode === 39) {
                    e.preventDefault();
                    if (isCloseBtn) {
                        const switchBtn = document.getElementById("switchServerBtn");
                        if (switchBtn && switchBtn.style.display !== "none" && switchBtn.offsetParent !== null) {
                            switchBtn.focus();
                        }
                    }
                    return;
                }

                if (key === "ArrowDown" || keyCode === 40) {
                    e.preventDefault();
                    if (activeEl) activeEl.blur();
                    const iframe = document.getElementById("videoIframe");
                    const nativeVideo = document.getElementById("nativeVideoPlayer");
                    if (iframe && !iframe.classList.contains("hidden")) iframe.focus();
                    else if (nativeVideo && !nativeVideo.classList.contains("hidden")) nativeVideo.focus();
                    return;
                }

                if (key === "ArrowUp" || keyCode === 38) {
                    e.preventDefault();
                    return;
                }
            }

            // === 3. VIRTUAL POINTER MODE (ONLY BEFORE STREAM HAS LOADED / PLAYED) ===
            if (isTv && !isStreamLoaded) {
                const cursorEl = document.getElementById("tvVirtualCursor");
                const isCursorVisible = cursorEl && !cursorEl.classList.contains("hidden") && cursorEl.style.opacity !== "0";

                // If pointer is hidden before stream loads, pressing DOWN brings it back
                if (!isCursorVisible && (key === "ArrowDown" || keyCode === 40)) {
                    e.preventDefault();
                    showTvCursor();
                    return;
                }

                if (isCursorVisible) {
                    const step = 45; // Pixels per D-Pad press

                    if (key === "ArrowUp" || keyCode === 38) {
                        e.preventDefault();
                        if (tvCursorY - step < 80) {
                            const switchBtn = document.getElementById("switchServerBtn");
                            const closeBtn = document.getElementById("closePlayerBtn");
                            if (switchBtn && switchBtn.style.display !== "none") switchBtn.focus();
                            else if (closeBtn) closeBtn.focus();
                            hideTvCursor();
                            return;
                        }
                        updateTvCursorPosition(tvCursorX, tvCursorY - step);
                        return;
                    }

                    if (key === "ArrowDown" || keyCode === 40) {
                        e.preventDefault();
                        updateTvCursorPosition(tvCursorX, tvCursorY + step);
                        return;
                    }

                    if (key === "ArrowLeft" || keyCode === 37) {
                        e.preventDefault();
                        updateTvCursorPosition(tvCursorX - step, tvCursorY);
                        return;
                    }

                    if (key === "ArrowRight" || keyCode === 39) {
                        e.preventDefault();
                        updateTvCursorPosition(tvCursorX + step, tvCursorY);
                        return;
                    }

                    if (key === "Enter" || keyCode === 13 || keyCode === 23 || keyCode === 66 || key === " " || keyCode === 32) {
                        e.preventDefault();
                        e.stopPropagation();

                        if (cursorEl) {
                            cursorEl.classList.add("clicking");
                            setTimeout(() => cursorEl.classList.remove("clicking"), 220);
                        }

                        const screenW = window.innerWidth || 1920;
                        const screenH = window.innerHeight || 1080;
                        const normX = tvCursorX / screenW;
                        const normY = tvCursorY / screenH;

                        if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.simulateNativeTouchNormalized === "function") {
                            window.AndroidBridge.simulateNativeTouchNormalized(normX, normY);
                        } else {
                            togglePlayerPlayback();
                        }
                        isStreamLoaded = true;
                        isStreamPlaying = true;
                        setTimeout(() => hideTvCursor(), 800);
                        return;
                    }
                }
            }

            // === 4. ACTIVE STREAM PLAYBACK CONTROLS (STREAM IS PLAYING / LOADED) ===
            // Pressing UP brings focus to header button
            if (key === "ArrowUp" || keyCode === 38) {
                e.preventDefault();
                const switchBtn = document.getElementById("switchServerBtn");
                const closeBtn = document.getElementById("closePlayerBtn");
                if (switchBtn && switchBtn.style.display !== "none" && switchBtn.offsetParent !== null) {
                    switchBtn.focus();
                } else if (closeBtn) {
                    closeBtn.focus();
                }
                return;
            }

            // Pressing OK / ENTER toggles pause/play
            if (key === "Enter" || keyCode === 13 || keyCode === 23 || keyCode === 66 || key === " " || keyCode === 32) {
                e.preventDefault();
                e.stopPropagation();
                togglePlayerPlayback();
                return;
            }

            // Pressing RIGHT fast-forwards 10s
            if (key === "ArrowRight" || keyCode === 39) {
                e.preventDefault();
                seekPlayerStream(10);
                return;
            }

            // Pressing LEFT rewinds 10s
            if (key === "ArrowLeft" || keyCode === 37) {
                e.preventDefault();
                seekPlayerStream(-10);
                return;
            }

            // Pressing DOWN while stream is playing refreshes header without showing pointer
            if (key === "ArrowDown" || keyCode === 40) {
                e.preventDefault();
                return;
            }
        }

        const key = e.key;

        if (key === "ArrowUp" || e.keyCode === 38) {
            e.preventDefault();
            navigateDpad("UP");
        } else if (key === "ArrowDown" || e.keyCode === 40) {
            e.preventDefault();
            navigateDpad("DOWN");
        } else if (key === "ArrowLeft" || e.keyCode === 37) {
            e.preventDefault();
            navigateDpad("LEFT");
        } else if (key === "ArrowRight" || e.keyCode === 39) {
            e.preventDefault();
            navigateDpad("RIGHT");
        } else if (key === "Enter" || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66) {
            const activeEl = document.activeElement;
            if (activeEl && typeof activeEl.click === "function") {
                // If it's not an input field, trigger click
                if (activeEl.tagName !== "INPUT" && activeEl.tagName !== "TEXTAREA") {
                    e.preventDefault();
                    activeEl.click();
                }
            }
        } else if (key === "Escape" || e.keyCode === 27 || key === "Backspace" || e.keyCode === 10009 || e.keyCode === 4) {
            if (!document.getElementById("playerModal").classList.contains("hidden")) {
                e.preventDefault();
                closePlayerModal();
            } else if (!document.getElementById("detailModal").classList.contains("hidden")) {
                e.preventDefault();
                closeDetailModal();
            }
        }
    });

    // Android hardware Back Button / Browser Back button handling
    window.addEventListener("popstate", (e) => {
        if (!document.getElementById("playerModal").classList.contains("hidden")) {
            closePlayerModal(true);
        } else if (!document.getElementById("detailModal").classList.contains("hidden")) {
            closeDetailModal(true);
        }
    });

    // Capacitor Native Android Hardware Back Button listener
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        window.Capacitor.Plugins.App.addListener('backButton', (data) => {
            const playerModal = document.getElementById("playerModal");
            const detailModal = document.getElementById("detailModal");

            if (playerModal && !playerModal.classList.contains("hidden")) {
                closePlayerModal(true);
            } else if (detailModal && !detailModal.classList.contains("hidden")) {
                closeDetailModal(true);
            } else if (data.canGoBack) {
                window.history.back();
            } else {
                window.Capacitor.Plugins.App.minimizeApp();
            }
        });
    }

    document.getElementById("closePlayerBtn").onclick = () => closePlayerModal(false);
    document.getElementById("closeDetailBtn").onclick = () => closeDetailModal(false);

    // Navbar Glass Effect
    window.addEventListener("scroll", () => {
        const nav = document.getElementById("navbar");
        if (window.scrollY > 50) {
            nav.classList.add("scrolled");
        } else {
            nav.classList.remove("scrolled");
        }
    });

    // Recalculate title marquee on window resize or rotation
    window.addEventListener("resize", checkAndApplyPlayerTitleMarquee);
    window.addEventListener("orientationchange", () => {
        setTimeout(checkAndApplyPlayerTitleMarquee, 200);
    });
}
