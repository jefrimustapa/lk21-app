import argparse
import json
import os
import re
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin, urlparse
try:
    from playwright.sync_api import sync_playwright
    USE_PLAYWRIGHT = True
except ImportError:
    USE_PLAYWRIGHT = False

try:
    from curl_cffi import requests
    USE_CURL_CFFI = True
except ImportError:
    import requests
    USE_CURL_CFFI = False
from bs4 import BeautifulSoup

EXCLUDED_PATHS = {
    '', '/', '/#', '/populer', '/rating', '/release', '/latest', '/nontondrama',
    '/latest-series', '/top-series-today', '/top-movie-today',
    '/dmca', '/faq', '/privacy-policy', '/cara-install-vpn', '/rekomendasi-film-pintar',
    '/most-commented'
}

EXCLUDED_PREFIXES = ('/genre/', '/country/', '/year/', '/director/', '/artist/', '/translator/', '/quality/')

DEFAULT_BASE_URLS = [
    "https://tv12.lk21official.cc/top-movie-today",
    "https://tv12.lk21official.cc/genre/action",
    "https://tv12.lk21official.cc/genre/horror",
    "https://tv12.lk21official.cc/genre/comedy",
    "https://tv12.lk21official.cc/genre/sci-fi",
    "https://tv12.lk21official.cc/genre/romance",
    "https://tv12.lk21official.cc/genre/animation",
    "https://tv12.lk21official.cc/country/china",
    "https://tv12.lk21official.cc/country/japan",
    "https://tv12.lk21official.cc/country/south-korea",
    "https://tv12.lk21official.cc/country/thailand",
    "https://tv12.lk21official.cc/country/india",
    "https://tv12.lk21official.cc/country/hong-kong",
    "https://tv12.lk21official.cc/country/malaysia",
    "https://tv12.lk21official.cc/country/russia",
    "https://tv12.lk21official.cc/country/philippines",
    "https://tv12.lk21official.cc/country/usa"
]

def classify_card(a_tag, card_element=None, card_text="", base_url="https://tv12.lk21official.cc"):
    href = a_tag.get('href', '')
    if not href or href == '#' or href.startswith('javascript:'):
        return None

    full_url = urljoin(base_url, href)
    parsed = urlparse(full_url)
    path = parsed.path.rstrip('/')

    # Exclude navigation / category / pagination / external links
    if path in EXCLUDED_PATHS or path.startswith(EXCLUDED_PREFIXES) or re.search(r'/page/\d+/?$', path):
        return None
    if parsed.netloc and 'lk21' not in parsed.netloc and 'layarkaca21' not in parsed.netloc:
        return None

    title = a_tag.get('title') or ""
    if title:
        title = re.sub(r'^Nonton (movie|series)\s+', '', title, flags=re.I)
        title = re.sub(r'\s+streaming gratis$', '', title, flags=re.I).strip()
    else:
        title = path.strip('/').replace('-', ' ').title()

    if not title or title.upper() in ('HOME', 'LAINNYA →', 'POPULER', 'LATEST'):
        return None

    # Precise classification logic
    combined_text = (card_text + " " + title).lower()
    if 'nonton series' in a_tag.get('title', '').lower() or re.search(r'eps\d+|s\.\d+|eps', combined_text):
        item_type = 'series'
    elif 'nonton movie' in a_tag.get('title', '').lower() or re.search(r'\b(hd|cam|sd|bluray|web-dl|ts)\b|\d{2}:\d{2}', combined_text):
        item_type = 'movie'
    elif re.search(r'-\d{4}$', path):
        item_type = 'movie'
    else:
        item_type = 'unknown'

    # Extract quality badge directly from poster card span (e.g. <div class="poster"><span class="label label-CAM">CAM</span></div>)
    quality = None
    genres = []
    if card_element:
        # Find poster container inside card if available
        poster_div = card_element.find('div', class_='poster')
        search_target = poster_div if poster_div else card_element
        label_span = search_target.find('span', class_=lambda c: c and 'label' in c and 'rating' not in c and 'mood' not in c)
        if label_span:
            quality = label_span.get_text().strip().upper()

        # Extract genre list from <div class="genre"> inside card / figcaption
        genre_div = card_element.find('div', class_='genre')
        if genre_div:
            raw_genres = genre_div.get_text().strip()
            genres = [g.strip() for g in raw_genres.split(',') if g.strip()]

        # Extract rating score (e.g., from span.rating-number or span.rating)
        rating_val = None
        rating_el = card_element.find(class_='rating-number') or card_element.find('span', class_='rating')
        if rating_el:
            raw_r = rating_el.get('data-base-rating') or rating_el.get_text()
            r_match = re.search(r'\d+(\.\d+)?', raw_r)
            rating_val = r_match.group(0) if r_match else None

        # Extract poster picture image link from <picture> or <img> element
        poster_img = None
        picture_tag = card_element.find('picture')
        if picture_tag:
            img_tag = picture_tag.find('img')
            if img_tag:
                poster_img = img_tag.get('src') or img_tag.get('data-src')
            if not poster_img:
                source_tag = picture_tag.find('source')
                if source_tag:
                    poster_img = source_tag.get('srcset') or source_tag.get('data-srcset')
        if not poster_img:
            img_tag = card_element.find('img')
            if img_tag:
                poster_img = img_tag.get('src') or img_tag.get('data-src') or img_tag.get('data-original')

    if not quality:
        quality = "SERIES" if item_type == 'series' else "HD"

    return {
        'title': title,
        'url': full_url,
        'rating': rating_val,
        'poster_image': poster_img,
        'type': item_type,
        'quality': quality,
        'genres': genres,
        'slug': path.strip('/')
    }

