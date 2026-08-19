export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Endpoint 1: Health check
      if (path === "/" || path === "") {
        return new Response(JSON.stringify({
          status: "ok",
          service: "LK21 Cloudflare D1 SQLite API",
          endpoints: {
            "GET /api/movies?page=1&limit=20": "Paginated list of movies from Cloudflare D1",
            "GET /api/movies?genre=Action&page=1&limit=20": "Genre-filtered paginated movies",
            "GET /api/search?q=spider": "Fast title search on Cloudflare D1",
            "GET /api/movie/:slug": "Get single movie by slug"
          }
        }), { headers: corsHeaders });
      }

      // Endpoint 2: Paginated movies list (with optional genre filter)
      if (path === "/api/movies") {
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = parseInt(url.searchParams.get("limit") || "20");
        const genre = url.searchParams.get("genre") || "";
        const offset = (page - 1) * limit;

        let total, results;

        if (genre && genre !== "ALL") {
          // Filter by genre using LIKE (genres stored as "Comedy,Action" etc.)
          const countStmt = await env.DB.prepare(
            "SELECT COUNT(*) as count FROM movies WHERE genres LIKE ?"
          ).bind(`%${genre}%`).first();
          total = countStmt ? countStmt.count : 0;

          ({ results } = await env.DB.prepare(
            "SELECT * FROM movies WHERE genres LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?"
          ).bind(`%${genre}%`, limit, offset).all());
        } else {
          const countStmt = await env.DB.prepare("SELECT COUNT(*) as count FROM movies").first();
          total = countStmt ? countStmt.count : 0;

          ({ results } = await env.DB.prepare(
            "SELECT * FROM movies ORDER BY id DESC LIMIT ? OFFSET ?"
          ).bind(limit, offset).all());
        }

        return new Response(JSON.stringify({
          status: "success",
          page: page,
          limit: limit,
          total: total,
          data: results
        }), { headers: corsHeaders });
      }

      // Endpoint 3: Fast Search
      if (path === "/api/search") {
        const query = url.searchParams.get("q") || "";
        if (!query) {
          return new Response(JSON.stringify({ status: "error", message: "Missing query parameter 'q'" }), { status: 400, headers: corsHeaders });
        }

        const { results } = await env.DB.prepare('SELECT * FROM movies WHERE title LIKE ? OR genres LIKE ? OR "cast" LIKE ? OR synopsis LIKE ? LIMIT 50')
          .bind(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`)
          .all();

        return new Response(JSON.stringify({
          status: "success",
          query: query,
          count: results.length,
          data: results
        }), { headers: corsHeaders });
      }

      // Endpoint 4: Single Movie lookup by Slug
      if (path.startsWith("/api/movie/")) {
        const slug = path.replace("/api/movie/", "").trim();
        const item = await env.DB.prepare("SELECT * FROM movies WHERE slug = ?").bind(slug).first();

        if (!item) {
          return new Response(JSON.stringify({ status: "error", message: "Movie not found" }), { status: 404, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ status: "success", data: item }), { headers: corsHeaders });
      }

      // Endpoint 5: Live Stream Server Resolver (App-level dynamic source resolution)
      if (path === "/api/resolve") {
        let targetUrl = url.searchParams.get("url") || "";
        const slug = url.searchParams.get("slug") || "";

        if (!targetUrl && slug) {
          targetUrl = `https://tv12.lk21official.cc/${slug}`;
        }

        if (!targetUrl) {
          return new Response(JSON.stringify({ status: "error", message: "Missing query parameter 'url' or 'slug'" }), { status: 400, headers: corsHeaders });
        }

        try {
          const detailRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": "https://tv12.lk21official.cc/"
            }
          });
          const html = await detailRes.text();
          const foundSources = [];

          const addSource = (src) => {
            if (!src || typeof src !== "string") return;
            src = src.trim();
            if (src.startsWith("//")) src = "https:" + src;
            if (src.startsWith("/")) src = "https://tv12.lk21official.cc" + src;
            if (!src.startsWith("http")) return;

            // Exclude non-stream assets & trackers
            if (src.includes("youtube") || src.includes("google") || src.endsWith(".jpg") || src.endsWith(".png") || src.endsWith(".webp") || src.includes("/uploads/")) {
              return;
            }

            // 1. Unwrap TurboVIP to direct turbovidhls player
            if (src.includes("videonode.de/iframe/turbovip/")) {
              const m = src.match(/videonode\.de\/iframe\/turbovip\/([a-zA-Z0-9_-]+)/);
              if (m && m[1]) {
                const directUrl = `https://turbovidhls.com/t/${m[1]}`;
                if (!foundSources.includes(directUrl)) foundSources.push(directUrl);
              }
            }

            // 2. Unwrap Cast/FileLions to direct gn1r5n player
            if (src.includes("videonode.de/iframe/cast/")) {
              const m = src.match(/videonode\.de\/iframe\/cast\/([a-zA-Z0-9_-]+)/);
              if (m && m[1]) {
                const directUrl = `https://gn1r5n.org/e/${m[1]}`;
                if (!foundSources.includes(directUrl)) foundSources.push(directUrl);
              }
            }

            // 3. Unwrap Hydrax to direct abyssplayer
            if (src.includes("videonode.de/iframe/hydrax/")) {
              const m = src.match(/videonode\.de\/iframe\/hydrax\/([a-zA-Z0-9_-]+)/);
              if (m && m[1]) {
                const directUrl = `https://abyssplayer.com/${m[1]}`;
                if (!foundSources.includes(directUrl)) foundSources.push(directUrl);
              }
            }

            // 4. Unwrap P2P to playcdn
            if (src.includes("videonode.de/iframe/p2p/")) {
              const p2pMatch = src.match(/videonode\.de\/iframe\/p2p\/([a-zA-Z0-9_-]+)/);
              if (p2pMatch && p2pMatch[1]) {
                const playCdnUrl = `https://playcdn.de/video.php?id=${p2pMatch[1]}`;
                if (!foundSources.includes(playCdnUrl)) {
                  foundSources.push(playCdnUrl);
                }
              }
            }

            if (!foundSources.includes(src)) {
              foundSources.push(src);
            }
          };

          // 1. Extract all iframe embeds from detail page (excluding trailers)
          const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
          let m;
          while ((m = iframeRegex.exec(html)) !== null) {
            addSource(m[1]);
          }

          // 2. Extract data-provider & alternative player server buttons
          const providerRegex = /(?:data-url|data-src|data-provider|data-href|data-stream)=["']([^"']+)["']/gi;
          while ((m = providerRegex.exec(html)) !== null) {
            const pUrl = m[1];
            if (pUrl.includes("videonode") || pUrl.includes("turbovid") || pUrl.includes("playcdn") || pUrl.includes("watchcdn") || pUrl.includes("embed") || pUrl.includes("player") || pUrl.includes("stream") || pUrl.includes("turbovip") || pUrl.includes("hydrax") || pUrl.includes("cast") || pUrl.includes("filelions") || pUrl.includes(".m3u8")) {
              addSource(pUrl);
            }
          }

          // 3. Extract player links inside script tags or onclick handlers
          const onclickRegex = /(?:loadPlayer|changeServer|loadEmbed|openStream)\(["']([^"']+)["']\)/gi;
          while ((m = onclickRegex.exec(html)) !== null) {
            addSource(m[1]);
          }

          // 4. Resolve direct master .m3u8 playlists from Turbovid for pure native HTML5 / Hls.js playback
          const turbovidIds = [];
          foundSources.forEach(s => {
            const tm = s.match(/(?:turbovidhls\.com\/t\/|videonode\.de\/iframe\/turbovip\/)([a-zA-Z0-9_-]+)/);
            if (tm && tm[1] && !turbovidIds.includes(tm[1])) {
              turbovidIds.push(tm[1]);
            }
          });

          for (const tid of turbovidIds) {
            try {
              const tvRes = await fetch(`https://turbovidhls.com/t/${tid}`, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  "Referer": "https://videonode.de/"
                }
              });
              if (tvRes.ok) {
                const tvHtml = await tvRes.text();
                // Extract packed script and de-obfuscate urlPlay
                const scripts = [...tvHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(sm => sm[1]);
                for (const s of scripts) {
                  if (s.includes("eval(") && (s.includes("_0xc71e") || s.includes("split"))) {
                    const evalIdx = s.lastIndexOf("eval(");
                    if (evalIdx !== -1) {
                      let unpacked = "";
                      const fakeEval = (code) => { unpacked = code; };
                      const wrapper = s.substring(0, evalIdx) + "fakeEval(" + s.substring(evalIdx + 5);
                      (0, eval)(wrapper);
                      const m3u8Match = unpacked.match(/urlPlay\s*=\s*'([^']+)'/);
                      if (m3u8Match && m3u8Match[1] && !foundSources.includes(m3u8Match[1])) {
                        foundSources.unshift(m3u8Match[1]);
                      }
                    }
                  }
                }
              }
            } catch(e) {}
          }

          // Prioritize direct raw .m3u8, then gn1r5n/cast, abyssplayer/hydrax, turbovid, and playcdn
          foundSources.sort((a, b) => {
            const getScore = (url) => {
              if (url.includes(".m3u8")) return 0;
              if (url.includes("gn1r5n.org") || url.includes("filelions")) return 1;
              if (url.includes("abyssplayer.com") || url.includes("hydrax")) return 2;
              if (url.includes("turbovidhls.com") || url.includes("emturbovid.com")) return 3;
              if (url.includes("playcdn.de")) return 4;
              if (url.includes("videonode.de")) return 5;
              return 6;
            };
            return getScore(a) - getScore(b);
          });

          return new Response(JSON.stringify({
            status: "success",
            target: targetUrl,
            count: foundSources.length,
            sources: foundSources
          }), { headers: corsHeaders });
        } catch (fetchErr) {
          return new Response(JSON.stringify({ status: "error", message: "Failed to resolve stream: " + fetchErr.message }), { status: 502, headers: corsHeaders });
        }
      }

      // Endpoint 6: Stream Embed HTML Proxy (App-equivalent Web Player Proxy)
      if (path === "/api/embed") {
        let targetUrl = url.searchParams.get("url") || "";
        if (!targetUrl) {
          return new Response("Missing target embed url", { status: 400 });
        }

        // Direct unwrapping of videonode p2p to playcdn video for direct clean proxying
        if (targetUrl.includes("videonode.de/iframe/p2p/")) {
          const p2pMatch = targetUrl.match(/videonode\.de\/iframe\/p2p\/([a-zA-Z0-9_-]+)/);
          if (p2pMatch && p2pMatch[1]) {
            targetUrl = `https://playcdn.de/video.php?id=${p2pMatch[1]}`;
          }
        }

        try {
          const originHost = new URL(targetUrl).origin;
          const embedRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": targetUrl.includes("playcdn.de") ? "https://videonode.de/" : "https://tv12.lk21official.cc/"
            }
          });

          let fullHtml = await embedRes.text();

          // 1. Inject base tag so all relative assets & scripts (js/hls, style.min.css, api2.php) resolve to originHost
          const baseTag = `<base href="${originHost}/">`;
          if (fullHtml.includes("<head>")) {
            fullHtml = fullHtml.replace("<head>", `<head>${baseTag}`);
          } else {
            fullHtml = baseTag + fullHtml;
          }

          // 2. Neutralize top-frame redirects & devtool traps
          fullHtml = fullHtml.replace(/if\s*\(\s*window\.self\s*===\s*window\.top\s*\)\s*\{[\s\S]*?\}/gi, "");
          fullHtml = fullHtml.replace(/<script>[\s\S]*?devtoolIsOpening[\s\S]*?<\/script>/gi, "<script>window.devtoolIsOpening=function(){};</script>");
          fullHtml = fullHtml.replace("<a id=\"uyeouyeo\"", "<a id=\"uyeouyeo\" style=\"display:none!important;visibility:hidden!important;pointer-events:none!important;\"");
          fullHtml = fullHtml.replace(/debugger;/g, "");

          // 3. Neutralize anti-inspect & domain blockers (Turbovid Security alert)
          fullHtml = fullHtml.replace(/var checkDomain\s*=\s*false;/g, "var checkDomain = true;");
          fullHtml = fullHtml.replace(/domainEmbed\s*=\s*['"][^'"]+['"]/g, "domainEmbed = 'no'");
          fullHtml = fullHtml.replace(/checkIframe\s*==\s*['"]no iframe['"]/g, "true");

          // 4. Rewrite any inner iframe embed sources to pass through our embed proxy as well
          fullHtml = fullHtml.replace(/src=["'](https:\/\/(?:playcdn\.de|videonode\.de|watchcdn\.de)[^"']+)["']/gi, (match, p1) => {
            return `src="https://lk21-api.lkapp.workers.dev/api/embed?url=${encodeURIComponent(p1)}"`;
          });

          return new Response(fullHtml, {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Headers": "*",
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
            }
          });
        } catch (embedErr) {
          return new Response("Error loading embed player: " + embedErr.message, { status: 502 });
        }
      }

      return new Response(JSON.stringify({ status: "error", message: "Endpoint not found" }), { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ status: "error", message: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
