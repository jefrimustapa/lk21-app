/* ==========================================================================
   LK-flix - Application Logic & Cloudflare D1 Infinite Scroll Integration
   ========================================================================== */

const API_BASE = "https://lk21-api.lkapp.workers.dev";
const PAGE_LIMIT = 24;

// Application Global State
let focusableElements = [];
let isTvMode = false;

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
    setupDpadController();
    setupInfiniteScroll();
});

/* ==========================================================================
   1. Device Mode Detection (TV vs Phone/Desktop)
   ========================================================================== */
function detectDeviceMode() {
    const userAgent = navigator.userAgent.toLowerCase();
    const isTVUserAgent = userAgent.includes("googletv") || 
                          userAgent.includes("android tv") || 
                          userAgent.includes("smart-tv") || 
                          userAgent.includes("hbbtv") || 
                          userAgent.includes("crkey");
                          
    if (isTVUserAgent || window.innerWidth >= 1024) {
        enableTvMode();
    } else {
        enableMobileMode();
    }

    window.addEventListener("resize", () => {
        if (window.innerWidth < 768) {
            enableMobileMode();
        } else {
            enableTvMode();
        }
    });
}

function enableTvMode() {
    isTvMode = true;
    document.body.classList.add("tv-mode");
    document.getElementById("deviceModeText").innerText = "TV Mode (D-Pad Ready)";
    document.getElementById("dpadController").classList.remove("hidden");
    refreshFocusableElements();
}

function enableMobileMode() {
    isTvMode = false;
    document.body.classList.remove("tv-mode");
    document.getElementById("deviceModeText").innerText = "Mobile Touch Mode";
    document.getElementById("dpadController").classList.add("hidden");
}

/* ==========================================================================
   2. App Initialization & Initial Data Fetch
   ========================================================================== */
