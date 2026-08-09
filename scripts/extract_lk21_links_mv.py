import argparse
import json
import os
import re
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

EXCLUDED_PATHS = {
    '', '/', '/#', '/populer', '/rating', '/release', '/latest', '/nontondrama',
    '/latest-series', '/top-series-today', '/top-movie-today',
    '/dmca', '/faq', '/privacy-policy', '/cara-install-vpn', '/rekomendasi-film-pintar',
    '/most-commented'
}

EXCLUDED_PREFIXES = ('/genre/', '/country/', '/year/', '/director/', '/artist/', '/translator/', '/quality/')

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
    try:
        resp = requests.get(target_url, headers=headers, timeout=15)
        if resp.status_code != 200:
            return item

        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Check for instant redirect link (e.g. openNow button)
        open_now = soup.find('a', id='openNow')
        if open_now and open_now.get('href'):
            target_url = open_now['href']
            resp = requests.get(target_url, headers=headers, timeout=15)
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

def scrape_lk21(start_url, max_pages=2, extract_streams=False, output_file="lk21_mv_live.db", progress_callback=None):
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

    target_live_db = output_file if output_file.endswith('.db') else "lk21_mv_live.db"
    if '_live.db' in target_live_db:
        progress_db = target_live_db.replace('_live.db', '.db')
    else:
        progress_db = target_live_db + '.tmp'

    # Immediately wipe old progress_db and initialize fresh schema before fetching pages
    init_db_schema(progress_db)

    current_url = start_url
    page_num = 1
    total_pages_detected = None

    while current_url:
        if total_pages_detected and page_num > total_pages_detected:
            break
        if max_pages > 0 and page_num > max_pages:
            break

        try:
            resp = requests.get(current_url, headers=headers, timeout=20)
            if resp.status_code != 200:
                err_msg = f"HTTP {resp.status_code} from {current_url}: {resp.text[:100]}"
                print(err_msg, flush=True)
                if progress_callback:
                    progress_callback(phase="error", current=0, total=0, percentage=0.0, message=err_msg)
                break

            soup = BeautifulSoup(resp.text, 'html.parser')

            # Auto-detect total pages if max_pages <= 0
            if max_pages <= 0 and not total_pages_detected:
                # Search for <h3>Halaman 1 dari 1185 total halaman</h3>
                page_info_h3 = soup.find('h3', text=re.compile(r'dari\s+\d+\s+total\s+halaman', re.I))
                if not page_info_h3:
                    # Fallback search anywhere in text
                    match = re.search(r'dari\s+(\d+)\s+total\s+halaman', resp.text, re.I)
                    if match:
                        total_pages_detected = int(match.group(1))
                else:
                    match = re.search(r'dari\s+(\d+)\s+total\s+halaman', page_info_h3.text, re.I)
                    if match:
                        total_pages_detected = int(match.group(1))

                if total_pages_detected:
                    print(f"Auto-detected max pages from website: {total_pages_detected} total pages.", flush=True)
                else:
                    total_pages_detected = 50 # Fallback if element not found

            target_total = total_pages_detected if (max_pages <= 0 and total_pages_detected) else max_pages
            page_pct = (page_num / target_total) * 100
            msg = f"[Pages {page_num}/{target_total} - {page_pct:.1f}%] Fetching: {current_url}"
            print(msg, flush=True)
            if progress_callback:
                progress_callback(phase="pages", current=page_num, total=target_total, percentage=round(page_pct, 1), message=msg)

            # Process grid cards (iterate over <article> card elements or fallback to scanning <a> tags directly)
            cards = soup.find_all('article')
            if cards:
                for card in cards:
                    a_tag = card.find('a', href=True)
                    if a_tag:
                        item = classify_card(a_tag, card_element=card, card_text=card.get_text(), base_url=start_url)
                        if item and item['url'] not in extracted_links:
                            extracted_links[item['url']] = item
            else:
                for a_tag in soup.find_all('a', href=True):
                    item = classify_card(a_tag, card_element=a_tag.parent, card_text=a_tag.get_text(), base_url=start_url)
                    if item and item['url'] not in extracted_links:
                        extracted_links[item['url']] = item

            # Handle pagination URL building
            base_clean = current_url.rstrip('/')
            if '/page/' in base_clean:
                current_url = re.sub(r'/page/\d+/?', f'/page/{page_num + 1}/', base_clean)
            else:
                current_url = f"{base_clean}/page/{page_num + 1}/"

            page_num += 1
            time.sleep(1)

        except Exception as e:
            err_msg = f"Error scraping {current_url}: {e}"
            print(err_msg, flush=True)
            if progress_callback:
                progress_callback(phase="error", current=0, total=0, percentage=0.0, message=err_msg)
            break

    results = list(extracted_links.values())

    if extract_streams:
        total_items = len(results)
        print(f"\nResolving stream URLs for {total_items} items concurrently with 10 worker threads (updating {progress_db} live)...", flush=True)
        completed_count = 0

        def process_item(item):
            resolve_stream_urls(item, headers)
            return item

        with ThreadPoolExecutor(max_workers=10) as executor:
            future_to_item = {executor.submit(process_item, item): item for item in results}
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

    # Drop existing table to ensure 100% fresh clean restart on every run
    cursor.execute("DROP TABLE IF EXISTS movies;")

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
    parser.add_argument("--url", default="https://tv12.lk21official.cc/top-movie-today", help="Target LK21 page URL")
    parser.add_argument("--max-pages", type=int, default=10, help="Number of pages to scrape (Set 0 to auto-detect total pages)")
    parser.add_argument("--no-streams", action="store_true", help="Skip resolving stream/video player URLs")
    parser.add_argument("--output", default="lk21_mv_live.db", help="Output SQLite DB file name")

    args = parser.parse_args()
    scrape_lk21(args.url, args.max_pages, extract_streams=not args.no_streams, output_file=args.output)

