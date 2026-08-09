import os
import json
import sqlite3
from flask import Flask, jsonify, request
from scripts.extract_lk21_links_mv import scrape_lk21

app = Flask(__name__)

DB_PATH = "/tmp/lk21_mv_live.db" if os.name != 'nt' else "lk21_mv_live.db"

# Global state for caching and remote progress tracking
latest_scraped_data = []
scrape_progress = {
    "status": "idle",
    "phase": None,
    "current": 0,
    "total": 0,
    "percentage": 0.0,
    "last_item": None,
    "message": "Scraper is idle."
}

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def update_progress(phase, current, total, percentage, message, current_item=None):
    global scrape_progress
    scrape_progress.update({
        "status": "running",
        "phase": phase,
        "current": current,
        "total": total,
        "percentage": percentage,
        "last_item": current_item,
        "message": message
    })

@app.route("/", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ok",
        "service": "LK21 Scraper SQLite API",
        "endpoints": {
            "GET /api/movies?page=1&limit=20": "Paginated list of movies from SQLite",
            "GET /api/search?q=spider": "Fast title search in SQLite",
            "GET /api/movie/<slug>": "Get single movie by slug",
            "GET /json": "View full JSON dataset",
            "GET /progress": "Check live percentage progress of active scrape",
            "GET /scrape": "Trigger scraper (e.g. /scrape?max_pages=2)"
        }
    }), 200

@app.route("/api/movies", methods=["GET"])
def get_movies_db():
    page = request.args.get("page", default=1, type=int)
    limit = request.args.get("limit", default=20, type=int)
    offset = (page - 1) * limit

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM movies")
        total_count = cursor.fetchone()[0]

        cursor.execute("SELECT * FROM movies ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset))
        rows = cursor.fetchall()
        conn.close()

        movies = []
        for r in rows:
            m = dict(r)
            m['genres'] = m['genres'].split(',') if m.get('genres') else []
            m['cast'] = m['cast'].split(',') if m.get('cast') else []
            movies.append(m)

        return jsonify({
            "status": "success",
            "page": page,
            "limit": limit,
            "total": total_count,
            "data": movies
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/search", methods=["GET"])
def search_movies_db():
    q = request.args.get("q", default="", type=str)
    if not q:
        return jsonify({"status": "error", "message": "Query parameter 'q' is required"}), 400

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM movies WHERE title LIKE ? OR synopsis LIKE ? ORDER BY id DESC LIMIT 50", (f"%{q}%", f"%{q}%"))
        rows = cursor.fetchall()
        conn.close()

        movies = []
        for r in rows:
            m = dict(r)
            m['genres'] = m['genres'].split(',') if m.get('genres') else []
            m['cast'] = m['cast'].split(',') if m.get('cast') else []
            movies.append(m)

        return jsonify({
            "status": "success",
            "query": q,
            "count": len(movies),
            "data": movies
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/movie/<slug>", methods=["GET"])
def get_movie_by_slug(slug):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM movies WHERE slug = ?", (slug,))
        row = cursor.fetchone()
        conn.close()

        if not row:
            return jsonify({"status": "error", "message": "Movie not found"}), 404

        m = dict(row)
        m['genres'] = m['genres'].split(',') if m.get('genres') else []
        m['cast'] = m['cast'].split(',') if m.get('cast') else []
        return jsonify({"status": "success", "data": m}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/progress", methods=["GET"])
def get_progress():
    return jsonify(scrape_progress), 200

@app.route("/json", methods=["GET"])
def get_json():
    global latest_scraped_data
    if not latest_scraped_data and os.path.exists("/tmp/lk21_links_mv_live.json"):
        try:
            with open("/tmp/lk21_links_mv_live.json", "r", encoding="utf-8") as f:
                latest_scraped_data = json.load(f)
        except Exception:
            pass

    return jsonify(latest_scraped_data), 200

import threading

@app.route("/scrape", methods=["GET", "POST"])
def trigger_scrape():
    global scrape_progress
    if scrape_progress.get("status") == "running":
        return jsonify({
            "status": "already_running",
            "message": "A scrape job is already active in the background.",
            "progress_url": request.host_url + "progress"
        }), 409

    max_pages = request.args.get("max_pages", default=0, type=int)
    url = request.args.get("url", default="https://tv12.lk21official.cc/top-movie-today", type=str)
    
    def background_worker():
        global latest_scraped_data, scrape_progress
        update_progress("starting", 0, max_pages, 0.0, f"Starting background scrape for {max_pages} pages...")
        results = scrape_lk21(
            start_url=url,
            max_pages=max_pages,
            extract_streams=True,
            output_file=DB_PATH,
            progress_callback=update_progress
        )
        latest_scraped_data = results
        scrape_progress.update({
            "status": "completed",
            "phase": "finished",
            "current": len(results),
            "total": len(results),
            "percentage": 100.0,
            "message": f"Successfully scraped {len(results)} items."
        })

    # Spawn worker thread in background
    thread = threading.Thread(target=background_worker, daemon=True)
    thread.start()

    return jsonify({
        "status": "started",
        "message": f"Background scrape launched for max_pages={max_pages}.",
        "progress_url": request.host_url + "progress",
        "movies_api": request.host_url + "api/movies"
    }), 202

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
