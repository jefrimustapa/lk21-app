package com.lkflix.tv.app;

import android.content.Context;
import android.os.Bundle;
import android.util.Log;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "LKFlix";
    private boolean nativeIsTv = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupFullScreenWindow();

        nativeIsTv = detectIsTV();
        Log.e(TAG, "=== TV DETECTION === isTv=" + nativeIsTv);

        WebView webView = getBridge().getWebView();
        if (webView != null) {
            android.webkit.WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            
            android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            cookieManager.setAcceptThirdPartyCookies(webView, true);

            settings.setSupportMultipleWindows(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setUserAgentString("Mozilla/5.0 (Linux; Android 9; MiBOX4 Build/PI; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36");

            webView.setWebChromeClient(new android.webkit.WebChromeClient() {
                @Override
                public android.graphics.Bitmap getDefaultVideoPoster() {
                    return android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888);
                }

                @Override
                public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                    Log.d("LKFlix", "Blocked window creation popup");
                    return false; // Strictly disallow popup windows
                }
            });

            // Intercept only HTML embed pages to remove ads/debugger and attach remote controls; let all API/WASM/streams pass natively
            getBridge().setWebViewClient(new com.getcapacitor.BridgeWebViewClient(getBridge()) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    if (url.startsWith("http://localhost") || url.startsWith("https://localhost") || url.startsWith("capacitor://") || url.contains("lk21") || url.contains("playcdn") || url.contains("videonode") || url.contains("turbovid") || url.contains("gn1r5n") || url.contains("workers.dev")) {
                        return false;
                    }
                    Log.d("LKFlix", "Blocked external popup url: " + url);
                    return true; // Block and consume
                }
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    String method = request.getMethod();
                    
                    // Only intercept top-level GET HTML pages (video.php / iframe)
                    if ("GET".equalsIgnoreCase(method) && (url.contains("video.php") || url.contains("/iframe/"))) {
                        try {
                            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                            conn.setRequestMethod("GET");
                            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 9; MiBOX4 Build/PI; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36");
                            conn.setRequestProperty("Referer", "https://tv12.lk21official.cc/");

                            String mimeType = conn.getContentType();
                            if (mimeType == null) mimeType = "text/html";
                            if (mimeType.contains(";")) {
                                mimeType = mimeType.split(";")[0].trim();
                            }

                            InputStream in = conn.getInputStream();
                            java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(in));
                            StringBuilder sb = new StringBuilder();
                            String line;
                            while ((line = r.readLine()) != null) {
                                sb.append(line).append("\n");
                            }
                            r.close();

                            String fullHtml = sb.toString();
                            // Cleanly neutralize the entire devtoolIsOpening script block in <head>
                            fullHtml = fullHtml.replaceAll("(?i)<script>[\\s\\S]*?devtoolIsOpening[\\s\\S]*?</script>", "<script>window.devtoolIsOpening=function(){};</script>");
                            fullHtml = fullHtml.replace("<a id=\"uyeouyeo\"", "<a id=\"uyeouyeo\" style=\"display:none!important;visibility:hidden!important;pointer-events:none!important;\"");
                            fullHtml = fullHtml.replace("debugger;", "");
                            fullHtml = fullHtml.replace("window.open", "function(){return null;}//window.open");
                            fullHtml = fullHtml.replace("target=\"_blank\"", "target=\"_self\"");

                            String injectScript = "<script>\n"
                                 + "var __lastToggleTime = 0;\n"
                                 + "function triggerToggle() {\n"
                                 + "  try {\n"
                                 + "    var now = Date.now();\n"
                                 + "    if (now - __lastToggleTime < 500) return;\n"
                                 + "    __lastToggleTime = now;\n"
                                 + "    var isNowPlaying = false;\n"
                                 + "    try {\n"
                                 + "      var jw = (typeof window.jwplayer === 'function') ? (window.jwplayer() || window.jwplayer(0) || window.jwplayer('player')) : null;\n"
                                 + "      if (jw && typeof jw.getState === 'function') {\n"
                                 + "        var jState = jw.getState();\n"
                                 + "        if (jState === 'playing') {\n"
                                 + "          if (typeof jw.pause === 'function') jw.pause(true);\n"
                                 + "          isNowPlaying = false;\n"
                                 + "        } else {\n"
                                 + "          if (typeof jw.play === 'function') jw.play(true);\n"
                                 + "          isNowPlaying = true;\n"
                                 + "        }\n"
                                 + "        window.parent.postMessage(JSON.stringify({ type: isNowPlaying ? 'play' : 'pause', state: isNowPlaying ? 'playing' : 'paused' }), '*');\n"
                                 + "        return;\n"
                                 + "      }\n"
                                 + "    } catch(jwErr) {}\n"
                                 + "    try {\n"
                                 + "      if (window.p2p && p2p.player && typeof p2p.player.getState === 'function') {\n"
                                 + "        var pState = p2p.player.getState();\n"
                                 + "        if (pState === 'playing') {\n"
                                 + "          p2p.player.pause(true);\n"
                                 + "          isNowPlaying = false;\n"
                                 + "        } else {\n"
                                 + "          p2p.player.play(true);\n"
                                 + "          isNowPlaying = true;\n"
                                 + "        }\n"
                                 + "        window.parent.postMessage(JSON.stringify({ type: isNowPlaying ? 'play' : 'pause', state: isNowPlaying ? 'playing' : 'paused' }), '*');\n"
                                 + "        return;\n"
                                 + "      }\n"
                                 + "    } catch(p2pErr) {}\n"
                                 + "    var videos = document.querySelectorAll('video');\n"
                                 + "    if (videos.length > 0) {\n"
                                 + "      var anyPlaying = false;\n"
                                 + "      for (var i = 0; i < videos.length; i++) {\n"
                                 + "        if (!videos[i].paused) anyPlaying = true;\n"
                                 + "      }\n"
                                 + "      for (var j = 0; j < videos.length; j++) {\n"
                                 + "        if (anyPlaying) { videos[j].pause(); }\n"
                                 + "        else { videos[j].play().catch(function(){}); }\n"
                                 + "      }\n"
                                 + "      isNowPlaying = !anyPlaying;\n"
                                 + "      window.parent.postMessage(JSON.stringify({ type: isNowPlaying ? 'play' : 'pause', state: isNowPlaying ? 'playing' : 'paused' }), '*');\n"
                                 + "      return;\n"
                                 + "    }\n"
                                 + "    var clickTarget = document.querySelector('.jw-video') || document.querySelector('.jw-media') || document.querySelector('.player') || document.querySelector('#player');\n"
                                 + "    if (clickTarget) { clickTarget.click(); }\n"
                                 + "  } catch(e) {}\n"
                                 + "}\n"
                                 + "function handleRemoteSeek(offset) {\n"
                                 + "  try {\n"
                                 + "    if (window.p2p && p2p.player && typeof p2p.player.getPosition === 'function') {\n"
                                 + "      var currentPos = p2p.player.getPosition();\n"
                                 + "      var targetPos = Math.max(0, currentPos + offset);\n"
                                 + "      p2p.player.seek(targetPos);\n"
                                 + "      return;\n"
                                 + "    }\n"
                                 + "    if (window.jwplayer && typeof window.jwplayer === 'function') {\n"
                                 + "      var jw = window.jwplayer();\n"
                                 + "      if (jw && typeof jw.getPosition === 'function') {\n"
                                 + "        var currentPos = jw.getPosition();\n"
                                 + "        var targetPos = Math.max(0, currentPos + offset);\n"
                                 + "        jw.seek(targetPos);\n"
                                 + "        return;\n"
                                 + "      }\n"
                                 + "    }\n"
                                 + "    var v = document.querySelector('video');\n"
                                 + "    if (v) { v.currentTime = Math.max(0, v.currentTime + offset); }\n"
                                 + "  } catch(e) {}\n"
                                 + "}\n"
                                 + "function setupPlaybackDetection() {\n"
                                 + "  try {\n"
                                 + "    var isPlaying = false;\n"
                                 + "    if (window.p2p && p2p.player && typeof p2p.player.getState === 'function') {\n"
                                 + "      if (p2p.player.getState() === 'playing') isPlaying = true;\n"
                                 + "    }\n"
                                 + "    var v = document.querySelector('video');\n"
                                 + "    if (v && !v.__lkBound) {\n"
                                 + "      v.__lkBound = true;\n"
                                 + "      v.addEventListener('playing', function() {\n"
                                 + "        window.parent.postMessage(JSON.stringify({ type: 'play', state: 'playing' }), '*');\n"
                                 + "      });\n"
                                 + "      v.addEventListener('pause', function() {\n"
                                 + "        window.parent.postMessage(JSON.stringify({ type: 'pause', state: 'paused' }), '*');\n"
                                 + "      });\n"
                                 + "      v.addEventListener('timeupdate', function() {\n"
                                 + "        if (v.currentTime > 0) {\n"
                                 + "          window.parent.postMessage(JSON.stringify({ type: 'timeupdate', position: v.currentTime }), '*');\n"
                                 + "        }\n"
                                 + "      });\n"
                                 + "    }\n"
                                 + "    if (window.jwplayer && typeof window.jwplayer === 'function') {\n"
                                 + "      var jw = window.jwplayer();\n"
                                 + "      if (jw && !jw.__lkBound && typeof jw.on === 'function') {\n"
                                 + "        jw.__lkBound = true;\n"
                                 + "        jw.on('play', function() {\n"
                                 + "          window.parent.postMessage(JSON.stringify({ type: 'play', state: 'playing' }), '*');\n"
                                 + "        });\n"
                                 + "        jw.on('pause', function() {\n"
                                 + "          window.parent.postMessage(JSON.stringify({ type: 'pause', state: 'paused' }), '*');\n"
                                 + "        });\n"
                                 + "        jw.on('time', function(e) {\n"
                                 + "          if (e && e.position > 0) {\n"
                                 + "            window.parent.postMessage(JSON.stringify({ type: 'timeupdate', position: e.position }), '*');\n"
                                 + "          }\n"
                                 + "        });\n"
                                 + "      }\n"
                                 + "    }\n"
                                 + "    if (window.p2p && p2p.player && !p2p.player.__lkBound && typeof p2p.player.on === 'function') {\n"
                                 + "      p2p.player.__lkBound = true;\n"
                                 + "      p2p.player.on('play', function() {\n"
                                 + "        window.parent.postMessage(JSON.stringify({ type: 'play', state: 'playing' }), '*');\n"
                                 + "      });\n"
                                 + "      p2p.player.on('pause', function() {\n"
                                 + "        window.parent.postMessage(JSON.stringify({ type: 'pause', state: 'paused' }), '*');\n"
                                 + "      });\n"
                                 + "      p2p.player.on('time', function(e) {\n"
                                 + "        var pos = (e && typeof e.position === 'number') ? e.position : (typeof p2p.player.getPosition === 'function' ? p2p.player.getPosition() : 0);\n"
                                 + "        if (pos > 0) {\n"
                                 + "          window.parent.postMessage(JSON.stringify({ type: 'timeupdate', position: pos }), '*');\n"
                                 + "        }\n"
                                 + "      });\n"
                                 + "    }\n"
                                 + "  } catch(err){}\n"
                                 + "}\n"
                                 + "function showIframeControls(persistent) {\n"
                                 + "  try {\n"
                                 + "    var evt = new MouseEvent('mousemove', { bubbles: false, cancelable: true, clientX: 100, clientY: 100 });\n"
                                 + "    var v = document.querySelector('video');\n"
                                 + "    if (v) {\n"
                                 + "      v.dispatchEvent(evt);\n"
                                 + "    }\n"
                                 + "    if (window.jwplayer && typeof window.jwplayer === 'function') {\n"
                                 + "      var jw = window.jwplayer();\n"
                                 + "      if (jw && typeof jw.setControls === 'function') {\n"
                                 + "        jw.setControls(true);\n"
                                 + "      }\n"
                                 + "    }\n"
                                 + "    var playerEl = document.querySelector('.jwplayer') || document.querySelector('.player') || document.querySelector('#player') || document.body;\n"
                                 + "    if (playerEl) {\n"
                                 + "      playerEl.classList.remove('jw-flag-user-inactive');\n"
                                 + "      playerEl.classList.add('jw-flag-user-active');\n"
                                 + "      playerEl.dispatchEvent(evt);\n"
                                 + "      if (window.__jwInactiveTimer) clearTimeout(window.__jwInactiveTimer);\n"
                                 + "      if (!persistent) {\n"
                                 + "        window.__jwInactiveTimer = setTimeout(function() {\n"
                                 + "          if (playerEl) {\n"
                                 + "            playerEl.classList.remove('jw-flag-user-active');\n"
                                 + "            playerEl.classList.add('jw-flag-user-inactive');\n"
                                 + "          }\n"
                                 + "        }, 4000);\n"
                                 + "      }\n"
                                 + "    }\n"
                                 + "  } catch(e) {}\n"
                                 + "}\n"
                                 + "setInterval(setupPlaybackDetection, 400);\n"
                                 + "setupPlaybackDetection();\n"
                                 + "window.addEventListener('message', function(e) {\n"
                                 + "  var data = e.data;\n"
                                 + "  if (typeof data === 'string') {\n"
                                 + "    try { data = JSON.parse(data); } catch(err){}\n"
                                 + "  }\n"
                                 + "  if (!data) return;\n"
                                 + "  if (data.type === 'showControls') {\n"
                                 + "    showIframeControls(data.persistent || false);\n"
                                 + "  } else if (data.type === 'startHideCountdown') {\n"
                                 + "    showIframeControls(false);\n"
                                 + "  } else if (data.type === 'seek' || data.func === 'fastForward' || data.func === 'rewind') {\n"
                                 + "    var offset = data.offset || (data.args && data.args[0]) || 10;\n"
                                 + "    if (data.func === 'rewind' && offset > 0) offset = -offset;\n"
                                 + "    handleRemoteSeek(offset);\n"
                                 + "  } else if (data.type === 'togglePlay' || data.func === 'togglePlay' || data === 'togglePlay') {\n"
                                 + "    triggerToggle();\n"
                                 + "  }\n"
                                 + "});\n"
                                 + "window.addEventListener('keydown', function(e) {\n"
                                 + "  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.keyCode === 38 || e.keyCode === 40 || e.keyCode === 19 || e.keyCode === 20) {\n"
                                 + "    e.preventDefault();\n"
                                 + "    e.stopPropagation();\n"
                                 + "    e.stopImmediatePropagation();\n"
                                 + "  }\n"
                                 + "}, true);\n"
                                 + "</script>\n";

                            if (fullHtml.contains("</body>")) {
                                fullHtml = fullHtml.replace("</body>", injectScript + "</body>");
                            } else {
                                fullHtml = fullHtml + injectScript;
                            }

                            byte[] bytes = fullHtml.getBytes("UTF-8");
                            ByteArrayInputStream byteStream = new ByteArrayInputStream(bytes);

                            Map<String, String> responseHeaders = new HashMap<>();
                            responseHeaders.put("Access-Control-Allow-Origin", "*");
                            responseHeaders.put("Access-Control-Allow-Headers", "*");
                            return new WebResourceResponse(mimeType, "UTF-8", 200, "OK", responseHeaders, byteStream);
                        } catch (Exception e) {
                            Log.e("LKFlix", "Error intercepting embed HTML: " + e.getMessage());
                        }
                    }
                    
                    return super.shouldInterceptRequest(view, request);
                }
            });

            webView.addJavascriptInterface(new NativeBridge(), "AndroidBridge");
        }
    }

    @Override
    public boolean dispatchKeyEvent(android.view.KeyEvent event) {
        if (event.getAction() == android.view.KeyEvent.ACTION_DOWN) {
            final int keyCode = event.getKeyCode();
            if (keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP ||
                keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN ||
                keyCode == android.view.KeyEvent.KEYCODE_DPAD_LEFT ||
                keyCode == android.view.KeyEvent.KEYCODE_DPAD_RIGHT ||
                keyCode == android.view.KeyEvent.KEYCODE_DPAD_CENTER ||
                keyCode == android.view.KeyEvent.KEYCODE_ENTER ||
                keyCode == android.view.KeyEvent.KEYCODE_BACK ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_PLAY ||
                keyCode == android.view.KeyEvent.KEYCODE_MEDIA_PAUSE) {
                
                final WebView webView = getBridge().getWebView();
                if (webView != null) {
                    webView.post(new Runnable() {
                        @Override
                        public void run() {
                            webView.evaluateJavascript("if (typeof window.handleNativeDpad === 'function') { window.handleNativeDpad(" + keyCode + "); }", null);
                        }
                    });
                }
                
                // When in TV mode, detach ONLY DPAD UP and DOWN from iframe
                if (nativeIsTv && (keyCode == android.view.KeyEvent.KEYCODE_DPAD_UP || keyCode == android.view.KeyEvent.KEYCODE_DPAD_DOWN)) {
                    return true;
                }
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        final WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.post(new Runnable() {
                @Override
                public void run() {
                    webView.evaluateJavascript("if (typeof window.handleNativeBack === 'function') { window.handleNativeBack(); } else if (window.history.length > 1) { window.history.back(); } else { window.location.href = 'index.html'; }", null);
                }
            });
            return;
        }
        super.onBackPressed();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            setupFullScreenWindow();
        }
    }

    private boolean detectIsTV() {
        try {
            android.app.UiModeManager uiModeManager = (android.app.UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            if (uiModeManager != null && uiModeManager.getCurrentModeType() == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION) {
                return true;
            }
        } catch (Exception ignored) {}

        try {
            android.content.pm.PackageManager pm = getPackageManager();
            if (pm != null && pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_LEANBACK)) {
                return true;
            }
        } catch (Exception ignored) {}

        return false;
    }

    public class NativeBridge {

        @JavascriptInterface
        public boolean isTv() {
            return nativeIsTv;
        }

        @JavascriptInterface
        public String getDeviceInfo() {
            return "TV=" + nativeIsTv + " | Device=" + android.os.Build.MODEL + " | Android=" + android.os.Build.VERSION.RELEASE;
        }

        @JavascriptInterface
        public void simulateNativeTouchNormalized(final float normX, final float normY) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        final WebView webView = getBridge().getWebView();
                        if (webView != null) {
                            final int width = webView.getWidth();
                            final int height = webView.getHeight();
                            final float actualX = normX * width;
                            final float actualY = normY * height;
                            final long downTime = SystemClock.uptimeMillis();

                            MotionEvent downEvent = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, actualX, actualY, 0);
                            webView.dispatchTouchEvent(downEvent);
                            downEvent.recycle();

                            webView.postDelayed(new Runnable() {
                                @Override
                                public void run() {
                                    long upTime = SystemClock.uptimeMillis();
                                    MotionEvent upEvent = MotionEvent.obtain(downTime, upTime, MotionEvent.ACTION_UP, actualX, actualY, 0);
                                    webView.dispatchTouchEvent(upEvent);
                                    upEvent.recycle();
                                }
                            }, 100);
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error in simulateNativeTouchNormalized: " + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public String resolveDetailStreamSources(String detailPageUrl) {
            try {
                Log.d(TAG, "NativeBridge resolveDetailStreamSources from: " + detailPageUrl);
                URL url = new URL(detailPageUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);

                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                StringBuilder htmlSb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    htmlSb.append(line).append("\n");
                }
                reader.close();

                String html = htmlSb.toString();
                java.util.List<String> foundSources = new java.util.ArrayList<>();

                // Extract all iframe embeds from detail page (excluding youtube trailer)
                java.util.regex.Pattern iframePattern = java.util.regex.Pattern.compile("<iframe[^>]+src=[\"']([^\"']+)[\"']", java.util.regex.Pattern.CASE_INSENSITIVE);
                java.util.regex.Matcher iframeMatcher = iframePattern.matcher(html);
                while (iframeMatcher.find()) {
                    String src = iframeMatcher.group(1);
                    if (!src.contains("youtube") && !src.endsWith(".jpg") && !src.endsWith(".png") && !foundSources.contains(src)) {
                        foundSources.add(src);
                    }
                }

                // Also check for alternative providers or data-provider links
                java.util.regex.Pattern providerPattern = java.util.regex.Pattern.compile("(?:data-url|data-src|data-provider)=[\"']([^\"']+)[\"']", java.util.regex.Pattern.CASE_INSENSITIVE);
                java.util.regex.Matcher providerMatcher = providerPattern.matcher(html);
                while (providerMatcher.find()) {
                    String pUrl = providerMatcher.group(1);
                    if (pUrl.startsWith("http") && !pUrl.contains("youtube") && !pUrl.endsWith(".jpg") && !pUrl.endsWith(".png") && !pUrl.endsWith(".webp") && !pUrl.contains("/uploads/") && !foundSources.contains(pUrl)) {
                        // Keep only potential video player providers (videonode, playcdn, embed, player, stream, etc.)
                        if (pUrl.contains("videonode") || pUrl.contains("playcdn") || pUrl.contains("embed") || pUrl.contains("player") || pUrl.contains("stream") || pUrl.contains("turbovip") || pUrl.contains("hydrax") || pUrl.contains("cast") || pUrl.contains("filelions")) {
                            foundSources.add(pUrl);
                        }
                    }
                }

                if (!foundSources.isEmpty()) {
                    StringBuilder jsonSb = new StringBuilder("[");
                    for (int i = 0; i < foundSources.size(); i++) {
                        if (i > 0) jsonSb.append(",");
                        jsonSb.append("\"").append(foundSources.get(i).replace("\"", "\\\"")).append("\"");
                    }
                    jsonSb.append("]");
                    Log.e(TAG, "NativeBridge resolved sources JSON: " + jsonSb.toString());
                    return jsonSb.toString();
                }
            } catch (Exception e) {
                Log.w(TAG, "NativeBridge resolveDetailStreamSources error: " + e.getMessage());
            }
            return "[]";
        }

        @JavascriptInterface
        public String resolveDirectStream(String videonodeUrl) {
            try {
                Log.e(TAG, "NativeBridge resolving: " + videonodeUrl);
                URL url = new URL(videonodeUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 9; MiBOX4 Build/PI; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Safari/537.36");
                conn.setRequestProperty("Referer", "https://tv12.lk21official.cc/");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(conn.getInputStream()));
                String line;
                String directHost = null;
                while ((line = reader.readLine()) != null) {
                    java.util.regex.Pattern p = java.util.regex.Pattern.compile("https://(playcdn\\.de|watchcdn\\.de)/[^\"'\\s]+");
                    java.util.regex.Matcher m = p.matcher(line);
                    if (m.find()) {
                        directHost = m.group(0);
                        break;
                    }
                }
                reader.close();

                if (directHost != null) {
                    Log.e(TAG, "NativeBridge resolved direct host: " + directHost);
                    return directHost;
                }
            } catch (Exception e) {
                Log.e(TAG, "NativeBridge resolveDirectStream failed: " + e.getMessage());
            }
            return videonodeUrl;
        }
    }

    private void setupFullScreenWindow() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }

        window.getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }
}
