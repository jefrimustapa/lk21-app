/**
 * LK-flix Dedicated Movie Detail View (detail.js)
 * Standalone movie details, cast metadata & related recommendations
 */

const API_BASE = "https://lk21-app.mustapajefri.workers.dev";
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

    try {
        let meta = null;
        if (typeof window.AndroidBridge !== "undefined" && typeof window.AndroidBridge.fetchMovieDetails === "function") {
            const rawJson = window.AndroidBridge.fetchMovieDetails(movieUrl);
            if (rawJson) meta = JSON.parse(rawJson);
        }

        if (!meta) {
            const res = await fetch(`${API_BASE}/api/movie?url=${encodeURIComponent(movieUrl)}`);
            if (res.ok) meta = await res.json();
        }

        if (meta) {
            populateFullMetadata(meta);
        }
    } catch (e) {
        console.warn("Error fetching movie metadata:", e);
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
    if (meta.genres && Array.isArray(meta.genres)) {
        const genresEl = document.getElementById("detailGenres");
        if (genresEl) {
            genresEl.innerHTML = meta.genres.map(g => `<span class="detail-genre-pill">${g}</span>`).join("");
        }
    }

    if (meta.related && Array.isArray(meta.related) && meta.related.length > 0) {
        renderRelatedMovies(meta.related);
    }
}

function renderRelatedMovies(movies) {
    const scrollEl = document.getElementById("detailRelatedScroll");
    if (!scrollEl) return;

    scrollEl.innerHTML = movies.map(m => `
        <div class="movie-card related-card" tabindex="0" data-url="${m.url}" data-title="${m.title}" data-poster="${m.poster || ''}">
            <div class="poster-container">
                <img src="${m.poster || ''}" alt="${m.title}" loading="lazy">
                <span class="badge rating-badge"><i class="fa-solid fa-star"></i> ${m.rating || 'HD'}</span>
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
            window.location.href = `detail.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&poster=${encodeURIComponent(poster)}`;
        });
    });
}

function setupDetailListeners() {
    const backBtn = document.getElementById("closeDetailBtn");
    const playBtn = document.getElementById("detailPlayBtn");

    if (backBtn) {
        backBtn.addEventListener("click", () => {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = "index.html";
            }
        });
    }

    if (playBtn) {
        playBtn.addEventListener("click", () => {
            if (currentMovie && currentMovie.url) {
                window.location.href = `player.html?url=${encodeURIComponent(currentMovie.url)}&title=${encodeURIComponent(currentMovie.title)}&quality=${encodeURIComponent(currentMovie.quality || "HD")}`;
            }
        });
        // Auto focus Watch Now button on TV
        const isTv = document.documentElement.classList.contains("tv-mode");
        if (isTv) {
            setTimeout(() => playBtn.focus(), 150);
        }
    }

    // Remote D-Pad Navigation
    window.handleNativeDpad = function(keyCode) {
        const active = document.activeElement;
        const playBtn = document.getElementById("detailPlayBtn");
        const backBtn = document.getElementById("closeDetailBtn");

        if (keyCode === 23 || keyCode === 66) { // OK / Enter
            if (active && typeof active.click === "function") active.click();
            return;
        }

        if (keyCode === 19) { // UP
            if (active === playBtn && backBtn) backBtn.focus();
            return;
        }

        if (keyCode === 20) { // DOWN
            if (active === backBtn && playBtn) playBtn.focus();
            else if (active === playBtn) {
                const firstRelated = document.querySelector(".related-card");
                if (firstRelated) firstRelated.focus();
            }
            return;
        }

        if (keyCode === 21) { // LEFT
            if (active && active.classList.contains("related-card")) {
                const prev = active.previousElementSibling;
                if (prev) prev.focus();
            }
            return;
        }

        if (keyCode === 22) { // RIGHT
            if (active && active.classList.contains("related-card")) {
                const next = active.nextElementSibling;
                if (next) next.focus();
            }
            return;
        }
    };

    document.addEventListener("keydown", (e) => {
        const key = e.key;
        const keyCode = e.keyCode;
        if (keyCode === 19 || key === "ArrowUp") window.handleNativeDpad(19);
        else if (keyCode === 20 || key === "ArrowDown") window.handleNativeDpad(20);
        else if (keyCode === 21 || key === "ArrowLeft") window.handleNativeDpad(21);
        else if (keyCode === 22 || key === "ArrowRight") window.handleNativeDpad(22);
        else if (keyCode === 23 || keyCode === 66 || keyCode === 13 || key === "Enter") window.handleNativeDpad(23);
    });
}

document.addEventListener("DOMContentLoaded", initDetailFromUrl);
