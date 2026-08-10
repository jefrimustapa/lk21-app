/* ==========================================================================
   StreamFlix - Application Logic & Cloudflare D1 Integration
   ========================================================================== */

const API_BASE = "https://lk21-api.lkapp.workers.dev";

// Application Global State
let allMovies = [];
let focusableElements = [];
let currentFocusIndex = 0;
let isTvMode = false;
let currentActiveRow = 0;

document.addEventListener("DOMContentLoaded", () => {
    detectDeviceMode();
    fetchCatalogData();
    setupEventListeners();
    setupDpadController();
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
                          
    // Default to TV Mode for easy testing on Laptop/TV unless screen width is small (Phone)
    if (isTVUserAgent || window.innerWidth >= 1024) {
        enableTvMode();
    } else {
        enableMobileMode();
    }

    // Auto adapt on window resize
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
   2. Fetch Data from Cloudflare Worker D1 API
   ========================================================================== */
async function fetchCatalogData() {
    try {
        // Fetch up to 100 movies for rich categorization
        const response = await fetch(`${API_BASE}/api/movies?page=1&limit=100`);
        const json = await response.json();

        if (json.status === "success" && json.data && json.data.length > 0) {
            allMovies = json.data;
            renderHeroBillboard(allMovies[0]);
            renderCategoryRows(allMovies);
            refreshFocusableElements();
        } else {
            console.error("API returned empty data:", json);
        }
    } catch (err) {
        console.error("Error fetching catalog from Cloudflare D1:", err);
    }
}

/* ==========================================================================
   3. Render UI Components (Hero & Horizontal Rows)
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

    // Bind Watch Now button to video player
    document.getElementById("heroPlayBtn").onclick = () => openPlayerModal(movie);
    document.getElementById("heroInfoBtn").onclick = () => openDetailModal(movie);
}

function renderCategoryRows(movies) {
    // Categorize movies
    const trending = movies.slice(0, 15);
    const action = movies.filter(m => (m.genres || '').toLowerCase().includes('action')).slice(0, 15);
    const topRated = [...movies].sort((a, b) => parseFloat(b.rating || 0) - parseFloat(a.rating || 0)).slice(0, 15);
    const animation = movies.filter(m => (m.genres || '').toLowerCase().includes('animation') || (m.genres || '').toLowerCase().includes('fantasy')).slice(0, 15);

    populateRow("rowTrending", trending.length ? trending : movies.slice(0, 10));
    populateRow("rowAction", action.length ? action : movies.slice(10, 20));
    populateRow("rowTopRated", topRated);
    populateRow("rowAnimation", animation.length ? animation : movies.slice(20, 30));
    populateRow("rowAll", movies);
}

function populateRow(rowId, movieGroup) {
    const rowEl = document.getElementById(rowId);
    if (!rowEl) return;
    rowEl.innerHTML = "";

    movieGroup.forEach(movie => {
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

        rowEl.appendChild(card);
    });
}

/* ==========================================================================
   4. Search Functionality
   ========================================================================== */
async function performSearch(query) {
    if (!query || query.trim() === "") {
        document.getElementById("searchResultsSection").classList.add("hidden");
        document.getElementById("catalogRowsContainer").classList.remove("hidden");
        refreshFocusableElements();
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();

        const searchSection = document.getElementById("searchResultsSection");
        const searchGrid = document.getElementById("searchResultsGrid");
        document.getElementById("searchKeywordText").innerText = query;

        searchGrid.innerHTML = "";
        document.getElementById("catalogRowsContainer").classList.add("hidden");
        searchSection.classList.remove("hidden");

        if (json.status === "success" && json.data && json.data.length > 0) {
            json.data.forEach(movie => {
                const card = document.createElement("div");
                card.className = "movie-card";
                card.setAttribute("tabindex", "0");
                card.innerHTML = `
                    <img class="movie-poster" src="${movie.poster_image || ''}" alt="${movie.title}">
                    <div class="movie-card-overlay">
                        <div class="card-title">${movie.title}</div>
                        <div class="card-meta">
                            <span class="card-rating"><i class="fa-solid fa-star"></i> ${movie.rating || 'N/A'}</span>
                            <span class="card-quality">${movie.quality || 'HD'}</span>
                        </div>
                    </div>
                `;
                card.onclick = () => openDetailModal(movie);
                searchGrid.appendChild(card);
            });
        } else {
            searchGrid.innerHTML = `<p style="color:#A3A3A3; padding: 20px;">No movies found matching "${query}".</p>`;
        }
        refreshFocusableElements();
    } catch (err) {
        console.error("Search error:", err);
    }
}

/* ==========================================================================
   5. Modals (Video Player & Details)
   ========================================================================== */
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
   6. Android TV D-Pad Remote Controller Navigation Logic
   ========================================================================== */
function refreshFocusableElements() {
    // Collect all focusable elements currently visible in DOM
    focusableElements = Array.from(document.querySelectorAll('button:not(.hidden), [tabindex="0"]:not(.hidden), input:not(.hidden), .movie-card:not(.hidden)'))
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
            // Distance formula to find nearest spatial neighbor
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

/* Setup Keyboard & Hardware D-Pad Remote Events */
function setupEventListeners() {
    // Keyboard Event Listener for Android TV Remote Keys
    document.addEventListener("keydown", (e) => {
        const key = e.key;

        // D-Pad Arrow Keys
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
        } 
        // Back Button (Esc or Backspace or TV Remote Back)
        else if (key === "Escape" || e.keyCode === 27 || key === "Backspace" || e.keyCode === 10009) {
            if (!document.getElementById("playerModal").classList.contains("hidden")) {
                closePlayerModal();
            } else if (!document.getElementById("detailModal").classList.contains("hidden")) {
                closeDetailModal();
            }
        }
    });

    // Close Modal Event Bindings
    document.getElementById("closePlayerBtn").onclick = closePlayerModal;
    document.getElementById("closeDetailBtn").onclick = closeDetailModal;

    // Search input listener
    let searchTimeout;
    const searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => performSearch(e.target.value), 400);
    });

    // Navbar Scrolling Glass Effect
    window.addEventListener("scroll", () => {
        const nav = document.getElementById("navbar");
        if (window.scrollY > 50) {
            nav.classList.add("scrolled");
        } else {
            nav.classList.remove("scrolled");
        }
    });
}

/* Virtual On-Screen D-Pad Remote Controller (For Laptop Testing) */
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