def fetch_playcdn_stream(iframe_url, headers):
    if not iframe_url or 'videonode.de/iframe/' not in iframe_url:
        return iframe_url

    # Extract video ID from videonode iframe URL
    video_id = iframe_url.split('/iframe/p2p/')[-1].split('/')[0]
    api_url = f"https://playcdn.de/api2.php?id={video_id}"
    api_headers = {
        'User-Agent': headers.get('User-Agent', 'Mozilla/5.0'),
        'Referer': f'https://playcdn.de/video.php?id={video_id}',
        'Origin': 'https://playcdn.de'
    }
    payload = {
        'r': 'https://tv12.lk21official.cc/',
        'd': 'playcdn.de'
    }

    try:
        r = requests.post(api_url, data=payload, headers=api_headers, timeout=10)
        if r.status_code == 200:
            data = r.json()
            m3u8_path = data.get('file')
            if m3u8_path:
                master_url = m3u8_path if m3u8_path.startswith('http') else f"https://playcdn.de{m3u8_path}"
                
                # Fetch master playlist to parse higher resolutions (720p, 1080p, etc.)
                try:
                    playlist_r = requests.get(master_url, headers=api_headers, timeout=10)
                    if playlist_r.status_code == 200 and '#EXTM3U' in playlist_r.text:
                        lines = playlist_r.text.splitlines()
                        qualities = {}
                        current_res = None
                        for line in lines:
                            if 'RESOLUTION=' in line:
                                res_match = re.search(r'RESOLUTION=(\d+x\d+)', line)
                                if res_match:
                                    current_res = res_match.group(1)
                            elif line.strip().endswith('.m3u8') and current_res:
                                sub_path = line.strip()
                                sub_url = sub_path if sub_path.startswith('http') else f"https://playcdn.de{sub_path}"
                                qualities[current_res] = sub_url
                                current_res = None

                        if qualities:
                            # Pick highest resolution available (e.g. 1920x1080 -> 1280x720 -> 854x480)
                            sorted_res = sorted(qualities.keys(), key=lambda x: int(x.split('x')[0]), reverse=True)
                            return qualities[sorted_res[0]]
                except Exception as pl_err:
                    pass

                return master_url
    except Exception as e:
        pass

    return iframe_url

