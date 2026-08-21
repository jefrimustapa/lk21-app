/**
 * LK-flix Dedicated Movie Detail View (detail.js)
 * Standalone movie details, cast metadata & related recommendations
 */

const API_BASE = "https://lk21-api.lkapp.workers.dev";
let currentMovie = null;

function initDetailFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const movieUrl = params.get("url") || "";
    const rawTitle = params.get("title") || "Movie Details";
    const poster = params.get("poster") || "";
    const rawYear = params.get("year") || "";
    const rating = params.get("rating") || "";
    const quality = params.get("quality") || "HD";

    let cleanTitle = rawTitle.replace(/\s*(?:\(?\b(19\d\d|20\d\d)\b\)?)\s*$/, '').trim();
    let extractedYear = rawYear;
    if (!extractedYear) {
        const yrMatch = rawTitle.match(/\b(19\d\d|20\d\d)\b/);
        if (yrMatch) extractedYear = yrMatch[1];
    }

    currentMovie = {
        url: movieUrl,
        title: cleanTitle,
        rawTitle: rawTitle,
        poster: poster,
        year: extractedYear,
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
    if (ratingEl && movie.rating && movie.rating !== "-" && movie.rating !== "N/A") {
        ratingEl.innerHTML = `<i class="fa-solid fa-star"></i> ${movie.rating}`;
        ratingEl.style.display = "inline-flex";
    }
    if (qualityEl && movie.quality) {
        qualityEl.textContent = movie.quality;
        qualityEl.style.display = "inline-flex";
    }
    if (yearEl && movie.year) {
        yearEl.textContent = movie.year;
        yearEl.style.display = "inline-flex";
    }
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
    if (meta.title) {
        const cleanT = meta.title.replace(/\s*(?:\(?\b(19\d\d|20\d\d)\b\)?)\s*$/, '').trim();
        const titleEl = document.getElementById("detailTitle");
        if (titleEl) titleEl.textContent = cleanT;
        document.title = `${cleanT} - LK-flix`;
        
        if (!currentMovie.year) {
            const yrMatch = meta.title.match(/\b(19\d\d|20\d\d)\b/);
            if (yrMatch) {
                currentMovie.year = yrMatch[1];
                const yearEl = document.getElementById("detailYear");
                if (yearEl) {
                    yearEl.textContent = currentMovie.year;
                    yearEl.style.display = "inline-flex";
                }
            }
        }
    }

    if (meta.rating && meta.rating !== "-" && meta.rating !== "N/A") {
        const ratingEl = document.getElementById("detailRating");
        if (ratingEl) {
            ratingEl.innerHTML = `<i class="fa-solid fa-star"></i> ${meta.rating}`;
            ratingEl.style.display = "inline-flex";
        }
    }

    if (meta.quality) {
        const qualityEl = document.getElementById("detailQuality");
        if (qualityEl) {
            qualityEl.textContent = meta.quality;
            qualityEl.style.display = "inline-flex";
        }
    }

    if (meta.synopsis) {
        const overviewEl = document.getElementById("detailOverview");
        if (overviewEl) overviewEl.textContent = meta.synopsis;
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
            genresEl.innerHTML = genreList.map(g => {
                const cleanG = g.trim();
                return `<button class="detail-genre-pill" tabindex="0" data-genre="${cleanG}">${cleanG}</button>`;
            }).join("");

            genresEl.querySelectorAll(".detail-genre-pill").forEach(pill => {
                pill.addEventListener("click", () => {
                    const g = pill.getAttribute("data-genre");
                    window.location.href = `index.html?genre=${encodeURIComponent(g)}`;
                });
                pill.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66) {
                        e.preventDefault();
                        const g = pill.getAttribute("data-genre");
                        window.location.href = `index.html?genre=${encodeURIComponent(g)}`;
                    }
                });
            });
        }
    }

    if (meta.related && Array.isArray(meta.related) && meta.related.length > 0) {
        renderRelatedMovies(meta.related);
    } else {
        // Fallback: fetch recommendations for the section
        fetchRecommendedMovies();
    }
}

async function fetchRecommendedMovies() {
    try {
        const res = await fetch(`${API_BASE}/api/movies?page=1&limit=15`);
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

    const currentSlug = (currentMovie.url || "").replace(/^https?:\/\/[^\/]+\//, "").replace(/\/$/, "").toLowerCase();
    const currentTitleClean = (currentMovie.title || "").toLowerCase().replace(/\s*(?:\(?\b(19\d\d|20\d\d)\b\)?)\s*$/, '').trim();

    // Filter out the main movie so suggestions are distinct
    const filteredMovies = movies.filter(m => {
        if (!m) return false;
        const mSlug = (m.url || "").replace(/^https?:\/\/[^\/]+\//, "").replace(/\/$/, "").toLowerCase();
        const mTitleClean = (m.title || "").toLowerCase().replace(/\s*(?:\(?\b(19\d\d|20\d\d)\b\)?)\s*$/, '').trim();
        if (mSlug && currentSlug && mSlug === currentSlug) return false;
        if (mTitleClean && currentTitleClean && mTitleClean === currentTitleClean) return false;
        if (m.url && currentMovie.url && m.url === currentMovie.url) return false;
        return true;
    });

    if (filteredMovies.length === 0) {
        scrollEl.innerHTML = `<p style="color:#737373; font-size:0.9rem; padding:10px 0;">No related titles available.</p>`;
        return;
    }

    scrollEl.innerHTML = filteredMovies.map(m => {
        let displayTitle = m.title || "Untitled";
        displayTitle = displayTitle.replace(/\s*(?:-|\b)\s*(\d{4})\s*$/, ' ($1)');
        return `
        <div class="movie-card related-card" tabindex="0" data-url="${m.url}" data-title="${m.title}" data-poster="${m.poster_image || m.poster || ''}">
            <div class="poster-container">
                <img src="${m.poster_image || m.poster || ''}" alt="${m.title}" loading="lazy">
                <span class="badge rating-badge"><i class="fa-solid fa-star"></i> ${m.rating || '8.0'}</span>
            </div>
            <div class="movie-info">
                <h4 class="movie-title">${displayTitle}</h4>
            </div>
        </div>
        `;
    }).join("");

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
        const genrePills = Array.from(document.querySelectorAll(".detail-genre-pill"));

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
            } else if (active === playBtn) {
                if (genrePills.length > 0) genrePills[0].focus();
                else if (backBtn) backBtn.focus();
            } else if (active && active.classList.contains("detail-genre-pill")) {
                if (backBtn) backBtn.focus();
            } else if (active === posterEl) {
                if (backBtn) backBtn.focus();
            } else if (backBtn) {
                backBtn.focus();
            }
            return;
        }

        if (keyCode === 20) { // DPAD_DOWN
            if (active === backBtn) {
                if (genrePills.length > 0) genrePills[0].focus();
                else if (playBtn) playBtn.focus();
            } else if (active && active.classList.contains("detail-genre-pill")) {
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
            if (active && active.classList.contains("detail-genre-pill")) {
                const prevPill = active.previousElementSibling;
                if (prevPill && prevPill.classList.contains("detail-genre-pill")) {
                    prevPill.focus();
                } else if (posterEl) {
                    posterEl.focus();
                }
            } else if (active && active.classList.contains("related-card")) {
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
            if (active && active.classList.contains("detail-genre-pill")) {
                const nextPill = active.nextElementSibling;
                if (nextPill && nextPill.classList.contains("detail-genre-pill")) {
                    nextPill.focus();
                } else if (playBtn) {
                    playBtn.focus();
                }
            } else if (active && active.classList.contains("related-card")) {
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
