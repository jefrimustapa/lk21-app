import os
import sqlite3
import sys

def escape_sql_str(val):
    if val is None:
        return "NULL"
    val_str = str(val).replace("'", "''")
    return f"'{val_str}'"

def export_to_d1_sql(sqlite_db_path="lk21_mv_live.db", output_sql_path="lk21_dump.sql"):
    if not os.path.exists(sqlite_db_path):
        print(f"Error: SQLite database {sqlite_db_path} not found.")
        sys.exit(1)

    conn = sqlite3.connect(sqlite_db_path)
    cursor = conn.cursor()

    # Query all valid movies without hardcoded auto-increment 'id'
    cursor.execute("""
        SELECT title, slug, url, rating, poster_image, type, quality, genres, synopsis, "cast", iframe_url, stream_url
        FROM movies
        WHERE slug IS NOT NULL AND trim(slug) != ''
    """)
    rows = cursor.fetchall()
    conn.close()

    print(f"Exporting {len(rows)} movies from {sqlite_db_path} to {output_sql_path}...")

    with open(output_sql_path, "w", encoding="utf-8") as f:
        # 1. Ensure table schema and indexes exist in Cloudflare D1
        f.write("CREATE TABLE IF NOT EXISTS movies (\n")
        f.write("    id INTEGER PRIMARY KEY AUTOINCREMENT,\n")
        f.write("    title TEXT NOT NULL,\n")
        f.write("    slug TEXT UNIQUE,\n")
        f.write("    url TEXT,\n")
        f.write("    rating TEXT,\n")
        f.write("    poster_image TEXT,\n")
        f.write("    type TEXT,\n")
        f.write("    quality TEXT,\n")
        f.write("    genres TEXT,\n")
        f.write("    synopsis TEXT,\n")
        f.write('    "cast" TEXT,\n')
        f.write("    iframe_url TEXT,\n")
        f.write("    stream_url TEXT,\n")
        f.write("    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n")
        f.write(");\n")
        f.write("CREATE INDEX IF NOT EXISTS idx_movies_slug ON movies(slug);\n")
        f.write("CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);\n\n")

        # 2. Emit non-destructive UPSERT statements that match purely on UNIQUE 'slug'
        # This guarantees:
        # - Existing movies in D1 are updated without their original 'id' being changed or deleted
        # - New movies are smoothly inserted with new auto-increment IDs
        # - Unscraped old movies are NEVER clobbered or deleted
        for row in rows:
            title, slug, url, rating, poster_img, mtype, quality, genres, synopsis, cast_names, iframe_url, stream_url = row

            sql = (
                f'INSERT INTO movies (title, slug, url, rating, poster_image, type, quality, genres, synopsis, "cast", iframe_url, stream_url) '
                f"VALUES ({escape_sql_str(title)}, {escape_sql_str(slug)}, {escape_sql_str(url)}, {escape_sql_str(rating)}, {escape_sql_str(poster_img)}, {escape_sql_str(mtype)}, {escape_sql_str(quality)}, {escape_sql_str(genres)}, {escape_sql_str(synopsis)}, {escape_sql_str(cast_names)}, {escape_sql_str(iframe_url)}, {escape_sql_str(stream_url)}) "
                f"ON CONFLICT(slug) DO UPDATE SET "
                f'title=excluded.title, url=excluded.url, rating=excluded.rating, poster_image=excluded.poster_image, type=excluded.type, quality=excluded.quality, genres=excluded.genres, synopsis=excluded.synopsis, "cast"=excluded."cast", iframe_url=excluded.iframe_url, stream_url=excluded.stream_url;\n'
            )
            f.write(sql)

    print(f"Successfully generated {output_sql_path} with {len(rows)} UPSERT statements.")

if __name__ == "__main__":
    db_file = sys.argv[1] if len(sys.argv) > 1 else "lk21_mv_live.db"
    out_file = sys.argv[2] if len(sys.argv) > 2 else "lk21_dump.sql"
    export_to_d1_sql(db_file, out_file)