def resolve_stream_urls(item, headers):
    target_url = item['url']
    req_kwargs = {"headers": headers, "timeout": 15}
    if USE_CURL_CFFI:
        req_kwargs["impersonate"] = "chrome120"

    try:
        resp = requests.get(target_url, **req_kwargs)
        if resp.status_code != 200:
            return item

        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Check for instant redirect link (e.g. openNow button)
        open_now = soup.find('a', id='openNow')
        if open_now and open_now.get('href'):
            target_url = open_now['href']
            resp = requests.get(target_url, **req_kwargs)
            soup = BeautifulSoup(resp.text, 'html.parser')

        # If it's a series, check for episode data
        season_data_el = soup.find(id='season-data')
        if season_data_el and season_data_el.string:
            try:
                episodes_dict = json.loads(season_data_el.string)
                item['episodes'] = []
                for season_num, ep_list in episodes_dict.items():
                    for ep in ep_list:
                        ep_slug = ep.get('slug')
                        if ep_slug:
                            ep_url = f"https://dramamu.lk21.de/{ep_slug}"
                            ep_resp = requests.get(ep_url, headers=headers, timeout=10)
                            ep_soup = BeautifulSoup(ep_resp.text, 'html.parser')
                            ep_iframes = [ifr['src'] for ifr in ep_soup.find_all('iframe') if ifr.get('src') and not 'youtube' in ifr.get('src')]
                            raw_iframe = ep_iframes[0] if ep_iframes else None
                            direct_stream = fetch_playcdn_stream(raw_iframe, headers) if raw_iframe else None
                            item['episodes'].append({
                                'season': season_num,
                                'episode': ep.get('episode_no'),
                                'title': ep.get('title'),
                                'iframe_url': raw_iframe,
                                'stream_url': direct_stream
                            })
                            time.sleep(0.3)
            except Exception as ep_err:
                print(f"Error parsing episodes for {item['title']}: {ep_err}")

        # Extract poster image from detail page ONLY if missing
        if not item.get('poster_image'):
            detail_poster = None
            detail_pic = soup.find('picture') or soup.find(class_='poster')
            if detail_pic:
                img = detail_pic.find('img')
                if img:
                    detail_poster = img.get('src') or img.get('data-src') or img.get('data-original')
                if not detail_poster:
                    src = detail_pic.find('source')
                    if src:
                        detail_poster = src.get('srcset') or src.get('data-srcset')
            if not detail_poster:
                img = soup.find('img', src=re.compile(r'cover\.|wp-content/uploads', re.I))
                if img:
                    detail_poster = img.get('src') or img.get('data-src')

            if detail_poster:
                item['poster_image'] = detail_poster

        # Extract synopsis text
        synopsis_el = soup.find(class_=lambda c: c and 'synopsis' in c)
        if synopsis_el:
            syn_text = synopsis_el.get('data-full') or synopsis_el.get_text()
            item['synopsis'] = syn_text.strip() if syn_text else None
        else:
            item['synopsis'] = None

        # Extract actors/cast list from <a href="/artist/...">
        artist_tags = soup.find_all('a', href=lambda h: h and '/artist/' in h)
        item['cast'] = [a.get_text().strip() for a in artist_tags if a.get_text().strip()]

        # Extract quality badge from movie detail header container (.info-tag)
        info_tag = soup.find(class_='info-tag')
        quality_found = None
        if info_tag:
            for span in info_tag.find_all('span'):
                txt = span.get_text().strip().upper()
                if any(q in txt for q in ['CAM', 'HD', 'BLURAY', 'WEB', 'DVD', 'TS']):
                    quality_found = txt
                    break

        if not quality_found:
            quality_link = soup.find('a', href=lambda h: h and '/quality/' in h)
            if quality_link:
                quality_found = quality_link.get_text().strip().upper()

        item['quality'] = quality_found if quality_found else ("SERIES" if item.get('type') == 'series' else "HD")

        # Check for direct video player iframe (movie or single stream)
        iframes = [ifr['src'] for ifr in soup.find_all('iframe') if ifr.get('src') and not 'youtube' in ifr.get('src')]
        if iframes:
            item['iframe_url'] = iframes[0]
            item['stream_url'] = fetch_playcdn_stream(iframes[0], headers)

    except Exception as e:
        print(f"Error fetching stream for {item['title']}: {e}")

    return item

