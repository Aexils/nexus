"""Nexus local fictif : tableau de bord compilé + API Aggregator simulée, classement par le VRAI moteur
(kube-aggregator backend/quality_rules.py) sur des releases fictives. Aucun accès réseau extérieur."""
import importlib.util, json, os, sys, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
ROOT, ENGINE, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])
spec = importlib.util.spec_from_file_location("quality_rules", ENGINE); qr = importlib.util.module_from_spec(spec); spec.loader.exec_module(qr)

def release(rid, origin, res, hdr, langs, size, label=None, access=None):
    return {"release_id": rid, "catalog_origin": origin, "resolution": res, "hdr": hdr, "languages": langs,
            "file_size_gb": size, "file_label": label, "access": access, "source": {"jellycon": "Jellyfin", "vstream": "vStream"}.get(origin, "Autre")}
CONTENT = {"items": [{"title": "Film fictif", "releases": [
    release("j-4k", "jellycon", "2160p", "SDR", ["fr", "en"], 21.4),
    release("j-1080", "jellycon", "1080p", None, ["fr"], 6.2),
    release("v-4k-hdr", "vstream", "2160p", "HDR10", ["fr", "en"], 27.0, "Film.MULTi.2160p.HDR"),
    release("v-4k-dv", "vstream", "2160p", "DV", [], 31.0, "Film.2160p.DV", access="not_authorized"),
    release("v-1080-sdr", "vstream", "1080p", "SDR", ["fre", "eng"], 3.9),
    release("v-720", "vstream", "720p", None, ["fr"], 1.1, "Film.720p.CAM"),
    release("o-unk", None, None, None, [], None)]}]}
# --- Trakt fictif (formats de @nexus/shared-types) -------------------------------------------------
NAV = [{"key": k, "builtin": True, "name": n, "icon": "", "window": "", "has_rows": r, "hidden": h}
       for k, n, r, h in (("search", "Search", False, False), ("home", "Home", True, False),
                          ("shows", "Shows", True, False), ("youtube", "YouTube", True, True))]
TRAKT = {
    "/api/trakt/lists": [{"name": "À voir", "description": "Liste fictive", "item_count": 3, "ids": {"trakt": 1, "slug": "a-voir"},
                          "source": None, "source_status": None}],
    "/api/trakt/custom-screens": {"builtin": [{"id": "home", "name": "Home", "icon": "", "rows": [{"kind": "next"}, {"kind": "list", "list": 1}], "max_rows": 15},
                                              {"id": "shows", "name": "Shows", "icon": "", "rows": [{"kind": "list", "list": 1}], "max_rows": 15}],
                                  "screens": [], "max_screens": 6, "max_rows": 10, "max_builtin_rows": 15, "catalog": []},
    "/api/trakt/row-snapshots": {}, "/api/trakt/provider-logos": [], "/api/trakt/hidden": [],
    "/api/trakt/settings": {"kodi": [], "skin": []},
}
ITEM = lambda n: {"kind": "movie", "label": f"Film fictif {n}", "title": f"Film fictif {n}", "plot": "Résumé fictif.", "runtime": 6000,
                  "rating": 7.5, "year": 2020 + n, "genres": ["Drame"], "tmdb": 1000 + n, "art": {}}
TRAKT_WRITES = []

