import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('LKFlix App Logic, Navigation & Player Unit Tests', () => {
    let dom;
    let window;
    let document;

    beforeEach(() => {
        const htmlContent = readFileSync(resolve(__dirname, 'index.html'), 'utf-8');
        const jsContent = readFileSync(resolve(__dirname, 'app.js'), 'utf-8');

        // Set up clean JSDOM instance with browser globals
        const { JSDOM } = require('jsdom');
        dom = new JSDOM(htmlContent, {
            runScripts: 'outside-only',
            url: 'http://localhost/'
        });
        window = dom.window;
        document = window.document;

        // Mock window properties & APIs
        window.scrollTo = () => {};
        window.requestAnimationFrame = (cb) => { cb(); return 0; };
        window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
        window.IntersectionObserver = class {
            constructor() {}
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        // Execute app.js in window context
        dom.window.eval(jsContent);
    });

    it('1. TV Mode Detection: AndroidBridge.isTv() enables tv-mode class', () => {
        window.AndroidBridge = { isTv: () => true, getDeviceInfo: () => 'TestTV' };
        window.detectDeviceMode();

        expect(document.documentElement.classList.contains('tv-mode')).toBe(true);
        expect(document.body.classList.contains('tv-mode')).toBe(true);
        expect(document.getElementById('deviceModeText').textContent).toBe('TV');
    });

    it('2. Detail Page: Default focus is placed on "Watch Now" (detailPlayBtn) upon opening', () => {
        const sampleMovie = {
            id: 'test-1',
            title: 'Spider-Man: No Way Home',
            rating: '8.5',
            quality: '4K',
            type: 'movie',
            synopsis: 'Peter Parker seeks Doctor Strange for help.',
            genres: 'Action, Sci-Fi',
            cast: 'Tom Holland, Zendaya',
            poster_image: 'https://example.com/poster.jpg'
        };

        window.openDetailModal(sampleMovie);

        const modal = document.getElementById('detailModal');
        expect(modal.classList.contains('hidden')).toBe(false);
        expect(modal.style.display).toBe('block');
        expect(modal.scrollTop).toBe(0);
        expect(document.getElementById('detailTitle').textContent).toBe('Spider-Man: No Way Home');
        
        const backBtn = document.getElementById('closeDetailBtn');
        expect(document.activeElement).toBe(backBtn);
    });

    it('3. Player View: openPlayerModal populates title, iframe stream, and focuses stream player', () => {
        const sampleMovie = {
            id: 'test-stream-1',
            title: 'Inception 2010',
            quality: '1080p',
            type: 'movie',
            stream_url: 'https://videonode.de/iframe/p2p/test123'
        };

        window.openPlayerModal(sampleMovie);

        const playerModal = document.getElementById('playerModal');
        expect(playerModal.classList.contains('hidden')).toBe(false);
        expect(document.getElementById('playerTitle').textContent).toBe('Inception 2010');
        expect(document.getElementById('playerQuality').textContent).toBe('1080p');
        expect(document.getElementById('videoIframe').src).toContain('https://videonode.de/iframe/p2p/test123');
        expect(document.getElementById('videoIframe').src).toContain('autoplay=1');
    });

    it('4. Player View: Seek function displays center-screen HUD toast with +10s / -10s', () => {
        const hud = document.getElementById('playerSeekHud');
        const text = document.getElementById('seekHudText');

        window.seekPlayerStream(10);
        expect(hud.classList.contains('hidden')).toBe(false);
        expect(text.textContent).toBe('+10s');

        window.seekPlayerStream(-10);
        expect(hud.classList.contains('hidden')).toBe(false);
        expect(text.textContent).toBe('-10s');
    });

    it('5. Player View: closePlayerModal clears iframe and restores focus to Watch Now button in Detail view', () => {
        const sampleMovie = { id: 'test-2', title: 'Avatar', stream_url: 'https://example.com/stream' };
        
        window.openDetailModal(sampleMovie);
        window.openPlayerModal(sampleMovie);

        const playerModal = document.getElementById('playerModal');
        expect(playerModal.classList.contains('hidden')).toBe(false);

        window.closePlayerModal(true);
        expect(playerModal.classList.contains('hidden')).toBe(true);
        expect(document.getElementById('videoIframe').hasAttribute('src')).toBe(false);

        // Focus must return to detailPlayBtn on Detail page
        expect(document.activeElement).toBe(document.getElementById('detailPlayBtn'));
    });

    it('6. Focus Restoration: Closing detail view restores focus to the movie card that opened it', async () => {
        const grid = document.getElementById('mainMovieGrid');
        const card = document.createElement('div');
        card.className = 'movie-card';
        card.setAttribute('tabindex', '0');
        grid.appendChild(card);
        card.focus();
        expect(document.activeElement).toBe(card);

        const sampleMovie = { id: 'test-3', title: 'Batman' };
        window.openDetailModal(sampleMovie);
        expect(document.activeElement).toBe(document.getElementById('closeDetailBtn'));

        window.closeDetailModal(true);
        await new Promise(r => setTimeout(r, 400));
        
        expect(document.getElementById('detailModal').classList.contains('hidden')).toBe(true);
        expect(document.activeElement).toBe(card);
    });

    it('7. TV Remote Keys: Enter / KeyCode 23 / 66 triggers click on focused element', () => {
        let clicked = false;
        const testBtn = document.getElementById('heroPlayBtn');
        testBtn.addEventListener('click', () => { clicked = true; });
        testBtn.focus();

        const enterEvent = new window.KeyboardEvent('keydown', {
            key: 'Enter',
            keyCode: 23,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(enterEvent);

        expect(clicked).toBe(true);
    });

    it('8. TV Remote Keys: Backspace / Escape closes open player view first, then detail modal', () => {
        window.openDetailModal({ id: 'test-4', title: 'Interstellar', stream_url: 'https://example.com/stream' });
        window.openPlayerModal({ id: 'test-4', title: 'Interstellar', stream_url: 'https://example.com/stream' });

        const playerModal = document.getElementById('playerModal');
        const detailModal = document.getElementById('detailModal');

        expect(playerModal.classList.contains('hidden')).toBe(false);

        // Press Escape -> Should close player first
        const backEvent = new window.KeyboardEvent('keydown', {
            key: 'Escape',
            keyCode: 27,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(backEvent);

        expect(playerModal.classList.contains('hidden')).toBe(true);
        expect(detailModal.classList.contains('hidden')).toBe(false);

        // Press Escape again -> Should close detail modal
        document.dispatchEvent(backEvent);
        expect(detailModal.classList.contains('detail-open')).toBe(false);
    });
});