def fetch_html_page(url, headers):
    if USE_PLAYWRIGHT:
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(user_agent=headers.get("User-Agent"))
                page = context.new_page()
                resp = page.goto(url, wait_until="domcontentloaded", timeout=30000)
                status_code = resp.status if resp else 200
                page.wait_for_timeout(2000)
                html_content = page.content()
                browser.close()
                if html_content and "Just a moment..." not in html_content:
                    return html_content, status_code
        except Exception as pw_err:
            print(f"[Playwright] Error fetching {url}: {pw_err}", flush=True)

    try:
        req_kwargs = {"headers": headers, "timeout": 25}
        if USE_CURL_CFFI:
            req_kwargs["impersonate"] = "chrome110"
        resp = requests.get(url, **req_kwargs)
        return resp.text, resp.status_code
    except Exception as e:
        status = getattr(e, 'response', None)
        code = status.status_code if status else 500
        return None, code
    return None, 404

def scrape_lk21(start_url=None, max_pages=0, extract_streams=False, output_file="lk21_mv_live.db", progress_callback=None, target_urls=None):
    extracted_links = {}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
    }

    if not target_urls:
        if start_url:
            target_urls = [start_url]
        else:
            target_urls = DEFAULT_BASE_URLS

    target_live_db = output_file if output_file.endswith('.db') else "lk21_mv_live.db"
    if '_live.db' in target_live_db:
        progress_db = target_live_db.replace('_live.db', '.db')
    else:
        progress_db = target_live_db + '.tmp'

    if os.path.exists(target_live_db) and not os.path.exists(progress_db):
        try:
            import shutil
            shutil.copy2(target_live_db, progress_db)
            print(f"Loaded existing database {target_live_db} for incremental update.", flush=True)
        except Exception:
            pass

    init_db_schema(progress_db)

    for url_idx, base_url in enumerate(target_urls):
        base_clean = base_url.rstrip('/')
        print(f"\n==================================================", flush=True)
        print(f"[{url_idx + 1}/{len(target_urls)}] Scraping Base URL: {base_clean}", flush=True)
        print(f"==================================================", flush=True)

        # Step 1: Fetch Page 1 to extract total pages
        page1_html, status1 = fetch_html_page(base_url, headers)
        if status1 in (403, 404) or not page1_html:
            print(f"--> Received HTTP {status1} on {base_url}. Skipping base URL.", flush=True)
            continue

        soup1 = BeautifulSoup(page1_html, 'html.parser')
        match = re.search(r'dari\s+(\d+)\s+total\s+halaman', page1_html, re.I)
        if match:
            total_pages_detected = int(match.group(1))
        else:
            total_pages_detected = 50

        if max_pages > 0:
            target_total = min(max_pages, total_pages_detected)
        else:
            target_total = total_pages_detected

        print(f"Detected {total_pages_detected} total pages. Scraping {target_total} pages in parallel with 10 worker threads...", flush=True)

        page_urls = [base_url]
        for p in range(2, target_total + 1):
            if '/page/' in base_clean:
                page_urls.append(re.sub(r'/page/\d+/?', f'/page/{p}/', base_clean))
            else:
                page_urls.append(f"{base_clean}/page/{p}/")

        def fetch_and_parse_page(url_info):
            idx, page_url = url_info
            p_html, status_code = fetch_html_page(page_url, headers)
            if status_code in (403, 404) or not p_html:
                return []

            p_soup = BeautifulSoup(p_html, 'html.parser')
            cards = p_soup.find_all('article')
            # Discard fallback sidebar grid (when cards count > 50)
            if len(cards) > 50:
                return []

            p_items = []
            if cards:
                for card in cards:
                    a_tag = card.find('a', href=True)
                    if a_tag:
                        item = classify_card(a_tag, card_element=card, card_text=card.get_text(), base_url=base_url)
                        if item:
                            p_items.append(item)
            else:
                for a_tag in p_soup.find_all('a', href=True):
                    item = classify_card(a_tag, card_element=a_tag.parent, card_text=a_tag.get_text(), base_url=base_url)
                    if item:
                        p_items.append(item)
            return p_items

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(fetch_and_parse_page, (i, url)) for i, url in enumerate(page_urls)]
            for future in as_completed(futures):
                try:
                    page_items = future.result()
                    for item in page_items:
                        if item['url'] not in extracted_links:
                            extracted_links[item['url']] = item
                except Exception as page_err:
                    print(f"Error fetching page: {page_err}", flush=True)

        print(f"Finished {base_clean}. Total accumulated catalog: {len(extracted_links)} unique items.", flush=True)

    results = list(extracted_links.values())

    if extract_streams:
        completed_urls = get_existing_completed_urls(progress_db)
        if not completed_urls:
            completed_urls = get_existing_completed_urls(target_live_db)

        items_to_process = [item for item in results if item['url'] not in completed_urls]
        skipped_count = len(results) - len(items_to_process)
        if skipped_count > 0:
            print(f"Skipping {skipped_count} items already present and resolved in database.", flush=True)

        total_items = len(items_to_process)
        if total_items == 0:
            print("All items are already fully resolved in the database. Nothing new to scrape.", flush=True)
        else:
            print(f"\nResolving stream URLs for {total_items} new/unresolved items concurrently with 10 worker threads...", flush=True)

        completed_count = 0

        def process_item(item):
            resolve_stream_urls(item, headers)
            return item

        if items_to_process:
            with ThreadPoolExecutor(max_workers=10) as executor:
                future_to_item = {executor.submit(process_item, item): item for item in items_to_process}
            for future in as_completed(future_to_item):
                completed_count += 1
                item = future.result()
                pct = (completed_count / total_items) * 100

                stream_link = item.get('stream_url')
                if not stream_link and item.get('episodes'):
                    ep_links = [e['stream_url'] for e in item['episodes'] if e.get('stream_url')]
                    stream_link = ep_links[0] if ep_links else "No stream iframe"
                elif not stream_link:
                    stream_link = "No stream iframe"

                quality = item.get('quality', 'HD')
                msg = f"[{completed_count}/{total_items} - {pct:.1f}%] [{quality}] {item['title']} -> {stream_link}"
                print(msg, flush=True)
                if progress_callback:
                    progress_callback(phase="streams", current=completed_count, total=total_items, percentage=round(pct, 1), message=msg, current_item=item['title'])

                # Real-time incremental write to progress_db
                save_single_item_to_sqlite(item, progress_db)
    else:
        # Batch save if streams disabled
        save_to_sqlite(results, progress_db)

    # Atomic replace to live DB upon 100% completion
    # Backup/Copy fresh dataset into live DB safely on Windows
    try:
        source_conn = sqlite3.connect(progress_db)
        dest_conn = sqlite3.connect(target_live_db)
        source_conn.backup(dest_conn)
        source_conn.close()
        dest_conn.close()
    except Exception as copy_err:
        print(f"Error updating live DB: {copy_err}")

    print(f"\nSuccessfully processed {len(results)} movie/series items.")
    print(f"Saved to SQLite DB: {target_live_db}")
    return results

