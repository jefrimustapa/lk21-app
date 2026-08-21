/**
 * LK-flix Dedicated Movie Detail View (detail.js)
 * Standalone movie details, cast metadata & related recommendations
 */

const API_BASE = "https://lk21-api.lkapp.workers.dev";
let currentMovie = null;

function initDetailFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const movieUrl = params.get("url") || "";
    const title = params.get("title") || "Movie Details";
    const poster = params.get("poster") || "";
    const year = params.get("year") || "";
    const rating = params.get("rating") || "";
    const quality = params.get("quality") || "HD";

    currentMovie = {
        url: movieUrl,
        title: title,
        poster: poster,
        year: year,
        rating: rating,
        quality: quality
    };

    const isTv = document.documentElement.classList.contains("tv-mode") ||
                 (typeof window.AndroidBridge !== "undefined" && window.AndroidBridge.isTv && window.AndroidBridge.isTv());

    if (isTv) {
        document.body.classList.add("tv-mode");
    }

    renderInitialDetail(currentMovie);
    fetchFullMetadata(currentMovie.url);
    setupDetailListeners();
}

function renderInitialDetail(movie) {
    document.title = `${movie.title} - LK-flix`;
    const titleEl = document.getElementById("detailTitle");
    const posterImg = document.getElementById("detailPosterImg");
    const banner = document.getElementById("detailBanner");
    const ratingEl = document.getElementById("detailRating");
    const qualityEl = document.getElementById("detailQuality");
    const yearEl = document.getElementById("detailYear");

    if (titleEl) titleEl.textContent = movie.title;
    if (posterImg && movie.poster) posterImg.src = movie.poster;
    if (banner && movie.poster) banner.style.backgroundImage = `url('${movie.poster}')`;
    if (ratingEl && movie.rating) ratingEl.innerHTML = `<i class="fa-solid fa-star"></i> ${movie.rating}`;
    if (qualityEl && movie.quality) qualityEl.textContent = movie.quality;
    if (yearEl && movie.year) yearEl.textContent = movie.year;
}

