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
        const targetUrl = url.searchParams.get("url") || "";
        if (!targetUrl) {
          return new Response(JSON.stringify({ status: "error", message: "Missing query parameter 'url'" }), { status: 400, headers: corsHeaders });
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

          // 1. Extract all iframe embeds from detail page (excluding trailers)
          const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
          let m;
          while ((m = iframeRegex.exec(html)) !== null) {
            const src = m[1];
            if (!src.includes("youtube") && !src.endsWith(".jpg") && !src.endsWith(".png") && !foundSources.includes(src)) {
              foundSources.push(src);
            }
          }

          // 2. Extract data-provider & alternative player server buttons
          const providerRegex = /(?:data-url|data-src|data-provider)=["']([^"']+)["']/gi;
          while ((m = providerRegex.exec(html)) !== null) {
            const pUrl = m[1];
            if (pUrl.startsWith("http") && !pUrl.includes("youtube") && !pUrl.endsWith(".jpg") && !pUrl.endsWith(".png") && !pUrl.endsWith(".webp") && !pUrl.contains("/uploads/") && !foundSources.includes(pUrl)) {
              if (pUrl.includes("videonode") || pUrl.includes("playcdn") || pUrl.includes("embed") || pUrl.includes("player") || pUrl.includes("stream") || pUrl.includes("turbovip") || pUrl.includes("hydrax") || pUrl.includes("cast") || pUrl.includes("filelions")) {
                foundSources.push(pUrl);
              }
            }
          }

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
        const targetUrl = url.searchParams.get("url") || "";
        if (!targetUrl) {
          return new Response("Missing target embed url", { status: 400 });
        }

        try {
          const embedRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": "https://tv12.lk21official.cc/"
            }
          });

          let fullHtml = await embedRes.text();
          fullHtml = fullHtml.replaceAll("(?i)<script>[\\s\\S]*?devtoolIsOpening[\\s\\S]*?</script>", "<script>window.devtoolIsOpening=function(){};</script>");
          fullHtml = fullHtml.replace("<a id=\"uyeouyeo\"", "<a id=\"uyeouyeo\" style=\"display:none!important;visibility:hidden!important;pointer-events:none!important;\"");
          fullHtml = fullHtml.replace("debugger;", "");

          return new Response(fullHtml, {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Headers": "*"
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