def init_db_schema(db_filepath):
    conn = sqlite3.connect(db_filepath)
    cursor = conn.cursor()
    # Enable WAL mode for high-concurrency non-blocking reads while writing
    cursor.execute("PRAGMA journal_mode=WAL;")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS movies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            slug TEXT UNIQUE,
            url TEXT,
            rating TEXT,
            poster_image TEXT,
            type TEXT,
            quality TEXT,
            genres TEXT,
            synopsis TEXT,
            cast TEXT,
            iframe_url TEXT,
            stream_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_movies_slug ON movies(slug)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_movies_quality ON movies(quality)")
    conn.commit()
    conn.close()

def get_existing_completed_urls(db_filepath):
    if not os.path.exists(db_filepath):
        return set()
    try:
        conn = sqlite3.connect(db_filepath)
        cursor = conn.cursor()
        cursor.execute("SELECT url FROM movies WHERE stream_url IS NOT NULL AND stream_url != '' AND stream_url != 'No stream iframe'")
        rows = cursor.fetchall()
        conn.close()
        return {r[0] for r in rows if r[0]}
    except Exception:
        return set()

def save_single_item_to_sqlite(item, db_filepath):
    conn = sqlite3.connect(db_filepath)
    cursor = conn.cursor()

    genres_str = ",".join(item.get("genres", [])) if isinstance(item.get("genres"), list) else str(item.get("genres", ""))
    cast_str = ",".join(item.get("cast", [])) if isinstance(item.get("cast"), list) else str(item.get("cast", ""))

    cursor.execute("""
        INSERT OR REPLACE INTO movies (
            title, slug, url, rating, poster_image, type, quality, genres, synopsis, cast, iframe_url, stream_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        item.get("title"),
        item.get("slug"),
        item.get("url"),
        item.get("rating"),
        item.get("poster_image"),
        item.get("type"),
        item.get("quality"),
        genres_str,
        item.get("synopsis"),
        cast_str,
        item.get("iframe_url"),
        item.get("stream_url")
    ))

    conn.commit()
    conn.close()

def save_to_sqlite(items, db_filepath):
    temp_db = db_filepath + ".tmp"
    if os.path.exists(temp_db):
        try:
            os.remove(temp_db)
        except Exception:
            pass

    conn = sqlite3.connect(temp_db)
    cursor = conn.cursor()

    # Create movies table schema
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS movies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            slug TEXT UNIQUE,
            url TEXT,
            rating TEXT,
            poster_image TEXT,
            type TEXT,
            quality TEXT,
            genres TEXT,
            synopsis TEXT,
            cast TEXT,
            iframe_url TEXT,
            stream_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Create indexes for fast search and filtering
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_movies_slug ON movies(slug)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_movies_quality ON movies(quality)")

    # Insert items
    for item in items:
        genres_str = ",".join(item.get("genres", [])) if isinstance(item.get("genres"), list) else str(item.get("genres", ""))
        cast_str = ",".join(item.get("cast", [])) if isinstance(item.get("cast"), list) else str(item.get("cast", ""))

        cursor.execute("""
            INSERT OR REPLACE INTO movies (
                title, slug, url, rating, poster_image, type, quality, genres, synopsis, cast, iframe_url, stream_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            item.get("title"),
            item.get("slug"),
            item.get("url"),
            item.get("rating"),
            item.get("poster_image"),
            item.get("type"),
            item.get("quality"),
            genres_str,
            item.get("synopsis"),
            cast_str,
            item.get("iframe_url"),
            item.get("stream_url")
        ))

    conn.commit()
    conn.close()

    try:
        os.replace(temp_db, db_filepath)
    except Exception:
        pass

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Strip LK21 Movie & Series Sublinks")
    parser.add_argument("--url", default=None, help="Target single LK21 page URL")
    parser.add_argument("--all-urls", action="store_true", help="Scrape all 17 default base URLs (genres, countries, top movies)")
    parser.add_argument("--max-pages", type=int, default=0, help="Max pages per base URL (0 for unlimited until 403/404/empty)")
    parser.add_argument("--no-streams", action="store_true", help="Skip resolving stream/video player URLs")
    parser.add_argument("--output", default="lk21_mv_live.db", help="Output SQLite DB file name")

    args = parser.parse_args()

    targets = DEFAULT_BASE_URLS if (args.all_urls or not args.url) else [args.url]
    scrape_lk21(start_url=args.url, max_pages=args.max_pages, extract_streams=not args.no_streams, output_file=args.output, target_urls=targets)