async function fetchFullMetadata(movieUrl) {
    if (!movieUrl) return;
    const slug = movieUrl.replace(/^https?:\/\/[^\/]+\//, "").replace(/\/$/, "");

    try {
        const res = await fetch(`${API_BASE}/api/movie/${encodeURIComponent(slug)}`);
        if (res.ok) {
            const json = await res.json();
            if (json && json.status === "success" && json.data) {
                populateFullMetadata(json.data);
                return;
            }
        }
    } catch (e) {
        console.warn("Error fetching movie metadata from API:", e);
    }
}

function populateFullMetadata(meta) {
    if (meta.synopsis) {
        const overviewEl = document.getElementById("detailOverview");
        if (overviewEl) overviewEl.textContent = meta.synopsis;
    }
    if (meta.director) {
        const directorEl = document.getElementById("detailDirector");
        if (directorEl) directorEl.textContent = meta.director;
    }
    if (meta.country) {
        const countryEl = document.getElementById("detailCountry");
        if (countryEl) countryEl.textContent = meta.country;
    }
    if (meta.cast) {
        const castEl = document.getElementById("detailCast");
        if (castEl) castEl.textContent = Array.isArray(meta.cast) ? meta.cast.join(", ") : meta.cast;
    }
    if (meta.duration) {
        const durEl = document.getElementById("detailDuration");
        if (durEl) {
            durEl.textContent = meta.duration;
            durEl.style.display = "inline-block";
        }
    }
    if (meta.genres) {
        const genresEl = document.getElementById("detailGenres");
        if (genresEl) {
            const genreList = Array.isArray(meta.genres) ? meta.genres : String(meta.genres).split(",");
            genresEl.innerHTML = genreList.map(g => `<span class="detail-genre-pill">${g.trim()}</span>`).join("");
        }
    }

    if (meta.related && Array.isArray(meta.related) && meta.related.length > 0) {
        renderRelatedMovies(meta.related);
    } else {
        // Fallback: fetch general recommendations for the section
        fetchRecommendedMovies();
    }
}

async function fetchRecommendedMovies() {
    try {
        const res = await fetch(`${API_BASE}/api/movies?page=1&limit=10`);
        if (res.ok) {
            const json = await res.json();
            if (json && json.data && Array.isArray(json.data)) {
                renderRelatedMovies(json.data);
            }
        }
    } catch (e) {}
}

function renderRelatedMovies(movies) {
    const scrollEl = document.getElementById("detailRelatedScroll");
    if (!scrollEl) return;

    scrollEl.innerHTML = movies.map(m => `
        <div class="movie-card related-card" tabindex="0" data-url="${m.url}" data-title="${m.title}" data-poster="${m.poster_image || m.poster || ''}">
            <div class="poster-container">
                <img src="${m.poster_image || m.poster || ''}" alt="${m.title}" loading="lazy">
                <span class="badge rating-badge"><i class="fa-solid fa-star"></i> ${m.rating || '8.0'}</span>
            </div>
            <div class="movie-info">
                <h4 class="movie-title">${m.title}</h4>
            </div>
        </div>
    `).join("");

    scrollEl.querySelectorAll(".related-card").forEach(card => {
        card.addEventListener("click", () => {
            const url = card.getAttribute("data-url");
            const title = card.getAttribute("data-title");
            const poster = card.getAttribute("data-poster");
            window.location.replace(`detail.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&poster=${encodeURIComponent(poster)}`);
        });
    });
}

function goBack() {
    console.log("[Detail] Navigating directly to home");
    window.location.href = "index.html";
}

window.handleNativeBack = goBack;

function setupDetailListeners() {
    const backBtn = document.getElementById("closeDetailBtn");
    const playBtn = document.getElementById("detailPlayBtn");
    const posterEl = document.getElementById("detailPoster");

    if (backBtn) {
        backBtn.onclick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            goBack();
        };
    }

    if (playBtn) {
        playBtn.onclick = () => {
            if (currentMovie && currentMovie.url) {
                const currentFullUrl = encodeURIComponent(window.location.href);
                window.location.href = `player.html?url=${encodeURIComponent(currentMovie.url)}&title=${encodeURIComponent(currentMovie.title)}&quality=${encodeURIComponent(currentMovie.quality || "HD")}&returnUrl=${currentFullUrl}`;
            }
        };
    }

    if (posterEl) {
        posterEl.onclick = () => {
            if (currentMovie && currentMovie.url) {
                const currentFullUrl = encodeURIComponent(window.location.href);
                window.location.href = `player.html?url=${encodeURIComponent(currentMovie.url)}&title=${encodeURIComponent(currentMovie.title)}&quality=${encodeURIComponent(currentMovie.quality || "HD")}&returnUrl=${currentFullUrl}`;
            }
        };
    }

    // Auto focus Watch Now button on initial load on TV
    const isTv = document.documentElement.classList.contains("tv-mode") ||
                 (typeof window.AndroidBridge !== "undefined" && window.AndroidBridge.isTv && window.AndroidBridge.isTv());
    if (isTv) {
        setTimeout(() => {
            if (playBtn) playBtn.focus();
        }, 150);
    }

    // Remote D-Pad Navigation
    window.handleNativeDpad = function(keyCode) {
        const active = document.activeElement;
        const playBtn = document.getElementById("detailPlayBtn");
        const backBtn = document.getElementById("closeDetailBtn");
        const posterEl = document.getElementById("detailPoster");

        if (keyCode === 4) { // Hardware BACK button
            goBack();
            return;
        }

        if (keyCode === 23 || keyCode === 66 || keyCode === 13) { // OK / Enter
            if (active === backBtn) {
                goBack();
                return;
            }
            if (active && typeof active.click === "function") {
                active.click();
            } else if (playBtn) {
                playBtn.click();
            }
            return;
        }

        if (keyCode === 19) { // DPAD_UP
            if (active && active.classList.contains("related-card")) {
                if (playBtn) playBtn.focus();
            } else if (active === playBtn || active === posterEl) {
                if (backBtn) backBtn.focus();
            } else if (backBtn) {
                backBtn.focus();
            }
            return;
        }

        if (keyCode === 20) { // DPAD_DOWN
            if (active === backBtn) {
                if (playBtn) playBtn.focus();
            } else if (active === playBtn || active === posterEl) {
                const firstRelated = document.querySelector(".related-card");
                if (firstRelated) {
                    firstRelated.focus();
                    firstRelated.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                }
            }
            return;
        }

        if (keyCode === 21) { // DPAD_LEFT
            if (active && active.classList.contains("related-card")) {
                const prev = active.previousElementSibling;
                if (prev && prev.classList.contains("related-card")) {
                    prev.focus();
                    prev.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                }
            } else if (active === playBtn && posterEl) {
                posterEl.focus();
            }
            return;
        }

        if (keyCode === 22) { // DPAD_RIGHT
            if (active && active.classList.contains("related-card")) {
                const next = active.nextElementSibling;
                if (next && next.classList.contains("related-card")) {
                    next.focus();
                    next.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                }
            } else if (active === posterEl && playBtn) {
                playBtn.focus();
            }
            return;
        }
    };

    document.addEventListener("keydown", (e) => {
        if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.isTv === "function" && window.AndroidBridge.isTv()) {
            return;
        }
        const key = e.key;
        const keyCode = e.keyCode;
        if (keyCode === 4 || key === "Escape" || key === "Backspace") window.handleNativeDpad(4);
        else if (keyCode === 19 || key === "ArrowUp") window.handleNativeDpad(19);
        else if (keyCode === 20 || key === "ArrowDown") window.handleNativeDpad(20);
        else if (keyCode === 21 || key === "ArrowLeft") window.handleNativeDpad(21);
        else if (keyCode === 22 || key === "ArrowRight") window.handleNativeDpad(22);
        else if (keyCode === 23 || keyCode === 66 || keyCode === 13 || key === "Enter") window.handleNativeDpad(23);
    });
}

document.addEventListener("DOMContentLoaded", initDetailFromUrl);