async function initApp() {
    // 1. Fetch initial Page 1 data
    await loadMovies(1, true);

    // 2. Fetch Hero Billboard movie
    try {
        const res = await fetch(`${API_BASE}/api/movies?page=1&limit=1`);
        const json = await res.json();
        if (json.status === "success" && json.data && json.data.length > 0) {
            renderHeroBillboard(json.data[0]);
        }
    } catch (e) {
        console.error("Error loading hero banner:", e);
    }
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
            fetchUrl = `${API_BASE}/api/search?q=${encodeURIComponent(activeGenre)}`;
        } else {
            fetchUrl = `${API_BASE}/api/movies?page=${page}&limit=${PAGE_LIMIT}`;
        }

        const res = await fetch(fetchUrl);
        const json = await res.json();

        if (json.status === "success" && json.data) {
            let movies = json.data;

            // Client side genre filter refinement if using search API
            if (activeGenre && activeGenre !== "ALL") {
                movies = movies.filter(m => (m.genres || '').toLowerCase().includes(activeGenre.toLowerCase()));
            }

            if (json.total) totalMoviesCount = json.total;

            if (movies.length === 0) {
                if (resetGrid) {
                    document.getElementById("mainMovieGrid").innerHTML = `<p style="color:#A3A3A3; padding: 30px; grid-column: 1/-1; text-align: center;">No movies found.</p>`;
                }
                hasMore = false;
            } else {
                appendMoviesToGrid(movies);

                // If searching or filtering single genre, search API returns all results at once
                if (currentSearchQuery || (activeGenre && activeGenre !== "ALL")) {
                    hasMore = false;
                } else {
                    if (movies.length < PAGE_LIMIT) {
                        hasMore = false;
                    } else {
                        currentPage++;
                    }
                }
            }

            updateCatalogTitle();
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

        card.innerHTML = `
            <img class="movie-poster" src="${movie.poster_image || 'https://via.placeholder.com/200x300'}" alt="${movie.title}" loading="lazy">
            <div class="movie-card-overlay">
                <div class="card-title">${movie.title}</div>
                <div class="card-meta">
                    <span class="card-rating"><i class="fa-solid fa-star"></i> ${movie.rating || 'N/A'}</span>
                    <span class="card-quality">${movie.quality || 'HD'}</span>
                </div>
            </div>
        `;

        card.addEventListener("click", () => openDetailModal(movie));
        card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.keyCode === 13) {
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
function renderHeroBillboard(movie) {
    if (!movie) return;
    
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
}

function openPlayerModal(movie) {
    const modal = document.getElementById("playerModal");
    const iframe = document.getElementById("videoIframe");
    document.getElementById("playerTitle").innerText = movie.title || "Now Playing";

    const playUrl = movie.stream_url || movie.iframe_url || "https://videonode.de/iframe/p2p/fa848b1095647d3c9865199f5020636d";
    iframe.src = playUrl;
    modal.classList.remove("hidden");
    refreshFocusableElements();
    document.getElementById("closePlayerBtn").focus();
}

function closePlayerModal() {
    const modal = document.getElementById("playerModal");
    const iframe = document.getElementById("videoIframe");
    iframe.src = "";
    modal.classList.add("hidden");
    refreshFocusableElements();
}

function openDetailModal(movie) {
    const modal = document.getElementById("detailModal");
    document.getElementById("detailBanner").style.backgroundImage = `url('${movie.poster_image || ''}')`;
    document.getElementById("detailTitle").innerText = movie.title;
    document.getElementById("detailRating").innerHTML = `<i class="fa-solid fa-star"></i> ${movie.rating || 'N/A'}`;
    document.getElementById("detailQuality").innerText = movie.quality || 'HD';
    document.getElementById("detailType").innerText = (movie.type || 'MOVIE').toUpperCase();
    document.getElementById("detailSynopsis").innerText = movie.synopsis || "No synopsis available.";
    document.getElementById("detailGenres").innerText = movie.genres || "-";
    document.getElementById("detailCast").innerText = movie.cast || "-";

    document.getElementById("detailPlayBtn").onclick = () => {
        closeDetailModal();
        openPlayerModal(movie);
    };

    modal.classList.remove("hidden");
    refreshFocusableElements();
    document.getElementById("detailPlayBtn").focus();
}

function closeDetailModal() {
    document.getElementById("detailModal").classList.add("hidden");
    refreshFocusableElements();
}

/* ==========================================================================
   5. Android TV D-Pad Remote Controller Navigation Logic
   ========================================================================== */
function refreshFocusableElements() {
    focusableElements = Array.from(document.querySelectorAll('button:not(.hidden), [tabindex="0"]:not(.hidden), input:not(.hidden), .movie-card:not(.hidden), .genre-item'))
                             .filter(el => el.offsetParent !== null);
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

    const currentRect = currentEl.getBoundingClientRect();
    let bestNextEl = null;
    let minDistance = Infinity;

    focusableElements.forEach(el => {
        if (el === currentEl) return;
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

    if (bestNextEl) {
        bestNextEl.focus();
        bestNextEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
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
        };

        item.addEventListener("click", handler);
        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.keyCode === 13) {
                handler();
            }
        });
    });

    // Logo Brand Click -> Reset to All
    const brandLogo = document.getElementById("brandLogo");
    if (brandLogo) {
        brandLogo.onclick = () => {
            genreItems.forEach(i => i.classList.remove("active"));
            document.querySelector('.genre-item[data-genre="ALL"]').classList.add("active");
            activeGenre = "ALL";
            currentSearchQuery = "";
            document.getElementById("searchInput").value = "";
            loadMovies(1, true);
        };
    }

    // Search Input Listener
    let searchTimeout;
    const searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearchQuery = e.target.value.trim();
            loadMovies(1, true);
        }, 400);
    });

    // Keyboard Event Listener for Android TV Remote Keys
    document.addEventListener("keydown", (e) => {
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
        } else if (key === "Escape" || e.keyCode === 27 || key === "Backspace" || e.keyCode === 10009) {
            if (!document.getElementById("playerModal").classList.contains("hidden")) {
                closePlayerModal();
            } else if (!document.getElementById("detailModal").classList.contains("hidden")) {
                closeDetailModal();
            }
        }
    });

    document.getElementById("closePlayerBtn").onclick = closePlayerModal;
    document.getElementById("closeDetailBtn").onclick = closeDetailModal;

    // Navbar Glass Effect
    window.addEventListener("scroll", () => {
        const nav = document.getElementById("navbar");
        if (window.scrollY > 50) {
            nav.classList.add("scrolled");
        } else {
            nav.classList.remove("scrolled");
        }
    });
}

function setupDpadController() {
    document.getElementById("btnDpadUp").onclick = () => navigateDpad("UP");
    document.getElementById("btnDpadDown").onclick = () => navigateDpad("DOWN");
    document.getElementById("btnDpadLeft").onclick = () => navigateDpad("LEFT");
    document.getElementById("btnDpadRight").onclick = () => navigateDpad("RIGHT");
    document.getElementById("btnDpadOk").onclick = () => {
        if (document.activeElement) document.activeElement.click();
    };
    document.getElementById("btnDpadBack").onclick = () => {
        if (!document.getElementById("playerModal").classList.contains("hidden")) {
            closePlayerModal();
        } else if (!document.getElementById("detailModal").classList.contains("hidden")) {
            closeDetailModal();
        }
    };
}