STATE = {"version": 0, "updated_at": None, "updated_by": None, "preferences": qr.default_preferences()}
CTRL = {"csrf": "csrf-fictif", "next_put": None, "authenticated": True, "down": False, "puts": 0, "previews": 0}

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def j(self, code, data):
        body = json.dumps(data).encode(); self.send_response(code)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"{}")
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/mock/state": return self.j(200, {**CTRL, "state": STATE})
        if p == "/api/aggregator/preferences":
            return self.j(503, {"status": "unavailable", "error": "kube-aggregator injoignable"}) if CTRL["down"] else self.j(200, STATE)
        if p == "/api/auth/session":
            return self.j(200, {"authenticated": CTRL["authenticated"], "csrf": CTRL["csrf"] if CTRL["authenticated"] else None, "configured": True})
        if p == "/api/trakt/nav": return self.j(200, NAV)
        if p in TRAKT: return self.j(200, TRAKT[p])
        if p.startswith("/api/trakt/rows/"): return self.j(200, [ITEM(n) for n in range(1, 6)])
        if p == "/mock/trakt-writes": return self.j(200, TRAKT_WRITES)
        if p.startswith("/api/") or p.startswith("/socket.io"): return self.j(404, {})
        if not os.path.exists(os.path.join(ROOT, p.lstrip("/"))) or p == "/": self.path = "/index.html"
        return super().do_GET()
    def do_POST(self):
        p = self.path.split("?")[0]; data = self.body()
        if p == "/mock/control": CTRL.update(data); return self.j(200, CTRL)
        if p == "/api/auth/login":
            if data.get("password") != "fictif": return self.j(401, {"status": "unauthenticated", "error": "mot de passe incorrect"})
            CTRL["authenticated"] = True; return self.j(200, {"authenticated": True, "csrf": CTRL["csrf"], "configured": True})
        if p == "/api/auth/logout": CTRL["authenticated"] = False; return self.j(204, {})
        if p.startswith("/api/trakt/"): return self.trakt_write("POST")
        if p == "/api/aggregator/preview":
            CTRL["previews"] += 1
            if CTRL["down"]: return self.j(503, {"status": "unavailable", "error": "kube-aggregator injoignable"})
            try: d = qr.preview_decision(data["preferences"], CONTENT)
            except ValueError as e: return self.j(422, {"status": "invalid", "error": str(e)})
            prof = d["profile"]
            return self.j(200, {"profile": prof.key if prof else "none", "rules": [r.label for r in prof.rules] if prof else [],
                                "autoplay": d["autoplay"], "refused": d["refused"],
                                "releases": [{"release_id": r["ref"], "tier": r["tier"], "rank": pos, "explanation": why, "refusal": reason,
                                              "source": r["release"]["source"], "resolution": r["resolution"], "hdr": r["hdr"],
                                              "languages": r["languages"], "file_size_gb": r["size_gb"], "access": r["access"]}
                                             for r, reason, pos, why in d["manual"]]})
        return self.j(404, {})
    def trakt_write(self, method):
        """Même règle que Nexus : session et jeton anti-CSRF exigés pour toute écriture Trakt."""
        data = self.body()
        if not CTRL["authenticated"]: return self.j(401, {"status": "unauthenticated"})
        if self.headers.get("X-CSRF-Token") != CTRL["csrf"]: return self.j(403, {"status": "csrf"})
        TRAKT_WRITES.append(f"{method} {self.path}")
        if self.path == "/api/trakt/nav":
            hidden = {e["key"]: e["hidden"] for e in data.get("entries", [])}
            for e in NAV: e["hidden"] = hidden.get(e["key"], e["hidden"])
            return self.j(200, NAV)
        return self.j(200, {})
    def do_DELETE(self):
        if self.path.startswith("/api/trakt/"): return self.trakt_write("DELETE")
        return self.j(404, {})
    def do_PUT(self):
        if self.path.startswith("/api/trakt/"): return self.trakt_write("PUT")
        data = self.body(); CTRL["puts"] += 1
        if self.headers.get("X-CSRF-Token") != CTRL["csrf"] or not CTRL["authenticated"]:
            return self.j(401 if not CTRL["authenticated"] else 403, {"status": "unauthenticated" if not CTRL["authenticated"] else "csrf"})
        forced, CTRL["next_put"] = CTRL["next_put"], None
        if forced == 409: return self.j(409, {"status": "conflict", "version": STATE["version"] + 1})
        if forced == 503: return self.j(503, {"status": "unavailable", "error": "kube-aggregator injoignable"})
        if data.get("version") != STATE["version"]: return self.j(409, {"status": "conflict", "version": STATE["version"]})
        try: clean = qr.validate_preferences(data["preferences"])
        except ValueError as e: return self.j(422, {"status": "invalid", "error": str(e)})
        STATE.update(version=STATE["version"] + 1, updated_at=time.time(), updated_by="nexus", preferences=clean)
        return self.j(200, STATE)
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
